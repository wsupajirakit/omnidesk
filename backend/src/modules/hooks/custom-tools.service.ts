/**
 * Custom tools — CRUD, usage and OA assignment.
 *
 * Ported from legacy-api/src/controllers/hook/customToolController.js.
 *
 * The rules this file preserves, all of them load-bearing:
 *   - `password` / `api_key` are encrypted before storage and NEVER returned.
 *     Responses carry `has_password` / `has_api_key` booleans instead, which is
 *     all the form needs in order to show "configured".
 *   - delete is always soft (`deleted_at`), because hooks may still reference
 *     the row and deletions must stay traceable. Every query filters on
 *     `deleted_at: null`.
 *   - every mutation writes an audit entry, and an audit failure never fails
 *     the request.
 *   - the hook→tool link lives only on `Hook.custom_tool_id`. There is no
 *     `oa_ids[]` copy on the tool, so the two can never disagree.
 */

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { CryptoService } from '@/infra/crypto';

import {
  type AuditChange,
  type AuditRequestMetaInput,
  HookAuditLogService,
  actorObjectId,
  buildActor,
} from './hook-audit-log.service';
// [FIX-20260812-ASSIGNCACHE] same-module service (HooksModule provides both) —
// inject ตรง ไม่มี circular. ใช้ invalidate hook cache หลัง assign เขียน custom_tool_id.
import { HookCacheService } from './hook-cache.service';
import { toScalarString } from './coerce';
import {
  HMAC_DEFAULTS,
  // [FEAT-20260815-WALLETPAYCAT] revert: drop this import with the list filter.
  TOOL_CATEGORIES,
  deriveCategory,
  normalizeEndpoints,
  // [FEAT-20260808-PAYTOOL-P2] revert: drop this import.
  normalizePayment,
  sanitizeHmac,
} from './custom-tool-normalize';
import { assertCustomToolConfig } from './custom-tool-validate';
import {
  CustomTool,
  type CustomToolDocument,
} from './schemas/custom-tool.schema';
import { Hook } from './schemas/hook.schema';

const AUDIT_PARENT = 'custom_tool';

/**
 * [FEAT-20260815-WALLETPAYCAT] Which categories carry the revisable `payment` block.
 *
 * Both money categories do: `'payment'` reads the topup knobs, `'walletpay'` reads
 * `walletpay_ref_id_field` / `walletpay_file_field` / `statement_status`. They live in
 * the same sub-document, so a walletpay tool without this block has no config at
 * all — its settings would be dropped on the very next save.
 *
 * ONE list, referenced at both the create and the update site, because those two
 * drifting apart is exactly how a knob gets written on create and silently lost
 * on edit. A future money category is one entry here, not another `||`.
 *
 * revert: inline `category === 'payment'` back at both call sites.
 */
const CATEGORIES_WITH_PAYMENT_BLOCK: readonly string[] = [
  'payment',
  'walletpay',
];

/**
 * [FIX-20260815-ASSIGNSCOPE] Which hook field each tool category binds through.
 *
 * A hook holds three independent tool references, one per job, and every one is
 * read by a different consumer:
 *
 *   custom_tool_id  → profile / site-rules / customer-link  (webhook.service.ts:1429)
 *   payment_tool_id → topup                                 (payment-runner.service.ts:611)
 *   walletpay_tool_id  → walletpay leg                            (payment-runner.service.ts:1435)
 *
 * `assign` writes exactly one of them, chosen here. Before this map it always
 * wrote the first, which meant the last tool saved took every OA's
 * `custom_tool_id` — including from a tool that had nothing to do with profiles,
 * silently breaking the webhook's profile lookup.
 *
 * A map rather than a chain of `if`s so a fourth money category is one entry,
 * and so the id and its status switch can never be paired up wrongly.
 */
const BINDING_BY_CATEGORY: Record<
  string,
  { idField: string; statusField: string }
> = {
  generic: { idField: 'custom_tool_id', statusField: 'custom_tool_status' },
  payment: { idField: 'payment_tool_id', statusField: 'payment_tool_status' },
  walletpay: {
    idField: 'walletpay_tool_id',
    statusField: 'walletpay_tool_status',
  },
};

const LIST_LIMIT_DEFAULT = 25;
const LIST_LIMIT_MAX = 200;

// [FEAT-20260808-P3TOOLCACHE] Per-process 60s cache for the hook→tool
// resolution, ported from legacy customToolService.js:46 (`TOOL_CACHE_TTL_MS`).
// Perf only: the webhook consults getToolForHook on the hot path and this
// removes a Mongo round-trip per inbound. Behaviour-preserving because every
// CRUD mutation below calls `invalidateToolCache()` (legacy's `invalidate()`,
// wired into every write) so an edit takes effect at once — the ONLY observable
// effect of the cache is bounded (≤60s) staleness after a *direct DB* edit,
// exactly as in legacy. Cached value is the RAW lean tool doc or `null`.
// DB-EFFECT: none — in-process Map, no schema/write change; READS Mongo less.
const TOOL_CACHE_TTL_MS = 60 * 1000;
interface ToolCacheEntry {
  doc: LeanTool | null;
  expiresAt: number;
}

/** A row read with `.lean()` — an untyped bag of schema fields. */
type LeanTool = Record<string, unknown>;

export interface CustomToolListQuery {
  page?: string;
  limit?: string;
  search?: string;
  hook_id?: string;
  status?: string;
  // [FEAT-20260808-PAYTOOL-P1] optional filter by tool category. Absent ⇒ no
  // filter ⇒ list byte-identical to today. revert: drop this field + its use.
  category?: string;
}

export interface CustomToolBody {
  name?: unknown;
  description?: unknown;
  base_url?: unknown;
  auth_type?: unknown;
  username?: unknown;
  password?: unknown;
  api_key?: unknown;
  api_key_header?: unknown;
  hmac?: unknown;
  timeout_ms?: unknown;
  status?: unknown;
  endpoints?: unknown;
  // [FEAT-20260808-PAYTOOL-P1] tool-level category ('generic' | 'payment');
  // absent ⇒ schema default 'generic'. revert: drop this field + its wiring.
  category?: unknown;
  // [FEAT-20260808-PAYTOOL-P2] revisable payment knobs; stored only for a
  // payment tool. revert: drop this field + its wiring.
  payment?: unknown;
}

export interface AssignCustomToolBody {
  hook_ids?: unknown;
  activate?: unknown;
}

/** Escapes regex metacharacters — an operator-typed search box is untrusted
 * input for both correctness and ReDoS. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Mongo duplicate-key error, raised by the unique index on `name`. */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}

@Injectable()
export class CustomToolsService {
  constructor(
    @InjectModel(CustomTool.name)
    private readonly customToolModel: Model<CustomTool>,
    @InjectModel(Hook.name) private readonly hookModel: Model<Hook>,
    private readonly crypto: CryptoService,
    private readonly audit: HookAuditLogService,
    // [FIX-20260812-ASSIGNCACHE] invalidate hook cache หลัง assign เปลี่ยน custom_tool_id
    private readonly hookCache: HookCacheService,
  ) {}

  // [FEAT-20260808-P3TOOLCACHE] tool_id → { doc, expiresAt }. Keyed by the
  // hex string of the tool ObjectId, mirroring legacy's `toolCache` Map.
  private readonly toolCache = new Map<string, ToolCacheEntry>();

  /**
   * [FEAT-20260808-P3TOOLCACHE] Clears the per-process tool cache — legacy
   * `customToolService.invalidate()`. Called after every create/update/delete/
   * assign so a config change is visible immediately rather than after the TTL.
   * `toolId` omitted ⇒ clear all (matches legacy's `invalidate()` with no arg).
   */
  private invalidateToolCache(toolId?: string | Types.ObjectId | null): void {
    if (toolId) this.toolCache.delete(String(toolId));
    else this.toolCache.clear();
  }

  /**
   * Strips the two secrets and reports only whether each is set.
   *
   * This is the single exit point for a tool document. Adding a secret field to
   * the schema without adding it here ships it to every browser that opens the
   * tools page — `findLeakedSecrets` in the golden suite is the backstop.
   */
  private toPublic(doc: LeanTool | null): LeanTool | null {
    if (!doc) return null;
    const { password, api_key, ...rest } = doc;
    return { ...rest, has_password: !!password, has_api_key: !!api_key };
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/custom-tools
  // ─────────────────────────────────────────────────────────────────────

  async list(query: CustomToolListQuery): Promise<Record<string, unknown>> {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(
      Math.max(Number(query.limit) || LIST_LIMIT_DEFAULT, 1),
      LIST_LIMIT_MAX,
    );

    const filters: Record<string, unknown> = { deleted_at: null };

    if (query.search) {
      const rx = new RegExp(escapeRegex(String(query.search).trim()), 'i');
      filters['$or'] = [{ name: rx }, { description: rx }, { base_url: rx }];
    }

    // "Which tool does this OA use" is answered from the hook side, because the
    // tool holds no hook reference by design.
    if (query.hook_id && isValidObjectId(query.hook_id)) {
      const hook = await this.hookModel
        .findById(query.hook_id)
        .select('custom_tool_id')
        .lean<{ custom_tool_id?: unknown }>()
        .exec();
      // Not linked to any tool → `_id: null` matches nothing, which is the
      // honest answer rather than "every tool".
      filters['_id'] = hook?.custom_tool_id ?? null;
    }

    if (query.status === 'true') filters['status'] = true;
    if (query.status === 'false') filters['status'] = false;

    // [FEAT-20260808-PAYTOOL-P1] optional category filter. Only applied when the
    // caller sends a recognised value, so an absent/unknown param leaves the
    // query byte-identical to today. revert: drop this block.
    /* [FEAT-20260815-WALLETPAYCAT] read the whitelist rather than listing the
       members here, so a new category cannot be filterable in the schema but
       silently unfilterable through the API. */
    if (
      typeof query.category === 'string' &&
      (TOOL_CATEGORIES as readonly string[]).includes(query.category)
    ) {
      filters['category'] = query.category;
    }

    const [items, total] = await Promise.all([
      this.customToolModel
        .find(filters)
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('created_by', 'username display_name')
        .populate('updated_by', 'username display_name')
        .lean<LeanTool[]>()
        .exec(),
      this.customToolModel.countDocuments(filters).exec(),
    ]);

    return {
      data: items.map((item) => this.toPublic(item)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/custom-tools/:id
  // ─────────────────────────────────────────────────────────────────────

  async findOne(id: string): Promise<{ data: LeanTool | null }> {
    const item = await this.findActiveLean(id);
    if (!item) throw new NotFoundException('ไม่พบ custom tool');
    return { data: this.toPublic(item) };
  }

  /**
   * Legacy passes `:id` straight to `findOne`, so a malformed id raises a
   * Mongoose CastError which its try/catch answers as 500. Returning null here
   * would answer 404 instead — a difference the golden suite would catch — so
   * the invalid id is left to reach the model exactly as it does in legacy.
   */
  private async findActiveLean(id: string): Promise<LeanTool | null> {
    return this.customToolModel
      .findOne({ _id: id, deleted_at: null })
      .populate('created_by', 'username display_name')
      .populate('updated_by', 'username display_name')
      .lean<LeanTool>()
      .exec();
  }

  /**
   * [FEAT-20260808-PAYTOOL-P4] Resolves a `payment_tool_id` for the bulk
   * payment switch's enable-time readiness check.
   *
   * WHAT: returns the LIVE tool with this id, or null if it is missing,
   * soft-deleted, or switched off. The caller then checks `category`.
   *
   * WHY NOT REUSE `getToolForHook`: that one is keyed to the `custom_tool_*`
   * pair and serves its answer from a 60s cache. A money kill switch must not
   * be decided from a stale entry (same rule the payment runner follows with
   * `skipCache: true`), and this runs once per bulk request, not on the hot
   * path — so an uncached read is affordable. No `.populate()` either: the
   * caller needs `status`/`category`, not who created the tool.
   *
   * `status: true` + `deleted_at: null` are the two conditions every other
   * "active tool" query in this service applies; keeping them identical means a
   * tool that looks live in the tools list is exactly one that passes here.
   *
   * HOW TO CHANGE LATER: to allow binding a disabled tool, drop `status: true`
   * from the filter — the runner would still refuse it at dispatch time, so the
   * switch would go green on an OA that takes no payments.
   * revert: delete this method (its only caller is
   * `HooksService.assertPaymentTargetsReady`).
   */
  async findPaymentToolForBinding(id: string): Promise<LeanTool | null> {
    return this.customToolModel
      .findOne({ _id: id, deleted_at: null, status: true })
      .lean<LeanTool>()
      .exec();
  }

  /**
   * The tool a hook is wired to, or null — legacy `customToolService.getToolForHook`.
   *
   * Reuses `findActiveLean` rather than repeating the query, and then applies
   * the two rules that live in legacy's `getTool` and nowhere else:
   *
   *   - `custom_tool_status !== true` on the hook → null without loading
   *     anything. Ticking a tool and leaving the switch off means "not in use".
   *   - `tool.status === false` → null. Switching a tool off is deliberately a
   *     single kill switch: every OA referencing it stops immediately.
   *
   * ⚠️ Returns the RAW document, not `toPublic()`. Callers must project the
   * fields they need — this is the internal accessor, and `toPublic` is the
   * exit point for the CRUD responses. The one caller today (`getTagEndpoints`)
   * hand-builds a key/method/path projection and never forwards the document.
   *
   * [FEAT-20260808-P3TOOLCACHE] Ported: legacy caches the resolved tool (or
   * `null`) in a per-process Map for 60s (`TOOL_CACHE_TTL_MS`). This is a
   * latency optimisation on the webhook hot path; it is behaviour-preserving
   * because every CRUD mutation calls `invalidateToolCache()`, so the only
   * observable effect is bounded (≤60s) staleness after a *direct DB* edit —
   * identical to legacy. The cache keys on the tool id and stores the same
   * `null` that a disabled/soft-deleted tool resolves to.
   */
  async getToolForHook(hook: {
    custom_tool_status?: unknown;
    custom_tool_id?: unknown;
  }): Promise<LeanTool | null> {
    if (!hook || hook.custom_tool_status !== true) return null;
    // The stored value is an ObjectId; anything else on the document is
    // corrupt and is treated as "no tool" rather than stringified blindly.
    const raw = hook.custom_tool_id;
    const toolId =
      raw instanceof Types.ObjectId
        ? raw.toHexString()
        : typeof raw === 'string'
          ? raw
          : null;
    if (!toolId || !isValidObjectId(toolId)) return null;

    // Cache hit (fresh) → return the stored doc/null without touching Mongo.
    const hit = this.toolCache.get(toolId);
    if (hit && Date.now() < hit.expiresAt) return hit.doc;

    // Legacy swallows a load failure and answers null rather than 500; the
    // handler then returns its "tool ที่ลิงก์ไม่เจอ" warning shape. A load
    // FAILURE is not cached (legacy caches only resolved states), so a
    // transient DB blip does not pin `null` for 60s.
    let doc: LeanTool | null = null;
    try {
      doc = await this.findActiveLean(toolId);
    } catch {
      return null;
    }
    // Disabled / soft-deleted resolves to null and IS cached as null — legacy
    // stores `{ doc: null, expiresAt }` for this exact case so the kill switch
    // still short-circuits without a DB hit on the next inbound.
    const resolved = !doc || doc['status'] === false ? null : doc;
    this.toolCache.set(toolId, {
      doc: resolved,
      expiresAt: Date.now() + TOOL_CACHE_TTL_MS,
    });
    return resolved;
  }

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/custom-tools
  // ─────────────────────────────────────────────────────────────────────

  async create(
    body: CustomToolBody,
    user: AuthenticatedUser | undefined,
    meta: AuditRequestMetaInput,
  ): Promise<{ data: LeanTool | null }> {
    const name = body.name;
    const baseUrl = body.base_url;

    if (!name || !toScalarString(name).trim()) {
      throw new BadRequestException('ต้องระบุ name');
    }
    if (!baseUrl || !toScalarString(baseUrl).trim()) {
      throw new BadRequestException('ต้องระบุ base_url');
    }

    const actorId = actorObjectId(user);
    const endpoints = normalizeEndpoints(body.endpoints);
    const authType = body.auth_type
      ? toScalarString(body.auth_type)
      : 'jwt_login';
    /* [FIX-20260810-CATFROMROLE] category is DERIVED from the endpoint roles,
       not taken from the request. A tool carrying pay_topup/pay_walletpay IS a
       payment tool; anything else is generic. Previously the caller sent both
       and they were free to disagree — picking the payment role while the
       separate "หมวด" select still said generic produced a line the runner
       silently ignores (payment-runner.service.ts:532). One fact, one source.
       ⚠️ `body.category` is now ignored on create; the money kill switch is
          unchanged — resolvePaymentTool still gates on the stored value.
       revert: `const category = normalizeCategory(body.category);` */
    const category = deriveCategory(endpoints);

    // V8: legacy runs these in pre("validate"); the ported schema has no hooks.
    this.assertConfig(authType, endpoints, category);

    const payload = {
      name: toScalarString(name).trim(),
      description:
        body.description === undefined ? '' : toScalarString(body.description),
      // A trailing slash would produce `//path` on every call.
      base_url: toScalarString(baseUrl).trim().replace(/\/+$/, ''),
      auth_type: authType,
      username:
        body.username === undefined ? '' : toScalarString(body.username),
      // ⚠️ Always encrypted before it touches the database.
      password: body.password
        ? (this.crypto.encrypt(toScalarString(body.password)) ?? '')
        : '',
      api_key: body.api_key
        ? (this.crypto.encrypt(toScalarString(body.api_key)) ?? '')
        : '',
      api_key_header:
        body.api_key_header === undefined
          ? 'Authorization'
          : toScalarString(body.api_key_header),
      timeout_ms: Number(body.timeout_ms) || 8000,
      status: body.status !== false,
      // [FEAT-20260808-PAYTOOL-P1] additive; defaults 'generic' ⇒ same as today.
      category,
      endpoints,
      created_by: actorId,
      updated_by: actorId,
    };

    /**
     * ⚠️ `hmac` is attached ONLY when the caller sent one.
     *
     * Setting `hmac: undefined` on the payload is NOT the same as omitting the
     * key. Mongoose treats an explicitly-present `undefined` as "the caller
     * chose no value" and skips materialising the nested path, so the defaults
     * declared with `raw()` never apply and the document is written without an
     * `hmac` object at all. Legacy passes the same `undefined` but its schema
     * path is inline, so Mongo still stores the defaulted object.
     *
     * Caught by the golden diff as `missing: data.hmac` on POST — the created
     * tool came back without the key, and a form reading `hmac.algorithm` would
     * have thrown on every newly created tool.
     */
    (payload as Record<string, unknown>)['hmac'] = sanitizeHmac(body.hmac) ?? {
      ...HMAC_DEFAULTS,
    };

    // [FEAT-20260808-PAYTOOL-P2] attach the revisable payment block ONLY for a
    // payment tool, so a generic tool keeps no `payment` key (byte-identical).
    // revert: delete this block.
    /* [FEAT-20260815-WALLETPAYCAT] `'walletpay'` needs this block too.
       The knobs it holds are the ones the walletpay leg reads — `walletpay_ref_id_field`,
       `walletpay_file_field`, `statement_status`, `statement_provider_code`. Gating
       the block on `'payment'` alone would leave a dedicated walletpay tool with NO
       payment block at all, silently discarding the very settings the operator
       just configured. Found while planning: the category split and this line
       must ship together or the split breaks live config.
       revert: `if (category === 'payment')`. */
    if (CATEGORIES_WITH_PAYMENT_BLOCK.includes(category)) {
      const payment = normalizePayment(body.payment) ?? normalizePayment({});
      (payload as Record<string, unknown>)['payment'] = payment;
    }

    let created: CustomToolDocument;
    try {
      created = await this.customToolModel.create(
        payload as unknown as CustomTool,
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new BadRequestException('ชื่อ tool นี้ถูกใช้แล้ว');
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }

    // [FEAT-20260808-P3TOOLCACHE] mirror legacy invalidate-on-write.
    this.invalidateToolCache(created._id);

    const actor = buildActor(user);
    await this.audit.write({
      ref_id: created._id,
      parent: AUDIT_PARENT,
      action: 'create',
      changed_fields: [
        { field: 'name', from: null, to: created.name },
        { field: 'base_url', from: null, to: created.base_url },
        { field: 'auth_type', from: null, to: created.auth_type },
        { field: 'username', from: null, to: created.username },
        // Never the secret itself — only whether one was set.
        {
          field: 'password',
          from: null,
          to: created.password ? '(ตั้งค่าแล้ว)' : '(ว่าง)',
        },
        {
          field: 'api_key',
          from: null,
          to: created.api_key ? '(ตั้งค่าแล้ว)' : '(ว่าง)',
        },
        { field: 'timeout_ms', from: null, to: created.timeout_ms },
        { field: 'status', from: null, to: created.status },
        // [FEAT-20260808-PAYTOOL-P1] revert: drop this audit line.
        { field: 'category', from: null, to: created.category },
        {
          field: 'endpoints',
          from: null,
          to: created.endpoints.map((e) => `${e.key}:${e.method} ${e.path}`),
        },
      ],
      actor,
      request_meta: meta,
      note: `สร้าง custom tool: ${created.name} (โดย ${actor.display_name || actor.username})`,
    });

    return { data: this.toPublic(created.toObject() as unknown as LeanTool) };
  }

  // ─────────────────────────────────────────────────────────────────────
  // PUT /api/custom-tools/:id
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Field-by-field patch, mirroring legacy exactly.
   *
   * ⚠️ Secret convention: a field ABSENT from the body leaves the stored value
   * alone; a field present but empty CLEARS it. That distinction is the reason
   * the form can be saved without re-typing a password, so collapsing the two
   * would either wipe every secret on save or make one impossible to remove.
   */
  async update(
    id: string,
    body: CustomToolBody,
    user: AuthenticatedUser | undefined,
    meta: AuditRequestMetaInput,
  ): Promise<{ data: LeanTool | null }> {
    /*
     * The lookup is wrapped because legacy wraps the WHOLE handler in one
     * try/catch that answers `400 { error: error.message }`
     * (customToolController.js:326-403). A malformed `:id` fails the ObjectId
     * cast right here, and unwrapped it escapes to the global filter as a 500 —
     * where legacy answers 400 carrying the driver's own cast message.
     * Verified against the running legacy backend with `PUT
     * /api/custom-tools/probe_id`.
     */
    const doc = await (async () => {
      try {
        return await this.customToolModel
          .findOne({ _id: id, deleted_at: null })
          .exec();
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : String(error),
        );
      }
    })();
    if (!doc) throw new NotFoundException('ไม่พบ custom tool');

    const changed: AuditChange[] = [];
    const track = (field: string, from: unknown, to: unknown): void => {
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        changed.push({ field, from, to });
      }
    };

    if (body.name !== undefined) {
      const value = toScalarString(body.name).trim();
      track('name', doc.name, value);
      doc.name = value;
    }
    if (body.description !== undefined) {
      track('description', doc.description, body.description);
      doc.description = body.description as string;
    }
    if (body.base_url !== undefined) {
      const value = toScalarString(body.base_url).trim().replace(/\/+$/, '');
      track('base_url', doc.base_url, value);
      doc.base_url = value;
    }
    if (body.auth_type !== undefined) {
      track('auth_type', doc.auth_type, body.auth_type);
      doc.auth_type = body.auth_type as string;
    }
    if (body.username !== undefined) {
      track('username', doc.username, body.username);
      doc.username = body.username as string;
    }
    if (body.api_key_header !== undefined) {
      track('api_key_header', doc.api_key_header, body.api_key_header);
      doc.api_key_header = body.api_key_header as string;
    }
    if (body.timeout_ms !== undefined) {
      const value = Number(body.timeout_ms) || 8000;
      track('timeout_ms', doc.timeout_ms, value);
      doc.timeout_ms = value;
    }
    if (body.status !== undefined) {
      const value = body.status !== false;
      track('status', doc.status, value);
      doc.status = value;
    }
    /* [FIX-20260810-CATFROMROLE] category follows the endpoint roles.
       ⚠️ ORDER MATTERS — this runs BEFORE the `payment` block below and before
          `doc.endpoints` is written, because both read `doc.category`. Deriving
          from the INCOMING endpoints (falling back to the stored ones when the
          request does not touch them) is what lets a tool that just gained a
          pay_topup line receive its payment block in the SAME save. Moving this
          after either block reintroduces the two-step save the owner asked to
          remove — เพิ่มเส้น pay_topup แล้วกดบันทึกครั้งเดียวต้องพอ.
       ⚠️ `body.category` is ignored: the roles decide. An operator can no longer
          save a tool whose หมวด contradicts its own endpoints.
       revert: restore the `if (body.category !== undefined)` block that called
          normalizeCategory(body.category). */
    {
      const rolesForCategory =
        body.endpoints !== undefined
          ? normalizeEndpoints(body.endpoints)
          : doc.endpoints;
      const value = deriveCategory(rolesForCategory);
      if (value !== doc.category) {
        track('category', doc.category, value);
        doc.category = value;
      }
    }

    // ── Secrets: absent = untouched · present = re-encrypted or cleared ──
    if (body.password !== undefined) {
      const has = !!body.password;
      track(
        'password',
        doc.password ? '(ตั้งค่าแล้ว)' : '(ว่าง)',
        has ? '(เปลี่ยนใหม่)' : '(ล้างทิ้ง)',
      );
      doc.password = has
        ? (this.crypto.encrypt(toScalarString(body.password)) ?? '')
        : '';
    }
    if (body.api_key !== undefined) {
      const has = !!body.api_key;
      track(
        'api_key',
        doc.api_key ? '(ตั้งค่าแล้ว)' : '(ว่าง)',
        has ? '(เปลี่ยนใหม่)' : '(ล้างทิ้ง)',
      );
      doc.api_key = has
        ? (this.crypto.encrypt(toScalarString(body.api_key)) ?? '')
        : '';
    }
    if (body.hmac !== undefined) {
      const next = sanitizeHmac(body.hmac);
      track('hmac', JSON.stringify(doc.hmac || {}), JSON.stringify(next || {}));
      doc.hmac = next as never;
    }

    // [FEAT-20260808-PAYTOOL-P2] payment knobs: absent ⇒ untouched; present ⇒
    // whitelisted. A tool becoming 'payment' with no block sent gets the
    // defaulted block so the runner always has complete config. revert: drop.
    /* [FEAT-20260815-WALLETPAYCAT] same widening as the create path — see the note
       there. Both conditions move together; leaving either on `'payment'` alone
       drops the walletpay tool's knobs on the next save. */
    if (
      body.payment !== undefined ||
      CATEGORIES_WITH_PAYMENT_BLOCK.includes(doc.category)
    ) {
      const next =
        body.payment !== undefined
          ? (normalizePayment(body.payment) ?? normalizePayment({}))
          : doc.payment || normalizePayment({});
      if (next && CATEGORIES_WITH_PAYMENT_BLOCK.includes(doc.category)) {
        track(
          'payment',
          JSON.stringify(doc.payment || {}),
          JSON.stringify(next),
        );
        doc.payment = next;
      }
    }

    if (body.endpoints !== undefined) {
      const next = normalizeEndpoints(body.endpoints);
      track(
        'endpoints',
        doc.endpoints.map((e) => `${e.key}:${e.method} ${e.path}`),
        next.map((e) => `${e.key}:${e.method} ${e.path}`),
      );
      doc.endpoints = next as never;
    }

    // V8 again — the checks legacy performs in pre("validate") on save().
    this.assertConfig(
      doc.auth_type,
      doc.endpoints.map((e) => ({
        key: e.key,
        is_login: e.is_login,
        is_refresh: e.is_refresh,
        is_profile: e.is_profile,
        require_jwt: e.require_jwt,
        status: e.status,
        role: e.role,
        cache_ttl_sec: e.cache_ttl_sec ?? null,
      })),
      // [FEAT-20260808-PAYTOOL-P1] revert: drop this arg.
      doc.category,
    );

    doc.updated_by = actorObjectId(user);
    try {
      await doc.save();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new BadRequestException('ชื่อ tool นี้ถูกใช้แล้ว');
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }

    // [FEAT-20260808-P3TOOLCACHE] a config edit must take effect at once, not
    // after the 60s TTL — legacy invalidates here for exactly this reason.
    this.invalidateToolCache(doc._id);

    const actor = buildActor(user);
    await this.audit.write({
      ref_id: doc._id,
      parent: AUDIT_PARENT,
      action: 'update',
      changed_fields: changed,
      actor,
      request_meta: meta,
      note: `แก้ไข custom tool: ${doc.name} (โดย ${actor.display_name || actor.username})`,
    });

    return { data: this.toPublic(doc.toObject() as unknown as LeanTool) };
  }

  /** Shared wrapper turning a validation throw into legacy's 400 envelope. */
  private assertConfig(
    authType: string,
    endpoints: {
      key: string;
      is_login: boolean;
      is_refresh: boolean;
      is_profile: boolean;
      require_jwt: boolean;
      status: boolean;
      role: string;
      cache_ttl_sec?: number | null;
    }[],
    // [FEAT-20260808-PAYTOOL-P1] optional; forwarded to the validator.
    category?: string,
  ): void {
    try {
      assertCustomToolConfig(authType, endpoints, category);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // DELETE /api/custom-tools/:id
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Soft delete, refused while any OA still references the tool.
   *
   * Deleting a tool in use would break that OA at runtime with nothing to point
   * at, so the refusal names the OAs — otherwise the operator has to guess which
   * of dozens is holding the reference.
   */
  async remove(
    id: string,
    user: AuthenticatedUser | undefined,
    meta: AuditRequestMetaInput,
  ): Promise<void> {
    const doc = await this.customToolModel
      .findOne({ _id: id, deleted_at: null })
      .exec();
    if (!doc) throw new NotFoundException('ไม่พบ custom tool');

    /* [FIX-20260815-ASSIGNSCOPE] check the field this tool binds through, not
       always `custom_tool_id`. Otherwise a walletpay tool with live OAs reports
       "in use by 0" and the soft delete goes through, leaving `walletpay_tool_id`
       pointing at a deleted row. */
    const { idField } = await this.bindingFor(id);
    const inUse = await this.hookModel
      .find({ [idField]: id })
      .select('alias name line_oa_name')
      .lean<{ alias?: string; name?: string; line_oa_name?: string }[]>()
      .exec();

    if (inUse.length > 0) {
      throw new BadRequestException({
        error: `ลบไม่ได้ — ยังมี ${inUse.length} OA ใช้ tool นี้อยู่`,
        in_use_by: inUse.map((h) => h.alias || h.line_oa_name || h.name),
      });
    }

    doc.deleted_at = new Date();
    doc.deleted_by = actorObjectId(user);
    await doc.save();

    // [FEAT-20260808-P3TOOLCACHE] soft-delete = kill switch; drop the cached
    // entry so the next resolve sees it gone rather than serving a 60s-stale doc.
    this.invalidateToolCache(doc._id);

    const actor = buildActor(user);
    await this.audit.write({
      ref_id: doc._id,
      parent: AUDIT_PARENT,
      action: 'delete',
      changed_fields: [{ field: 'deleted_at', from: null, to: doc.deleted_at }],
      actor,
      request_meta: meta,
      note: `ลบ custom tool: ${doc.name} (soft delete โดย ${actor.display_name || actor.username})`,
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/custom-tools/:id/usage
  // ─────────────────────────────────────────────────────────────────────

  /**
   * [FIX-20260815-ASSIGNSCOPE] The hook fields a stored tool binds through.
   *
   * Reads the tool's own category, so every caller answers "which OAs use this"
   * against the SAME field `assign` writes. A soft-deleted or missing tool falls
   * back to the generic pair — the caller then finds nothing, which is the
   * honest answer rather than an exception on a read path.
   */
  private async bindingFor(
    id: string,
  ): Promise<{ idField: string; statusField: string }> {
    const doc = await this.customToolModel
      .findById(id)
      .select('category')
      .lean<{ category?: unknown }>()
      .exec();
    const category = String(doc?.category ?? 'generic');
    return BINDING_BY_CATEGORY[category] ?? BINDING_BY_CATEGORY['generic']!;
  }

  /** "Which OAs use this tool" — a query over hooks, never a stored copy. */
  async usage(id: string): Promise<Record<string, unknown>> {
    /* [FIX-20260815-ASSIGNSCOPE] ask the field this tool actually binds through.
       Counting `custom_tool_id` for every category is what made a walletpay tool
       with three live OAs report "0 OA" — it binds `walletpay_tool_id`, which this
       query never looked at. The screen and the runner now agree on where the
       link lives. */
    const { idField, statusField } = await this.bindingFor(id);
    const hooks = await this.hookModel
      .find({ [idField]: id })
      .select(`alias name line_oa_name group ${statusField}`)
      .populate('group', 'name')
      .lean<Record<string, unknown>[]>()
      .exec();

    return {
      data: {
        count: hooks.length,
        // Split out so the form shows which OAs are linked but switched off.
        active: hooks.filter((h) => h['custom_tool_status'] === true).length,
        hooks,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // PUT /api/custom-tools/:id/assign
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Tick many OAs at once from the tools page.
   *
   * REPLACE, not merge: whatever is ticked becomes the whole set, and OAs left
   * out are unlinked. This only ever writes `hook.custom_tool_id` — the same
   * single field an operator would set by opening each OA in turn.
   */
  async assign(
    id: string,
    body: AssignCustomToolBody,
    user: AuthenticatedUser | undefined,
    meta: AuditRequestMetaInput,
  ): Promise<Record<string, unknown>> {
    const tool = await this.customToolModel
      .findOne({ _id: id, deleted_at: null })
      .lean<LeanTool>()
      .exec();
    if (!tool) throw new NotFoundException('ไม่พบ custom tool');

    /* ==== [FIX-20260815-ASSIGNSCOPE] one binding field per tool CATEGORY ====
     *
     * A hook wires three tools through three separate fields, one per job:
     *   custom_tool_id  → profile / site-rules / customer-link
     *   payment_tool_id → topup      (payment-runner.service.ts:611)
     *   walletpay_tool_id  → walletpay leg (payment-runner.service.ts:1435)
     *
     * This method used to write the FIRST one for EVERY tool, as a REPLACE. So
     * saving the walletpay tool re-pointed every OA's `custom_tool_id` at it, and
     * saving Shop-API took them all back — the counts flipped 7/0 ↔ 0/7 on each
     * save (watched happen across four consecutive DB reads).
     *
     * ⚠️ THE COUNTER WAS NEVER THE DAMAGE. `webhook.service.ts:1429` resolves
     * the customer profile via `getToolForHook`, which reads `custom_tool_id`.
     * Once that pointed at the walletpay tool — which has no `is_profile` endpoint
     * — the webhook lost customerName / customerTel / contractCode with no
     * error anywhere. That is the "perm หาย" the owner reported.
     *
     * ⚠️ AND REFUSING TO WRITE IS NOT THE FIX EITHER. That was tried first and
     * reverted the same day: it left the operator ticking seven OAs, pressing
     * save, and watching the count stay at 0 — the feature removed rather than
     * repaired.
     *
     * So the category picks the field. Each tool now claims the binding that
     * belongs to its own job, and two tools can hold the same OA at once
     * because they no longer write to the same place.
     *
     * revert: replace the three consts below with the literals
     * `'custom_tool_id'` / `'custom_tool_status'` and drop `BINDING_BY_CATEGORY`.
     * เลือก field ตามหมวด = ผูกได้ทั้ง Shop-API และ walletpay พร้อมกัน ไม่แย่งกัน
     */
    const toolCategory = String(tool['category'] ?? 'generic');
    const binding =
      BINDING_BY_CATEGORY[toolCategory] ?? BINDING_BY_CATEGORY['generic']!;
    const idField = binding.idField;
    const statusField = binding.statusField;

    const requested = Array.isArray(body.hook_ids) ? body.hook_ids : [];
    const valid = requested
      .filter((h): h is string => typeof h === 'string' && isValidObjectId(h))
      .map(String);

    // Verify every id exists BEFORE writing anything — a half-applied
    // assignment leaves the operator with no way to tell what took effect.
    const found = await this.hookModel
      .find({ _id: { $in: valid } })
      .select('_id alias')
      .lean<{ _id: Types.ObjectId; alias?: string }[]>()
      .exec();
    if (found.length !== valid.length) {
      throw new BadRequestException('มี hook_id ที่ไม่มีอยู่จริงในรายการ');
    }
    const foundIds = found.map((h) => String(h._id));

    const beforeHooks = await this.hookModel
      .find({ [idField]: id })
      .select('_id alias')
      .lean<{ _id: Types.ObjectId; alias?: string }[]>()
      .exec();
    const beforeIds = beforeHooks.map((h) => String(h._id));

    const added = foundIds.filter((h) => !beforeIds.includes(h));
    const removed = beforeIds.filter((h) => !foundIds.includes(h));

    // Unlink first, clearing the switch too: leaving the status `true` on a hook
    // with no tool is a state nothing else knows how to read.
    if (removed.length > 0) {
      await this.hookModel
        .updateMany(
          { _id: { $in: removed } },
          { $set: { [idField]: null, [statusField]: false } },
        )
        .exec();
    }

    if (added.length > 0) {
      const set: Record<string, unknown> = { [idField]: id };
      if (body.activate === true) set[statusField] = true;
      await this.hookModel
        .updateMany({ _id: { $in: added } }, { $set: set })
        .exec();
    }

    // [FEAT-20260808-P3TOOLCACHE] assign only rewrites hook.custom_tool_id
    // (read fresh per inbound), not the tool doc — but legacy invalidates on
    // every write, so we drop this tool's entry to stay byte-identical.
    this.invalidateToolCache(id);

    const actor = buildActor(user);
    const aliasOf = (hookId: string): string => {
      const hook = [...found, ...beforeHooks].find(
        (h) => String(h._id) === hookId,
      );
      return hook?.alias || hookId;
    };

    // [FIX-20260812-ASSIGNCACHE] assign เขียน hook.custom_tool_id/custom_tool_status
    // ให้ hook ที่ติ๊ก/ปลด (added/removed) — field ที่ webhook อ่านทุก inbound
    // (webhook.service.ts:287,1342-1343) เพื่อตัดสินว่ารัน custom tool ไหม. เดิม
    // invalidate แค่ **tool cache** (:881) ไม่แตะ **hook cache** ⇒ webhook เสิร์ฟ hook
    // ตัวเก่า (custom_tool_id เก่า) จน TTL หมด — ตรงกับอาการ prod ลูกค้าทักไม่ได้ profile.
    // aliasOf (มีอยู่แล้ว) map id→alias จาก found+beforeHooks ⇒ ไม่ query เพิ่ม.
    // best-effort: invalidateHookCache กลืน error เอง. revert: ลบ block นี้.
    for (const hookId of [...added, ...removed]) {
      await this.hookCache.invalidateHookCache(aliasOf(String(hookId)));
    }

    await this.audit.write({
      ref_id: tool['_id'],
      parent: AUDIT_PARENT,
      action: 'update',
      changed_fields: [
        {
          field: 'assigned_oa',
          from: beforeIds.map(aliasOf),
          to: foundIds.map(aliasOf),
        },
      ],
      actor,
      request_meta: meta,
      note:
        `ผูก OA กับ tool "${String(tool['name'])}": ` +
        `เพิ่ม ${added.length} · เอาออก ${removed.length} ` +
        `(โดย ${actor.display_name || actor.username})`,
    });

    /* [FIX-20260815-ASSIGNSCOPE] report back on the field we just wrote, so the
       count the screen shows after saving matches what actually happened. */
    const hooks = await this.hookModel
      .find({ [idField]: id })
      .select(`alias name line_oa_name ${statusField}`)
      .lean<Record<string, unknown>[]>()
      .exec();

    return {
      data: {
        count: hooks.length,
        added: added.length,
        removed: removed.length,
        hooks,
      },
    };
  }
}
