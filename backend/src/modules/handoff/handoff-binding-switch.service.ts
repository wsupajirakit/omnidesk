import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { HandoffTarget } from './schemas/handoff-target.schema';

/**
 * Outcome of a bulk binding flip. `changedBindings` counts OA bindings, not
 * documents — a single target holding three flipped OAs reports 1 modified
 * target and 3 changed bindings.
 */
export interface HandoffBindingFlipResult {
  matchedTargets: number;
  modifiedTargets: number;
  changedBindings: number;
  /**
   * Hook ids that actually moved, as hex strings.
   *
   * Needed so the caller can audit only what changed. Auditing the whole batch
   * instead would record `from: true` against an OA that was already off — or
   * against one bound to no target at all — which is a false entry in the trail
   * an operator would later use to reconstruct who killed what.
   */
  changedHookIds: string[];
}

/**
 * The write behind the per-OA handoff kill switch: flips
 * `scope.bindings[].enabled` for a set of OAs across every target.
 *
 * WHY THIS IS A SEPARATE SERVICE AND NOT A METHOD ON HandoffTargetService
 * The kill switch is driven from `PATCH /hook/handoff/bulk`, so HooksModule has
 * to provide whatever performs the write. HandoffTargetService cannot be that
 * thing: it injects HandoffOaAccessService, which imports the '@/modules/hooks'
 * barrel. Providing it from HooksModule therefore re-enters hooks while hooks is
 * still initialising and the app dies at boot with "Cannot read properties of
 * undefined (reading 'name')" — the exact failure hooks.module.ts already
 * documents for User, observed for real here before this file existed.
 *
 * This service depends on the HandoffTarget model and nothing else, so both
 * modules can provide it with no cycle. It is stateless and every instance
 * shares the one Mongoose connection, so two instances cannot disagree.
 */
@Injectable()
export class HandoffBindingSwitchService {
  constructor(
    @InjectModel(HandoffTarget.name)
    private readonly targetModel: Model<HandoffTarget>,
  ) {}

  /**
   * Flips `enabled` on a set of OAs' bindings across EVERY target they are
   * bound to.
   *
   * WHY ALL TARGETS AND NEVER A SUBSET
   * The owner's invariant: "Bind ต้องเหมือนกันตลอด · OA ที่จะใช้ได้จะเท่ากัน ·
   * จะไม่มี OA ที่ขาด handoff ตัวใดตัวนึง · จะไม่มี OA ผสม". `topup` and
   * `walletpay` always carry identical bindings; every OA has both or neither. So
   * "turn handoff off for this OA" can only mean all of them — flipping one
   * target would manufacture exactly the mixed state that is invalid data.
   * That is also why this takes no `target_key`: there is nothing to choose.
   *
   * WHAT IT DELIBERATELY DOES NOT DO
   * · It never REMOVES a binding row. `enabled:false` keeps the OA's config so
   *   an operator can toggle it back without re-picking it (legacy's own
   *   comment on the field says exactly this).
   * · It never CREATES a binding where none exists. After
   *   CHANGE-20260807-BINDREQUIRED an unbound target already reaches nobody, so
   *   "off" is already the state — writing a row would change the document to
   *   express something it already expresses. An OA bound to nothing is
   *   therefore a legitimate no-op, not an error.
   * · It does not touch `handoff_hook_overrides`. That collection reads like a
   *   per-OA switch and is not one: it overrides endpoint + credentials
   *   (`hookOverrideResolver.js:5`), so using it here would silently rewrite
   *   credentials on the money path.
   *
   * The write is a single positional-filtered `updateMany`, so the whole batch
   * lands in one command and a half-applied flip — some OAs off on `topup` but
   * still on for `walletpay` — is not reachable through a partial loop.
   * `arrayFilters` matches only bindings not already at the requested value,
   * which is what makes a repeat call write nothing.
   *
   * ⚠️ This sets the flag the runtime gate reads
   * (`services/handoff/index.js:oaEnabled` → `scope.bindings[].enabled`). That
   * gate is NOT ported into this codebase yet, so writing `false` here does not
   * stop a dispatch today — it establishes the state that will stop it once the
   * gate lands.
   */
  async setBindingEnabledForHooks(
    hookIds: (string | Types.ObjectId)[],
    value: boolean,
  ): Promise<HandoffBindingFlipResult> {
    const ids = hookIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    const empty: HandoffBindingFlipResult = {
      matchedTargets: 0,
      modifiedTargets: 0,
      changedBindings: 0,
      changedHookIds: [],
    };
    if (ids.length === 0) return empty;

    const selector = {
      deleted_at: null,
      'scope.bindings': {
        $elemMatch: { hook_id: { $in: ids }, enabled: { $ne: value } },
      },
    };

    /*
     * Counted BEFORE the write: `modifiedCount` reports documents, not
     * sub-documents, so it cannot answer "how many OA bindings actually
     * flipped" — the number the caller audits and returns.
     */
    const before = await this.targetModel
      .find(selector)
      .select({ 'scope.bindings': 1 })
      .lean<
        {
          scope?: {
            bindings?: { hook_id: Types.ObjectId; enabled?: boolean }[];
          };
        }[]
      >()
      .exec();

    const wanted = new Set(ids.map(String));
    const changedHookIds = new Set<string>();
    let changedBindings = 0;
    for (const doc of before) {
      for (const b of doc.scope?.bindings ?? []) {
        const hookId = String(b.hook_id);
        // `enabled` defaults to true, so a row written before the field
        // existed must read as enabled, not as false.
        if (wanted.has(hookId) && (b.enabled ?? true) !== value) {
          changedBindings += 1;
          changedHookIds.add(hookId);
        }
      }
    }

    // Nothing to do — the idempotent path. No write, so no audit row either.
    if (changedBindings === 0) return empty;

    const result = await this.targetModel
      .updateMany(
        selector,
        { $set: { 'scope.bindings.$[b].enabled': value } },
        {
          arrayFilters: [
            { 'b.hook_id': { $in: ids }, 'b.enabled': { $ne: value } },
          ],
        },
      )
      .exec();

    return {
      matchedTargets: result.matchedCount ?? before.length,
      modifiedTargets: result.modifiedCount ?? before.length,
      changedBindings,
      changedHookIds: [...changedHookIds],
    };
  }
}
