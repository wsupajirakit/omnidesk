import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { escapeRegex } from '@/common/utils/escape-regex';
import { CryptoService } from '@/infra/crypto';

import { coerceString } from './coerce-string';
import { validateConfig } from './config-store';
import type { ListTargetsQueryDto } from './dto';
import { HandoffOaAccessService } from './handoff-oa-access.service';
import {
  HandoffTarget,
  type HandoffTargetDocument,
} from './schemas/handoff-target.schema';

/**
 * LIFTED — pending rewrite.
 *
 * Source: legacy-api/src/controllers/handoff/handoffTargetController.js
 *
 * CRUD over the outbound targets. Kept as one straight port so it can be diffed
 * against the live legacy backend; splitting it is only safe once the golden
 * cases are green (check-list.md §"Accepted debt").
 */

/**
 * Secrets that must never leave the API in cleartext.
 *
 * Mirrors the model layer's SENSITIVE_FIELDS. Every response sends
 * `has_<field>` booleans instead, so the dashboard can show "a secret is set"
 * without the secret ever crossing the wire.
 */
const SECRET_FIELDS = [
  'auth_secret',
  'auth_password',
  'auth_client_secret',
  'inbound_secret',
  'inbound_password',
  'oauth_access_token',
] as const;

/**
 * Fields a client may never set through create or update.
 *
 * Secrets are in this list because they are applied separately by
 * `applySecrets` — letting them through `flatten` would write them unencrypted.
 */
const IMMUTABLE_ON_UPDATE = new Set<string>([
  'key',
  '_id',
  'created_at',
  'updated_at',
  'deleted_at',
  'breaker',
  ...SECRET_FIELDS,
]);

/** A target as returned to a client: no raw secrets, `has_*` flags instead. */
export type PublicTarget = Record<string, unknown>;

export interface ListTargetsResult {
  data: PublicTarget[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

/** Raised where legacy answers a specific status with an `{error}` body. */
export class TargetError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

@Injectable()
export class HandoffTargetService {
  constructor(
    @InjectModel(HandoffTarget.name)
    private readonly targetModel: Model<HandoffTarget>,
    private readonly oaAccess: HandoffOaAccessService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Public projection: drop raw secrets, expose `has_<field>` booleans.
   *
   * `flattenMaps` turns the `config` Map into a plain object. Without it
   * `JSON.stringify` emits `{}` for a Map and the config silently disappears
   * from the response — a real defect legacy carries a comment about. Lean
   * documents skip `toObject` entirely, so the Map is normalised defensively
   * on that path too.
   */
  private toPublic(
    doc: HandoffTargetDocument | Record<string, unknown>,
  ): PublicTarget {
    const source =
      typeof (doc as HandoffTargetDocument).toObject === 'function'
        ? ((doc as HandoffTargetDocument).toObject({
            flattenMaps: true,
          }) as Record<string, unknown>)
        : { ...(doc as Record<string, unknown>) };

    if (source['config'] instanceof Map) {
      source['config'] = Object.fromEntries(
        source['config'] as Map<string, unknown>,
      );
    }

    for (const field of SECRET_FIELDS) {
      source[`has_${field}`] = Boolean(source[field]);
      delete source[field];
    }
    return source;
  }

  /**
   * Flattens a nested body to dot-paths.
   *
   * `doc.set()` on a dot-path updates one leaf; setting a whole nested object
   * replaces it and wipes its siblings. Patching `condition.min_amount` alone
   * must not clear `condition.allow_duplicate`. Arrays are set whole, on
   * purpose — a partial array patch has no sensible meaning here.
   */
  private flatten(
    input: unknown,
    prefix = '',
    out: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const source =
      input && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};

    for (const [key, value] of Object.entries(source)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof Date)
      ) {
        this.flatten(value, path, out);
      } else {
        out[path] = value;
      }
    }
    return out;
  }

  /**
   * Encrypts and applies any secret the caller resent.
   *
   * A field the caller did not send is left untouched, so editing a target
   * without retyping its secrets keeps them. An explicitly empty value clears
   * the stored secret — that is the only way to unset one.
   */
  private applySecrets(
    doc: HandoffTargetDocument,
    body: Record<string, unknown>,
  ): void {
    for (const field of SECRET_FIELDS) {
      if (body[field] === undefined) continue;
      const value = coerceString(body[field]);
      doc.set(field, value ? this.crypto.encrypt(value) : '');
    }
  }

  async list(
    query: ListTargetsQueryDto,
    user?: AuthenticatedUser,
  ): Promise<ListTargetsResult> {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 200);

    // Soft delete: removed targets stay in the collection but never in a list.
    const filters: Record<string, unknown> = { deleted_at: null };
    const and: Array<Record<string, unknown>> = [];

    if (query.search) {
      const pattern = new RegExp(escapeRegex(String(query.search).trim()), 'i');
      filters['$or'] = [
        { key: pattern },
        { name: pattern },
        { endpoint_url: pattern },
      ];
    }
    if (query.enabled === 'true') filters['enabled'] = true;
    if (query.enabled === 'false') filters['enabled'] = false;

    /*
     * Optional narrowing to one OA — "which targets apply to THIS OA".
     *
     * [CHANGE-20260807-BINDREQUIRED] An unbound target no longer matches. It
     * used to, because empty bindings meant "every OA"; the owner changed that
     * intent on 2026-08-07 and an unbound target now reaches nobody, so listing
     * it here would claim it is live for this OA when it fires for no one.
     * Mirrors the runtime gate — legacy `services/handoff/index.js:oaEnabled`.
     */
    if (query.hook_id && Types.ObjectId.isValid(query.hook_id)) {
      const hookId = new Types.ObjectId(query.hook_id);
      and.push({ 'scope.bindings.hook_id': hookId });
    }

    /*
     * OA scoping. `null` means super — no restriction.
     *
     * ⚠️ An unbound target IS still visible here, and that is deliberate even
     * though the filter above no longer matches it. The two answer different
     * questions: above is "does this target apply to this OA" (now: no), this
     * is "may this operator SEE the target at all". A freshly created target
     * starts with no bindings, so hiding it would leave it invisible to every
     * non-super user and nobody could ever bind it — an orphan by construction.
     *
     * Same reason visibility ignores the per-OA `enabled` flag: an operator has
     * to be able to see a target in order to re-enable it.
     */
    const allowed = await this.oaAccess.getAllowedHookIds(user);
    if (allowed !== null) {
      and.push({
        $or: [
          { 'scope.bindings': { $size: 0 } },
          {
            'scope.bindings.hook_id': {
              $in: allowed.map((id) => new Types.ObjectId(id)),
            },
          },
        ],
      });
    }

    if (and.length) filters['$and'] = and;

    const [items, total] = await Promise.all([
      this.targetModel
        .find(filters)
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.targetModel.countDocuments(filters).exec(),
    ]);

    return {
      data: items.map((item) => this.toPublic(item)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  /**
   * A malformed id is NOT pre-validated here, deliberately.
   *
   * Legacy runs the query regardless and lets Mongoose's cast failure reach its
   * catch-all, which answers `500 { error: "Cast to ObjectId failed for value
   * ... }`. Adding an `isValidObjectId` guard would answer 400 instead — a
   * cleaner API, and a parity break on both status and body. The cast message
   * contains only the value the caller themselves sent, so echoing it leaks
   * nothing. Chains DO pre-validate (`bad id`, 400) because legacy does there;
   * the two differ and both are copied as found.
   */
  async getById(id: string): Promise<{ data: PublicTarget }> {
    // 500: legacy getTarget's own catch (handoffTargetController.js:174).
    const doc = await this.runOrWrapCastError(500, () =>
      this.targetModel.findOne({ _id: id, deleted_at: null }).exec(),
    );
    if (!doc) throw new TargetError(404, 'target not found');
    return { data: this.toPublic(doc) };
  }

  /**
   * Mirrors the legacy handler's outer `catch` for anything the handler did not
   * anticipate — in practice a Mongoose cast failure on a malformed id.
   *
   * The status is a PARAMETER because legacy does not use one status here: each
   * handler carries its own `catch`, and they disagree on purpose.
   *
   *   getTarget    → `res.status(500)`  (handoffTargetController.js:174)
   *   updateTarget → `res.status(400)`  (handoffTargetController.js:255)
   *   deleteTarget → `res.status(400)`  (handoffTargetController.js:270)
   *
   * This was previously hardcoded to 500 for all three, which made a malformed
   * id on PUT and DELETE answer 500 where legacy answers 400. Verified against
   * the running legacy backend, not inferred from the source.
   */
  private async runOrWrapCastError<T>(
    status: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new TargetError(status, (error as Error).message);
    }
  }

  async create(body: Record<string, unknown>): Promise<{ data: PublicTarget }> {
    const key = coerceString(body['key']).trim();

    // Charset is validated before any database access, so a malformed key
    // never costs a query.
    if (!/^[a-z0-9_-]{1,64}$/.test(key)) {
      throw new TargetError(400, 'key must match /^[a-z0-9_-]{1,64}$/');
    }
    const envTag = body['env_tag'];
    if (!envTag || !['dev', 'prod'].includes(coerceString(envTag))) {
      throw new TargetError(400, 'env_tag must be dev or prod');
    }

    // Reject a duplicate live key up front; the partial-unique index is the
    // second line of defence against a race.
    const duplicate = await this.targetModel
      .findOne({ key, deleted_at: null })
      .select('_id')
      .lean()
      .exec();
    if (duplicate) throw new TargetError(409, 'key already exists');

    const seed: Record<string, unknown> = { ...body, key };

    if (body['config'] !== undefined) {
      const validated = validateConfig(body['config']);
      if (!validated.ok) {
        throw new TargetError(400, 'invalid config', validated.errors);
      }
      seed['config'] = validated.value;
    }

    // Build without raw secrets, then encrypt and apply them separately.
    for (const field of SECRET_FIELDS) delete seed[field];

    const doc = new this.targetModel(seed);
    this.applySecrets(doc, body);

    try {
      await doc.save();
    } catch (error) {
      // A duplicate slipping past the check above lands here via the index.
      if ((error as { code?: number }).code === 11000) {
        throw new TargetError(409, 'key already exists');
      }
      throw new TargetError(400, (error as Error).message);
    }

    return { data: this.toPublic(doc) };
  }

  async update(
    id: string,
    rawBody: Record<string, unknown>,
  ): Promise<{ data: PublicTarget }> {
    // 400: legacy updateTarget's own catch (handoffTargetController.js:255) —
    // NOT the 500 that getTarget uses. The two handlers differ in legacy.
    const doc = await this.runOrWrapCastError(400, () =>
      this.targetModel.findOne({ _id: id, deleted_at: null }).exec(),
    );
    if (!doc) throw new TargetError(404, 'target not found');

    const body: Record<string, unknown> = { ...rawBody };
    for (const key of IMMUTABLE_ON_UPDATE) delete body[key];

    /*
     * `config` is a Map and must be validated and replaced whole. It is kept
     * out of `flatten` deliberately: flattening would turn it into
     * `config.<key>` dot-paths and bypass validation entirely.
     */
    if (body['config'] !== undefined) {
      const validated = validateConfig(body['config']);
      if (!validated.ok) {
        throw new TargetError(400, 'invalid config', validated.errors);
      }
      doc.set('config', validated.value);
      delete body['config'];
    }

    doc.set(this.flatten(body));
    this.applySecrets(doc, rawBody);

    try {
      await doc.save();
    } catch (error) {
      throw new TargetError(400, (error as Error).message);
    }

    return { data: this.toPublic(doc) };
  }

  /** Soft delete — the row is never removed, so history keeps resolving. */
  async remove(
    id: string,
  ): Promise<{ data: { _id: Types.ObjectId; deleted_at: Date } }> {
    // 400: legacy deleteTarget's own catch (handoffTargetController.js:270).
    const doc = await this.runOrWrapCastError(400, () =>
      this.targetModel.findOne({ _id: id, deleted_at: null }).exec(),
    );
    if (!doc) throw new TargetError(404, 'target not found');

    const deletedAt = new Date();
    doc.set('deleted_at', deletedAt);
    try {
      await doc.save();
    } catch (error) {
      throw new TargetError(400, (error as Error).message);
    }

    return { data: { _id: doc._id, deleted_at: deletedAt } };
  }
}
