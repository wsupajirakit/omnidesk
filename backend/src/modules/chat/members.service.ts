import type { AuthenticatedUser } from '@/common';

/* [TEST-20260820-DEVREMOVE] the developer-only lock on clearRawProfile — see the
   file for what it protects and how to switch it off. */
import { assertDevRemoveAllowed } from './dev-remove.guard';
import { auditAbandonShieldFlip } from './member-abandon-audit.helper';
/* [FEAT-20260829-MANUALFOLLOWSTAMP] the rules for stamping a follow-up time by
   hand live in their own file — see its header. revert: drop this import, the
   `setFollowUpStamp` method below and the route in members.controller.ts. */
import {
  auditFollowStampSet,
  FOLLOW_STAMP_KEY_BY_KIND,
  FOLLOW_STAMP_KINDS,
  isFollowStampKind,
  readRegistrationPair,
  readStoredStamp,
  stampIsEmpty,
} from './member-follow-stamp.helper';
/* [DOC-20260821-BAGRULES] the `config` bag has rules, and they live in
   `src/modules/chat/config/member-config.registry.ts` — read the entry for
   `follow_up.line.notice_deposit_at` before touching the write below.
   Imported by its full path on purpose: the registry's own drift guard
   (`z-test/unit/member-config-consumers.spec.ts`) recognises a consumer by the
   `chat/config` import, and `'./config'` would hide this file from it.

   ── BOTH ENDS ──
   WRITES  `follow_up.line.notice_deposit_at` / `…notice_withdraw_at`, ONE per
           call, and ONLY when the stored value is empty.
   WHO TAKES IT
     · `src/modules/chat/chat.service.ts` (listContacts) — the `?follow=`
       contact filter, a `$exists` read on the partial indexes
     · `src/modules/webhook/notice-runtime/notice-guard.helper.ts` — compares the
       stamp's age for the notice cooldown (inert in production today, see the
       registry entry, but it IS a reader)
     · `src/modules/tickets/patch-after-close.helper.ts` — decides which
       close-case sections to show, and clears the stamp when the admin says
       "ไม่ติดตาม"
     · FE `omnidesk-console/components/member/follow-up/followStamps.ts` and
       `components/contact/ContactHeaderInfo.tsx` — both render the raw value
   ⚠️ The other writer of the same keys is the notice runtime, which MUST move
      the stamp per card. This one must NOT: it refuses a non-empty value, so a
      human press can never rewrite what the runtime recorded. */
import { writeMemberConfig } from '@/modules/chat/config';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';

import { AuditLogService } from '@/modules/audit';
import {
  CustomerProviderService,
  providerFeatureOn,
} from '@/modules/customer-provider';
import { CustomToolService } from '@/modules/external';
import { redactSiteRules } from './site-rules/redact-site-rules';
import {
  Hook,
  getAllowedHookIds,
  scopeFilter,
  type HookDocument,
} from '@/modules/hooks';

import type {
  RefreshRawProfileDto,
  UpdateMemberDetailDto,
  UpdateMemberIgnoreAbandonBody,
  UpdateMemberNicknameDto,
} from './dto';
import {
  ChatRoom,
  Member,
  type ChatRoomDocument,
  type MemberDocument,
} from './schemas';

/**
 * PORTED — legacy legacy-api/src/controllers/chat/memberController.js:186-281
 * ([FEAT-20260801-MANUALREFRESH]).
 *
 * The refresh button fires a real outbound request at the operator's custom
 * tool, so the brake is keyed on the CUSTOMER, not on the admin who clicked:
 * five admins with the same room open must not become five upstream calls.
 * Legacy keeps this Map at module scope in a single-process controller; a Nest
 * singleton service field is the same lifetime.
 */
const REFRESH_COOLDOWN_MS = 10 * 1000;
const REFRESH_GUARD_MAX = 5000;

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  /** line_user_id -> epoch ms of the last call that actually left the process. */
  private readonly refreshGuard = new Map<string | undefined, number>();

  constructor(
    @InjectModel(Member.name)
    private readonly memberModel: Model<MemberDocument>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    private readonly customToolService: CustomToolService,
    /* [FIX-20260818-MEMBERSCOPE · plan §8 = T3-3] A member row carries NO hook_id
       (0 of 130 in the live data), so "may this caller touch this member" can only
       be answered by the rooms that join them. Appended last; no spec constructs
       this service positionally, verified before adding. */
    @InjectModel(ChatRoom.name)
    private readonly chatRoomModel: Model<ChatRoomDocument>,
    /* [FEAT-20260821-ABANDONSHIELD] APPENDED LAST, and that is not a style
       choice: a constructor param inserted in the middle silently shifts every
       positional caller, and `{} as never` stubs in specs hide it from tsc.
       Same rule the ChatRoom param above follows. ต่อท้ายเท่านั้น. */
    private readonly auditLog: AuditLogService,
    /* [FEAT-20260905-CUSTPROV] APPENDED LAST, same rule as the two params above:
       a param inserted in the middle silently shifts every positional caller and
       `{} as never` stubs hide it from tsc. */
    private readonly customerProvider: CustomerProviderService,
  ) {}

  /**
   * [FEAT-20260905-CUSTPROV] Stamps `customer_provider` onto a response.
   *
   * WHY A HELPER AND NOT SIX EDITS. Six return statements in this file answer
   * the profile and site-rules routes, and writing the key at each would be the
   * same fact in six places — the shape that broke `invalidateScope` earlier
   * today, where a key built in two places drifted the moment one was changed.
   * One definition, six callers.
   *
   * 🔴 ADDITIVE ONLY. It adds a key; it never reads, reshapes or replaces `data`,
   * which stays the raw upstream blob exactly as stored. A client that ignores
   * the key behaves precisely as it did before this existed.
   *
   * The value is the RESOLVED provider name, never the raw env string — if the
   * variable held a typo the screen must be told what actually answered.
   * ตอบตามที่ทำงานจริง ไม่ใช่ตามที่พิมพ์มา
   */
  private stamped(payload: Record<string, unknown>): Record<string, unknown> {
    return {
      ...payload,
      customer_provider: this.customerProvider.activeName(),
    };
  }

  /**
   * [FEAT-20260905-CUSTPROV] A PROFILE answer: the stamp, plus `view`.
   *
   * 📖 PLAN: PART 7 §36 — the envelope every provider answers with.
   *
   * 🔴 `view` IS ADDITIVE. It never reshapes, replaces or reorders `data`, which
   * stays the raw upstream blob exactly as stored — the same OBJECT, not a copy,
   * so byte-identity is a property of the code rather than of a test's
   * carefulness. `raw_profile_data` is read by the tier port, the notice rules
   * and the follow-up rules; a helper that reshaped it would change three
   * unrelated behaviours and none of them would say so.
   * เพิ่ม view ไม่ได้ย้ายข้อมูล
   *
   * 🔴 IT IS DERIVED FROM `payload['data']`, NOT FROM A SECOND READ. The view and
   * the data in one answer therefore describe the same object by construction: a
   * later edit that changes WHICH blob a branch returns — the cooldown branch
   * serves the stored copy, the refresh branch the re-read one — cannot leave
   * `view` describing the other one. Passing the blob in as a parameter would
   * have made that a rule each of the three call sites had to keep.
   *
   * 🔴 WHY THIS KEY SHIPS BEFORE ITS RENDERERS, WHEN `fields` DID NOT. A `fields`
   * key holding the provider's 26 resolved values shipped here briefly on 05/09
   * and was removed the same day. `view` is not that key coming back, and the two
   * reasons `fields` was removed are exactly why:
   *
   *   1. `fields` FROZE THE WRONG CONTRACT — it taught the dashboard 26 vendor
   *      field names (`finCredit`, `cbPending`). `view.sections` is the closed
   *      set of section TYPES the plan specifies (§36-37), so the front end
   *      learns a vocabulary that does not change when a vendor does. This is
   *      the final shape, not a bridge to it.
   *   2. `fields` COULD NOT BE PROVEN — nothing rendered it. `view` is proven on
   *      this side alone: one schema validates it on the way out
   *      (`providers/engine/validate-view.ts`), a fake provider proves a second
   *      provider changes it, and `data` is byte-compared against what was
   *      stored — PART 7 §41 proofs 1, 3 and 2, all in
   *      `z-test/unit/customer-provider-envelope.spec.ts`.
   *
   * ⚠️ A client that ignores the key behaves exactly as before, which is what
   * `provider-entries.ts` §4c records: BE alone ⇒ the response gains a key
   * nothing reads, and nothing changes. The renderers are the other half of THIS
   * part, not a speculative future.
   *
   * Kept as a named helper rather than folded into `stamped` because the profile
   * routes and the site-rules route differ in what they may carry, and a single
   * helper would have to guess which it was answering per call site. Site-rules
   * answers carry NO `view`: that payload is the site's rules, not a customer.
   *
   * revert: return `this.stamped(payload)` and drop the `view` key. Nothing else
   *         in this file changes.
   */
  private stampedProfile(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    /* [FEAT-20260907-PROVCONDS] §6-pattern stamps, ONLY when the provider
       declares them — shopapi_v1 declares neither, so its responses carry
       neither key and the dashboard's legacy rules decide exactly as today.
       Stamped HERE (the one insertion point) so every profile exit —
       raw-profile GET, refresh cooldown, refresh success — carries the same
       verdict; a flag read at two of three exits flickers (flow doc §6.4). */
    const provider = this.customerProvider.resolve();
    const conds: Record<string, unknown> = {};
    if (typeof provider.hasMemberData === 'function') {
      conds['has_member_data'] = provider.hasMemberData(payload['data']);
    }
    if (provider.showWalletpayCard !== undefined) {
      conds['show_walletpay_card'] = provider.showWalletpayCard;
    }
    if (provider.showRegisterAction !== undefined) {
      conds['show_register_action'] = provider.showRegisterAction;
    }
    return this.stamped({
      ...payload,
      ...conds,
      /* The provider's own arrangement of the blob this answer is carrying. The
         guard that a malformed section can never reach a browser is inside
         `viewOf`, at the module's one exit — not here. */
      view: this.customerProvider.viewOf(payload['data']),
    });
  }

  /**
   * Refuses when the caller shares no room with this member.
   *
   * ⚠️ This is a JOIN, not a field check — see the constructor note. A member
   * whose only rooms sit under an OA outside the caller's scope becomes
   * unreachable to them, which is the point. Two rooms in the live data carry a
   * null `hook_id`; their members are reachable only by a super user, and that is
   * the correct fail-closed answer for a row with no owner.
   *
   * ⚠️ NOT used by the webhook path — `MembersService` is not imported there at
   * all (verified by grep before this landed), so no inbound LINE traffic can be
   * refused by this. เส้น LINE ไม่ได้ผ่านตรงนี้
   */
  private async ensureMemberInScope(
    auth: AuthenticatedUser | undefined,
    memberId: string,
  ): Promise<void> {
    const allowed = await getAllowedHookIds(auth, this.hookModel);
    if (allowed === null) return;

    const shared = await this.chatRoomModel.exists({
      user_id: memberId,
      ...scopeFilter(allowed),
    });
    if (!shared) {
      throw new ForbiddenException('insufficient OA access');
    }
  }

  /**
   * [FIX-20260906-HOOKSCOPE] Refuses an OA the caller may not see.
   *
   * ⚠️ THE MEMBER CHECK DOES NOT COVER THIS, and that is the whole bug.
   * `ensureMemberInScope` asks "may this caller reach this MEMBER" — a join over
   * rooms. `refreshRawProfile` then takes a SECOND identifier straight from the
   * request body (`dto.hook_id`) and uses it to pick which OA's credentials fetch
   * the profile. Nothing checked that one. An operator scoped to OA A, sharing a
   * room with a member under A, could post `{"hook_id":"<OA B>"}` and have the
   * server fetch that member's profile through an OA they have no access to —
   * and the answer is stored on the member and returned.
   * ตรวจว่าเข้าถึง "สมาชิก" ได้ ไม่ได้แปลว่าเข้าถึง "OA" ที่ส่งมาในบอดี้ได้
   *
   * Deliberately the same helper, the same `null`-means-super-user contract and
   * the same message as `ensureMemberInScope` above: a second spelling of an
   * access rule is how the two drift apart.
   */
  private async ensureHookInScope(
    auth: AuthenticatedUser | undefined,
    hookId: string,
  ): Promise<void> {
    const allowed = await getAllowedHookIds(auth, this.hookModel);
    if (allowed === null) return;
    if (!allowed.includes(String(hookId))) {
      throw new ForbiddenException('insufficient OA access');
    }
  }

  /** legacy:pruneRefreshGuard — called only when the Map nears its ceiling. */
  private pruneRefreshGuard(): void {
    const now = Date.now();
    for (const [k, at] of this.refreshGuard) {
      if (now - at >= REFRESH_COOLDOWN_MS) this.refreshGuard.delete(k);
    }
    while (this.refreshGuard.size > REFRESH_GUARD_MAX) {
      const oldest = this.refreshGuard.keys().next().value;
      if (oldest === undefined && !this.refreshGuard.has(oldest)) break;
      this.refreshGuard.delete(oldest);
    }
  }

  public async updateNickname(
    id: string,
    dto: UpdateMemberNicknameDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid Member ID');
    }
    await this.ensureMemberInScope(auth, id);
    const { nickname } = dto;
    if (!nickname || !nickname.trim()) {
      throw new BadRequestException('nickname is required');
    }

    const user = await this.memberModel.findById(id).lean();
    if (!user) {
      throw new NotFoundException('Member not found');
    }

    const updated = await this.memberModel
      .findByIdAndUpdate(
        id,
        { $set: { nickname: nickname.trim() } },
        { new: true },
      )
      .lean();

    return { success: true, data: updated };
  }

  public async updateDetail(
    id: string,
    dto: UpdateMemberDetailDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid Member ID');
    }
    await this.ensureMemberInScope(auth, id);
    const { detail } = dto;
    if (detail === undefined) {
      throw new BadRequestException('detail is required');
    }

    const user = await this.memberModel.findById(id).lean();
    if (!user) {
      throw new NotFoundException('Member not found');
    }

    const updated = await this.memberModel
      .findByIdAndUpdate(
        id,
        { $set: { detail: detail || null } },
        { new: true },
      )
      .lean();

    return { success: true, data: updated };
  }

  /**
   * [FEAT-20260821-IGNOREABANDON] switch the abandon chase off for ONE customer.
   *
   * Modelled on `updateDetail` above line for line — same id check, same scope
   * check, same not-found, same envelope — because a new shape here would be a
   * new thing for the FE to learn for no reason.
   *
   * ⚠️ `ensureMemberInScope` is not optional and not a formality: a member is
   * reachable only through a room the caller shares with them
   * (`[FIX-20260818-MEMBERSCOPE]`). Dropping it would let any operator flip the
   * switch for a customer belonging to an OA they cannot see.
   *
   * ⚠️ Writes the COLUMN, never `config` — owner, 20/08/2026: *"member column
   * จริงไม่ใช่ config follow ไม่เกี่ยว"*. Nothing here touches the settings bag,
   * its registry or its helpers.
   *
   * NO CACHE EVICTION HERE, deliberately: members are not cached the way hooks
   * are — the webhook reads the member row per event (`webhook.service.ts`
   * resolves `existingUser` fresh), so there is nothing stale to evict. The
   * hook-side bulk switch DOES evict, and says why in its own header.
   * revert: delete this method, its route and its DTO.
   */
  public async updateIgnoreAbandon(
    id: string,
    body: UpdateMemberIgnoreAbandonBody,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid Member ID');
    }
    await this.ensureMemberInScope(auth, id);
    /* raw off the wire — the global pipe never touched it, see the type's
       header. `typeof` is therefore the real guard, not a second opinion. */
    const value = body?.['ignore_abandon_assist'];
    if (typeof value !== 'boolean') {
      throw new BadRequestException('ignore_abandon_assist must be a boolean');
    }

    const user = await this.memberModel.findById(id).lean();
    if (!user) {
      throw new NotFoundException('Member not found');
    }

    const updated = await this.memberModel
      .findByIdAndUpdate(
        id,
        { $set: { ignore_abandon_assist: value } },
        { new: true },
      )
      .lean();

    /* [FEAT-20260821-ABANDONSHIELD] the whole audit story lives in the helper —
       it never throws and writes nothing when the value did not move.
       revert: delete this call and the `auditLog` constructor param. */
    auditAbandonShieldFlip(
      {
        memberId: id,
        before: (user as unknown as Record<string, unknown>)[
          'ignore_abandon_assist'
        ],
        after: value,
        auth,
      },
      {
        audit: this.auditLog,
        warn: (m) => this.logger.warn(m),
      },
    );

    return { success: true, data: updated };
  }

  /**
   * [FEAT-20260829-MANUALFOLLOWSTAMP] stamp `notice_deposit_at` /
   * `notice_withdraw_at` by hand from the customer panel.
   *
   * Owner 29/08: the two follow-up rows are clickable while they read `n/a`;
   * pressing one records the follow-up time for that member. Deposit and
   * withdraw are pressed separately and each press is confirmed on screen.
   *
   * 🔴 `kind` is an ALLOW-LIST, never a config key off the wire — see the helper
   *    header for why. 🔴 An existing stamp is REFUSED, not overwritten: these
   *    values are the record of when a notice card went out, read by the
   *    `?follow=` contact filter, and moving one forward would rewrite history.
   *
   * Scope is checked the same way as every other member route
   * (`ensureMemberInScope`) — a member is reachable only through a room the
   * caller shares with them.
   */
  public async setFollowUpStamp(
    id: string,
    body: Record<string, unknown>,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid Member ID');
    }
    await this.ensureMemberInScope(auth, id);

    /* raw off the wire — the global pipe never validated this body, so the
       narrowing here IS the guard, not a second opinion. */
    const kind = body?.['kind'];
    if (!isFollowStampKind(kind)) {
      throw new BadRequestException(
        `kind must be one of: ${FOLLOW_STAMP_KINDS.join(', ')}`,
      );
    }

    /* [FEAT-20260830-AUDITLINEID] `line_user_id` is selected purely so the audit
       row can name WHOSE follow-up was stamped — `ref_id` carries the Mongo
       `_id`, which no admin recognises. It is not used for the write itself. */
    const member = await this.memberModel
      .findById(id)
      .select('_id config line_user_id')
      .lean();
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    /* Empty only. The screen offers the button exactly where it shows `n/a`, so
       a non-empty stamp here means the panel was stale or two admins pressed at
       once — either way the honest answer is "no", not a silent overwrite. */
    if (!stampIsEmpty(member, kind)) {
      throw new BadRequestException('This follow-up time is already recorded');
    }

    /* UTC, deliberately — the +07:00 rendering happens on the screen. */
    const at = new Date();
    const written = await writeMemberConfig(
      { _id: id },
      FOLLOW_STAMP_KEY_BY_KIND[kind],
      at,
      {
        // the same cast the other writers arrive with: the helper addresses
        // `config` by dot-path and never touches a declared field.
        memberModel: this.memberModel as unknown as Model<
          Record<string, unknown>
        >,
      },
    );
    if (!written) {
      throw new NotFoundException('Member not found');
    }

    /* Fire-and-forget by design — the value is already stored. See the helper. */
    auditFollowStampSet(
      {
        memberId: id,
        lineUserId: (member as { line_user_id?: string } | null)?.line_user_id,
        kind,
        at,
        auth,
      },
      { audit: this.auditLog, warn: (m) => this.logger.warn(m) },
    );

    return {
      success: true,
      data: { kind, key: FOLLOW_STAMP_KEY_BY_KIND[kind], at: at.toISOString() },
    };
  }

  /**
   * [FEAT-20260830-FOLLOWUPFRESH] the follow-up stamps of ONE member, read now.
   *
   * WHY IT EXISTS. The close-case dialog decides which sections to show from
   * `selectedRoom`, which the screen loaded when the admin opened the room and
   * never refreshed. Between opening a room and pressing "ปิดเคส" the stamps can
   * move underneath: the notice runtime writes them after a card goes out, a
   * multicast clears them, another admin presses the clock button on the panel.
   * The dialog then offers a choice about a stamp that is no longer there — the
   * back end correctly does nothing, and the admin is left believing they acted.
   * ⇒ owner 30/08: read them fresh when the dialog opens.
   *
   * 🔴 DELIBERATELY NOT `GET /api/chat` AGAIN. That endpoint returns the room
   *    with the whole member populated, on the collection every screen reads.
   *    This answers one question about one member with a two-field projection.
   *
   * ⚠️ It reports what is STORED, nothing else. The rule for "is this empty" is
   *    the shared `stampIsEmpty`, so this endpoint, the write path and the
   *    screen can never disagree about what `n/a` means.
   */
  public async getFollowUpStamps(
    id: string,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid Member ID');
    }
    await this.ensureMemberInScope(auth, id);

    const member = await this.memberModel
      .findById(id)
      .select('_id config line_user_id')
      .lean();
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    /* The stamps the close-case dialog asks about. `null` means "no stamp",
       decided by the same helper the writer uses — never by a second opinion. */
    const stamps: Record<string, string | null> = {};
    for (const kind of FOLLOW_STAMP_KINDS) {
      const raw = stampIsEmpty(member, kind)
        ? null
        : readStoredStamp(member, kind);
      stamps[kind] =
        raw instanceof Date
          ? raw.toISOString()
          : raw === null || raw === undefined
            ? null
            : String(raw);
    }

    return {
      success: true,
      data: {
        member_id: String((member as { _id: unknown })._id),
        line_user_id:
          (member as { line_user_id?: string }).line_user_id ?? null,
        /* the two the dialog can act on */
        ...stamps,
        /* the registration pair, so the dialog can decide that section too —
           read raw because it is not part of the stamp allow-list */
        registration_pair: readRegistrationPair(member),
      },
    };
  }

  public async getRawProfile(
    id: string,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid Member ID');
    }
    await this.ensureMemberInScope(auth, id);

    const user = await this.memberModel
      .findById(id, 'raw_profile_data profile_data_updated_at')
      .lean();
    if (!user) {
      throw new NotFoundException('Member not found');
    }

    const blob = user.raw_profile_data || null;
    return this.stampedProfile({
      success: true,
      data: blob,
      profile_data_updated_at: user.profile_data_updated_at
        ? new Date(user.profile_data_updated_at).toISOString()
        : null,
    });
  }

  public async refreshRawProfile(
    id: string,
    dto: RefreshRawProfileDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid Member ID');
    }
    await this.ensureMemberInScope(auth, id);
    const hookId = dto.hook_id;
    if (!hookId || !isValidObjectId(hookId)) {
      throw new BadRequestException('Invalid hook_id');
    }
    await this.ensureHookInScope(auth, hookId);

    const member = await this.memberModel
      .findById(id, 'line_user_id raw_profile_data profile_data_updated_at')
      .lean();
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    // Inside the cooldown window → nothing leaves the process, the stored copy
    // is returned with HTTP 200 and the caller cannot tell (legacy:223-235).
    //
    // ⚠️ This branch has NO `changed` key, and that is legacy, not an
    // oversight: `changed === false` and `!changed` are different questions and
    // a caller is entitled to ask either. Adding the key here would answer the
    // first one with a value the branch never computed.
    /* [FEAT-20260824-CLAIMPROFILE] `trigger: 'case_taken'` เดินผ่าน cooldown ได้
     *
     * เจ้าของสั่ง 24/08/2026: ตอนแอดมินกดรับงานห้องนั้น ต้องดึงโปรไฟล์ใหม่
     * **ทันที** และ panel ขวาต้องเห็นของสด — ไม่ต้องรอ cooldown
     *
     * ทำไมยอมให้ข้าม: cooldown มีไว้กันปุ่มที่คนกดรัวได้ · การรับเคสเป็นการกระทำ
     * ครั้งเดียวที่ตั้งใจ ไม่ใช่สิ่งที่มือกดซ้ำได้เร็ว ๆ · ถ้ามันบังเอิญตกในหน้าต่าง
     * ของ refresh ก่อนหน้า แอดมินจะได้ panel เก่าโดยไม่มีอะไรบอกว่าทำไม
     *
     * ⚠️ ข้ามได้เฉพาะค่านี้ค่าเดียว — DTO ใช้ `@IsIn(['case_taken'])` ไม่ใช่
     *    boolean · boolean จะถูกก๊อปไปใช้ที่ปุ่ม refresh มือทันที ซึ่งคือสิ่งที่
     *    cooldown มีไว้กันพอดี
     * ⚠️ **ยังจองช่องเหมือนเดิม** (บรรทัด `refreshGuard.set` ด้านล่าง ไม่ถูกข้าม)
     *    ⇒ การข้ามครั้งนี้ไม่ได้เปิดหน้าต่างค้างไว้ให้ใครตามมา · refresh มือที่กด
     *    ต่อจากนี้ยังติด cooldown ตามปกติ · เป็น "ข้อยกเว้น" ไม่ใช่ "รู"
     * revert: ลบ `&& dto.trigger !== 'case_taken'` ออกจากเงื่อนไขข้างล่าง */
    /* [FEAT-20260825-CHATOPENFRESH] เหตุผลที่สองที่ข้าม cooldown ได้ — เปิดห้องแชท
       รายการค่าที่อนุญาตอยู่ที่ `member.dto.ts` (@IsIn) ตัวนี้แค่ถามว่า "ส่งมาไหม"
       ⚠️ ยังไม่ใช่ boolean · ปุ่ม refresh มือไม่ส่ง trigger ⇒ ยังติด cooldown เหมือนเดิม */
    const bypassCooldown =
      dto.trigger === 'case_taken' || dto.trigger === 'chat_opened';
    const last = this.refreshGuard.get(member.line_user_id) || 0;
    if (!bypassCooldown && Date.now() - last < REFRESH_COOLDOWN_MS) {
      const cached = member.raw_profile_data || null;
      return this.stampedProfile({
        success: true,
        data: cached,
        refreshed: false,
        reason: 'cooldown',
        profile_data_updated_at: member.profile_data_updated_at
          ? new Date(member.profile_data_updated_at).toISOString()
          : null,
      });
    }

    const hook = await this.hookModel.findById(hookId).lean();
    if (!hook) {
      throw new NotFoundException('Hook not found');
    }

    // Reserve the slot BEFORE firing — two requests arriving in the same tick
    // must not both get through (legacy:243-245).
    this.refreshGuard.set(member.line_user_id, Date.now());
    if (this.refreshGuard.size >= REFRESH_GUARD_MAX) this.pruneRefreshGuard();

    let reason: string | null = null;
    try {
      // The real call. getCombinedData is the ONLY writer of raw_profile_data
      // (it writes on a 200 and leaves the stored copy alone on 404/500/
      // timeout), so this route goes through it rather than fetching the
      // profile endpoint itself — a second copy of those rules would be debt.
      // Only the log label differs from the webhook prefetch.
      /* [FEAT-20260825-CHATOPENFRESH] ป้าย log บอกเหตุผลจริง — คนอ่าน log ย้อนหลัง
         ต้องแยกออกว่า "แอดมินกดปุ่มเอง" กับ "เปิดห้องแล้วระบบดึงให้" คนละเรื่อง
         ⚠️ ไม่ส่ง trigger = ยังเป็น `manual_refresh` เหมือนเดิม ของเก่าไม่ขยับ */
      await this.customToolService.getCombinedData(member.line_user_id, hook, {
        logSource:
          dto.trigger === 'chat_opened' ? 'chat_opened' : 'manual_refresh',
        /* [FEAT-20261016-CUSTCACHE] an admin asked for fresh data: always call the partner,
           and keep what it said so the bot's next answer agrees with the screen (loan only) */
        customerCache: 'refresh',
      });
    } catch (callErr: unknown) {
      // Upstream down / timeout → the stored copy is still intact. No 500: the
      // panel can still show what it has (legacy:254-259).
      this.logger.error(
        `[MANUALREFRESH] upstream call failed: ${(callErr as Error).message}`,
      );
      reason = 'upstream_error';
    }

    // Legacy also drops its 10s getRawProfile cache for this member here. That
    // cache was not ported (getRawProfile reads Mongo every time), so there is
    // nothing to invalidate — the re-read below is already the fresh row.
    const fresh = await this.memberModel
      .findById(id, 'raw_profile_data profile_data_updated_at')
      .lean();
    const data = fresh?.raw_profile_data || null;
    // Did anything actually move? Lets the caller tell "upstream answered with
    // the same numbers" from "upstream answered at all" without guessing.
    const changed =
      JSON.stringify(data) !== JSON.stringify(member.raw_profile_data || null);
    return this.stampedProfile({
      success: true,
      data,
      refreshed: !reason,
      changed,
      reason,
      // Read AFTER the call, so it is the new stamp on success. On failure
      // getCombinedData wrote nothing and this is still the previous one.
      profile_data_updated_at: fresh?.profile_data_updated_at
        ? new Date(fresh.profile_data_updated_at).toISOString()
        : null,
    });
  }

  /**
   * ⚠️⚠️ [TEST-20260820-DEVREMOVE] TESTING TOOL — NOT A PRODUCT FEATURE ⚠️⚠️
   * ===========================================================================
   * This wipes `raw_profile_data`, which is what makes a customer count as
   * REGISTERED everywhere in the system. Clearing it puts them back to
   * "never registered": the follow-up flow starts chasing them again, the bot
   * answers them as an unlinked customer, and the dashboard shows no profile.
   * That is exactly what a developer needs to re-run the registration flow on a
   * real account, and exactly what must never happen to a live customer by
   * accident. ลบแล้วลูกค้ากลับไปเป็น "ยังไม่ลงทะเบียน" ทั้งระบบ.
   *
   * ── WHY THE CHECK IS HERE AND NOT ONLY IN THE DASHBOARD ──────────────────
   * The button is hidden in the FE for everyone but `dev`. Hiding is NOT a
   * guard: anyone can open devtools, unhide the element and click it, or call
   * this route with `curl` and a valid session. The username below is read from
   * the JWT the auth guard already verified — a signed HttpOnly cookie the
   * browser cannot edit — so this is the line that actually decides.
   * ซ่อนปุ่มไม่ใช่การป้องกัน · ด่านจริงอยู่บรรทัดนี้ · JWT ปลอมไม่ได้.
   *
   * ── HOW TO TURN IT ON / OFF FOR REAL ─────────────────────────────────────
   * ON  (today): `DEV_REMOVE_USERNAMES` unset ⇒ falls back to `dev` only.
   * WIDEN:       set `DEV_REMOVE_USERNAMES=dev,dev2` in the environment. Comma
   *              separated, case-insensitive, whitespace ignored. No deploy of
   *              this file is needed.
   * OFF completely — the state to ship to production:
   *              set `DEV_REMOVE_USERNAMES=` (empty). An empty list matches
   *              nobody, so every caller gets 403 including `dev`. The route
   *              stays mounted and the FE keeps hiding the button; nothing else
   *              changes. ปิดสนิท = ตั้งค่าว่าง ⇒ ไม่มีใครเรียกได้เลย.
   *
   * ── HOW TO REMOVE THE TOOL ENTIRELY ──────────────────────────────────────
   *   1. delete this doc block and the `DEV_REMOVE` guard below (down to the
   *      `ensureMemberInScope` call, which is the original first line)
   *   2. delete `DEV_REMOVE_USERNAMES` from `src/config/env.schema.ts`
   *   3. in `omnidesk-console/components/member/PersonalPanel.tsx`, put the
   *      button back behind `{false && (` — the marker there says how
   *   4. delete `z-test/unit/dev-remove-guard.spec.ts`
   * The route then behaves exactly as it did before 2026-08-20: permission-only,
   * available to any `ticket.manage` holder. ถอดออกแล้วกลับเป็นของเดิมเป๊ะ.
   *
   * revert: see "HOW TO REMOVE THE TOOL ENTIRELY" above.
   */
  public async clearRawProfile(
    id: string,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid Member ID');
    }
    /* [TEST-20260820-DEVREMOVE] the real gate — see the doc above. Checked
       BEFORE the OA-scope check so a refusal never depends on which OAs the
       caller can see, and never reveals whether the member exists. */
    assertDevRemoveAllowed(auth);
    await this.ensureMemberInScope(auth, id);
    /* [FEAT-20260825-CLEAREDAT] ⭐ ONE WRITE, NOT TWO. The wipe and the stamp
       that records it go in the SAME `updateOne`, so there is no instant in
       which the profile is gone while the timestamp still says it is not — a
       crash between two separate writes would leave a row that was cleared with
       no record of when, and that is unrecoverable after the fact.

       The stamp is `new Date()` at the moment of the write. Nothing reads this
       column yet (owner, 25/08: *"ยังไม่ใช้อะไร ทำไว้เผื่อเฉย ๆ"*) — it exists
       so the answer is already on disk when the question is finally asked.

       ⚠️ NOT a registration-status column: a customer can be cleared and then
       register again, at which point this is stale history, not current state.
       "Has this customer registered?" is answered by `raw_profile_data` being
       present and non-empty — [DOC-20260825-REGSTATUS] in
       `chat/config/member-config.registry.ts`.
       ⚠️ It is written only on THIS route, which `assertDevRemoveAllowed` above
       already restricts to developers. A refusal returns before this line, so a
       rejected attempt leaves no trace claiming the profile was wiped.

       revert: drop the `$set` clause (leave the `$unset` exactly as it was),
       then the prop + index in member.schema.ts, the ledger entry in
       member-config.registry.ts and z-test/unit/raw-profile-cleared-at.spec.ts. */
    const r = await this.memberModel.updateOne(
      { _id: id },
      {
        $unset: { raw_profile_data: '' },
        $set: { raw_profile_cleared_at: new Date() },
      },
    );
    if (r.matchedCount === 0) {
      throw new NotFoundException('Member not found');
    }
    return { success: true, cleared: r.modifiedCount > 0 };
  }

  /**
   * ⚠️ A malformed `hookId` is **200**, not 400 — the opposite of the other
   * id-taking routes. Legacy's `resolveSiteRulesTarget`
   * (legacy-api/src/controllers/chat/memberController.js:309-323) returns
   * `{ error: "Invalid hook_id", status: 400 }`, but `getHookSiteRules`
   * (memberController.js:373-379) *ignores that status* and renders every
   * resolver failure as `res.json({ success: true, data: null, reason })`.
   * The comment there says why: the site-rules card is optional UI, and the
   * panel decides whether to draw it by checking `data === null`. A 4xx would
   * make the dashboard surface an error banner for a card that is merely
   * absent. So the guard stays — it still keeps the CastError from reaching
   * Mongoose — but it answers with the soft-failure envelope legacy sends.
   */
  /* 🔴 [FIX-20260906-HOOKSCOPE · NOT APPLIED HERE, ON PURPOSE]
     This route and its `refresh` sibling take a hook id from the URL and scope it
     against nothing: `ticket.manage` says what a caller may DO, not which OA they
     may do it TO. An operator can read — and force a refresh of, which spends that
     OA's upstream call — any OA's site rules with an id lifted from any screen
     that renders one.
     WHY IT IS LEFT: it is not this lane's doing (`dev` carries the same two
     signatures verbatim), the review that raised it split 3:1 with the dissent
     calling it deliberate parity, and closing it turns every existing caller that
     holds no `auth` into a 403 — three specs in other lanes go red on the spot.
     That is an owner's decision about who may see what, not a merge cleanup.
     ⇒ Fix alongside the FE work that supplies the caller, not here.
     The sibling that WAS closed is `refreshRawProfile` (see `ensureHookInScope`):
     unanimous in review, and its hook id arrives in the BODY of a route that
     already scopes the member. ปิดตัวที่ชัดและถูกเลนนี้ทำ ตัวที่เป็นของเดิมยกให้เจ้าของตัดสิน */
  public async getHookSiteRules(
    hookId: string,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(hookId)) {
      return this.stamped({
        success: true,
        data: null,
        reason: 'Invalid hook_id',
        domain_name: null,
      });
    }
    /* [FEAT-20261018-SITERULESWORLD] no site-rules world on this site (loan) ⇒ the same soft
       "no card" envelope as a missing hook — even if an old copy sits in `raw_site_rules_data`.
       Checked AFTER the id guard so a malformed id keeps its own reason (site-rules-invalid-id
       spec). shop-api declares nothing ⇒ never taken. */
    if (!providerFeatureOn('siteRules')) {
      return this.stamped({
        success: true,
        data: null,
        reason: 'Site rules are off for this provider',
        domain_name: null,
      });
    }
    const hook = await this.hookModel.findById(hookId).lean();
    if (!hook) {
      return this.stamped({
        success: true,
        data: null,
        reason: 'Hook not found',
        domain_name: null,
      });
    }
    return this.stamped({
      success: true,
      /* [SEC-20260825-SITERULESMASK] ปิดบัง `account_number` / `ref_id` ก่อนออก
         จากเซิร์ฟเวอร์ · เจ้าของกำชับว่า "ต้องไม่หลุดใน get / response / inspect"
         ⇒ ซ่อนฝั่งหน้าจออย่างเดียวไม่พอ เพราะค่าเต็มยังติดไปกับ response
         🔴 จุดนี้เป็นคอขวดของทั้งสองเส้น — `refreshHookSiteRules` ก็ `return`
            เมธอดนี้ต่อ · ถ้าวันหลังมีเส้นที่สามที่ส่งคอลัมน์นี้ออก ต้องเรียกตัวปิด
            บังนี้ด้วย ไม่งั้นรั่วเงียบ
         ⚠️ ปิดเฉพาะสำเนาที่ส่งออก ไม่แตะค่าในฐาน ⇒ ตรรกะภายในที่อ่านก้อนนี้
            (เช่นตัวเช็ค notice ที่ดู `status`/`is_view`) ไม่ถูกกระทบ */
      data: redactSiteRules(
        (hook as unknown as { raw_site_rules_data?: unknown })
          .raw_site_rules_data || null,
      ),
      domain_name: hook.domain_name || null,
      endpoint_key: 'site_rules',
      cache_ttl_sec: 0,
      cached: false,
      cached_at: new Date().toISOString(),
      site_rules_updated_at: (
        hook as unknown as { site_rules_updated_at?: Date }
      ).site_rules_updated_at
        ? new Date(
            (hook as unknown as { site_rules_updated_at: Date })
              .site_rules_updated_at,
          ).toISOString()
        : null,
      ttl_ms: 1800000,
    });
  }

  /**
   * ⚠️ Same resolver, DIFFERENT failure contract from the GET above — do not
   * "unify" them. Legacy `refreshHookSiteRules`
   * (legacy-api/src/controllers/chat/memberController.js:419-422) honours the
   * resolver's status: `res.status(t.status || 400).json({ success: false,
   * error })`. Refresh is an explicit operator action on a button, so a bad id
   * is a real error worth showing; the GET is a passive card paint, where the
   * same input is merely "nothing to draw". Hence 400 here, 200 there.
   */
  public async refreshHookSiteRules(
    hookId: string,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(hookId)) {
      // `{success:false,error}`, not the bare `{error}` the filter defaults to
      // — legacy sends the full envelope here and the card's refresh button
      // branches on `success`. AllExceptionsFilter passes a pre-shaped body
      // through untouched (see its `isPreShapedEnvelope`).
      throw new BadRequestException({
        success: false,
        error: 'Invalid hook_id',
      });
    }
    /* 🔴 [FIX-20260906-HOOKSCOPE · NOT APPLIED HERE] — same reasoning as the
       reader above, and worse consequences: this path SPENDS the OA's own upstream
       call, so an unscoped caller can make one OA pay for another's refresh.
       Left for the same three reasons stated there. */

    /* [FEAT-20260814-SITERULESCACHE] The button now actually reaches the fetch
       path. Before this it returned `getHookSiteRules()` — a plain read of the
       `raw_site_rules_data` column — so pressing Refresh could never obtain a
       newer value than the page already had, whatever the FE comment claimed.
       ปุ่มเดิมอ่านค่าเก่าเฉย ๆ ไม่เคยไปแตะเส้น fetch เลย

       ⚠️ NOT a force-refresh (owner, 2026-08-13): this walks the SAME road as a
       member's inbound message — cache warm ⇒ cached value, cache cold ⇒ this
       caller may be the one that fetches. No caller is privileged. Pressing the
       button repeatedly therefore cannot spend more upstream quota than a
       member would. See SITE-RULES-CACHE-PLAN §3.6 for how to add a real force
       path later if that is ever wanted. กติกาเดียวกับทุกคน ไม่มีใครลัดคิว

       ⚠️ Never throws: `getCombinedData` already swallows its own failures, and
       the read below is the exact call this method made before, so a failed
       warm-up degrades to the old behaviour rather than erroring the button.
       revert: delete this block, leaving `return this.getHookSiteRules(hookId)`. */
    try {
      const hook = await this.hookModel.findById(hookId).lean();
      /* [FEAT-20261018-SITERULESWORLD] no site-rules world (loan) ⇒ no warm-up: nothing to
         fetch, and no partner login for nothing. The read below answers the soft "no card". */
      if (
        providerFeatureOn('siteRules') &&
        hook?.custom_tool_status === true &&
        hook?.custom_tool_id
      ) {
        // `getCombinedData` writes `raw_site_rules_data` on a successful fetch,
        // which is what the read below then returns. An empty user id is fine:
        // site rules are per hook, and the identity only shapes per-member
        // endpoints, which this call is not here for.
        /* `logSource` matters: without it every WebhookLog row this writes is
           stamped `webhook_prefetch` (the default at custom-tool.service.ts:1384),
           so an operator reading the log could not tell a button press from a
           customer's message. ไม่ใส่ = log โกหกว่ามาจาก webhook */
        await this.customToolService.getCombinedData('', hook, {
          logSource: 'site_rules_panel_refresh',
        });
      }
    } catch {
      /* fall through to the stored copy — exactly what this method did before */
    }

    return this.getHookSiteRules(hookId);
  }
}
