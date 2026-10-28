/**
 * LIFTED — pending rewrite.
 *
 * Source: legacy-api/src/controllers/hook/hookController.js (3,645 lines).
 *
 * WHY IT IS NOT SPLIT YET
 * Per the accepted-debt policy in check-list.md, the four large legacy
 * controllers move in two steps. Step one ports the logic to TypeScript so it
 * runs; step two splits it, with the golden tests already in place to catch a
 * mistake. Doing both at once means changing framework *and* structure
 * simultaneously, so when the answer differs from legacy there is no way to
 * attribute the difference. This file is step one for the READ endpoints.
 *
 * WHAT UNBLOCKS SPLITTING
 * Every /hook endpoint golden-green against the running legacy backend —
 * reads (this file) plus the write paths (create/update/status/delete/clone/
 * push/external-api) that are not ported yet. Once the whole surface is
 * pinned by a diff, the natural seams are visible: query building and group
 * scoping, the LINE Messaging API proxy (quota/bot-info/push), and the
 * clone/field-tab machinery.
 *
 * "Lifted" means the same logic expressed in typed code — not JavaScript with a
 * new extension. There is no `any` and no `@ts-ignore` here.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

import { isSuperUser, type AuthenticatedUser } from '@/common';
import { CryptoService, SENSITIVE_FIELDS } from '@/infra/crypto';
import { LineQuotaApi } from '@/infra/line';

import {
  BlockedHooksException,
  type BlockedHook,
} from './blocked-hooks.exception';
// [FIX-20260818-HOOKWRITESCOPE] the shared OA-scope assertion
import { assertHookInScope } from './oa-access/allowed-hook-ids';
import { CustomToolsService } from './custom-tools.service';
import {
  HookAuditLogService,
  type AuditChange,
} from './hook-audit-log.service';
import { HookCacheService } from './hook-cache.service';
import { holdSlipProviderWithoutKey } from './hook-clone/slip-pair';
import { HookCredentialCheckService } from './hook-credential-check.service';
import { HookNotFoundException } from './hook-not-found.exception';
import {
  CLONEABLE_TABS,
  NEVER_CLONE,
  SENSITIVE_FIELD,
  fieldsForTabs,
  labelKeyOf,
} from './hook-field-tabs';
import * as W from './hook-write.helpers';
// [FEAT-20260822-NOTICEMODE] pure field rules for the notice settings mode —
// no provider, no DI; the two methods below are the only consumers.
import * as N from './notice-settings';
// [P2-20260813] vendor/model validation lives in its own role dir: the shared
// helpers file is already past the 400-line ceiling and off the waiver list.
import {
  parseAiModel,
  parseAiVendor,
  parseDeepSeekThinking,
  parseDeepSeekReasoningEffort,
  VENDOR_DEEPSEEK,
  VENDOR_GEMINI,
} from './ai-vendor/parse-ai-vendor';
// [FEAT-20260904-VENDORSECCOL] which key column a vendor owns, for the clone
// bound-pair blocks below.
import { resolveVendorColumns } from './ai-vendor/resolve-vendor-fields';
import { FlexMessage } from './schemas/flex-message.schema';
import { Group } from './schemas/group.schema';
import { Hook } from './schemas/hook.schema';
/**
 * Imported from the schema file rather than the '@/modules/admin' barrel, and
 * that is required, not a shortcut: admin's barrel pulls admin.module.ts, which
 * imports '@/modules/hooks' for the Group schema. Going through it makes the
 * cycle hooks -> admin -> hooks, and Node resolves the second leg to a
 * half-initialised module — `User` arrives as `undefined` and the app dies at
 * boot with "Cannot read properties of undefined (reading 'name')". Importing
 * the leaf schema keeps the dependency acyclic. `force_grant` is the only thing
 * that needs it.
 */
// eslint-disable-next-line no-restricted-imports
import { User } from '@/modules/admin/schemas/user.schema';
/**
 * Direct file import, not the '@/modules/handoff' barrel: the barrel re-exports
 * handoff.module.ts, which imports '@/modules/hooks' — going through it closes
 * the cycle this file already documents for User. This leaf injects only the
 * HandoffTarget model, which is what keeps it safe to provide from HooksModule.
 */
// eslint-disable-next-line no-restricted-imports
import { HandoffBindingSwitchService } from '@/modules/handoff/handoff-binding-switch.service';
import { isTranslateLanguage } from '@/modules/ai-translate';

function parseHookTranslateLang(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const str = typeof raw === 'string' ? raw.trim() : '';
  if (!str) return null;
  if (!isTranslateLanguage(str)) {
    throw new BadRequestException(`Unsupported translate language '${str}'`);
  }
  return str;
}

/** A hook row read with `.lean()` — an untyped bag of schema fields. */
type LeanHook = Record<string, unknown>;

/** Query parameters accepted by the two list endpoints. */
export interface HookListQuery {
  page?: string;
  limit?: string;
  group?: string;
  group_id?: string;
  status?: string;
  fast_mode?: string;
  alias?: string;
  tag?: string;
  keyword?: string;
  sort?: string;
}

const TZ = 'Asia/Bangkok';

/**
 * Legacy caps the page size at 300 (raised from 100).
 *
 * The cap is not arbitrary: this endpoint decrypts eight fields per row, so an
 * unbounded limit is a real cost. The frontend requests up to 300 and both
 * sides must agree — when the frontend asked for 1000 and the backend silently
 * returned 100, neither side could tell what had actually come back.
 */
const LIST_LIMIT_MAX = 300;
const LIST_LIMIT_DEFAULT = 10;

/* [PHASE3-I-QUOTA] the quota + consumption urls moved to
   `src/infra/line/line-endpoints.ts` with the transport. `/v2/bot/info` stays
   here because `getHookBotInfo` has not migrated. */
const LINE_INFO_URL = 'https://api.line.me/v2/bot/info';
const LINE_TIMEOUT_MS = 5000;

/**
 * Sentinel returned in place of a configured secret. The frontend echoes it
 * back on save to mean "leave the stored value alone", so the write path strips
 * it before persisting (`stripKeptSecrets`, :1054 / :1561).
 */
export const SECRET_MASK = '__SECRET_KEPT__';

/**
 * Secret field names the clone endpoint masks in its audit log.
 * `SENSITIVE_FIELD` (the tab registry) — not `SENSITIVE_FIELDS` (the crypto
 * list): the two overlap but are not the same set, and legacy masks by the
 * registry (hookController.js:3402).
 */
const CLONE_SECRET_KEYS: ReadonlySet<string> = new Set(
  Object.keys(SENSITIVE_FIELD),
);

/**
 * Everything a legacy handler read off `req` besides the body.
 *
 * The audit log records who acted and from where, and legacy reads that from
 * four headers with the JWT claim as a fallback (`buildActorFromReq` /
 * `buildRequestMeta`, hookController.js:118-206). Passing it as one value keeps
 * `Request` out of the service.
 */
export interface RequestContext {
  user?: AuthenticatedUser;
  actorUserId?: string;
  actorUsername?: string;
  actorDisplayName?: string;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

interface AuditActorValue {
  user_id: string;
  username: string;
  display_name?: string;
}

/**
 * Formats a date as Bangkok wall-clock `YYYY-MM-DD HH:mm:ss`.
 *
 * Legacy uses dayjs with the timezone plugin. That dependency is not in this
 * service, and adding one to format a date is not justified — `Intl` with an
 * explicit time zone produces the identical string, including the DST-free
 * fixed +07:00 offset Bangkok uses.
 */
const bangkokFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function toBangkokTime(value: unknown): string | null {
  if (!value) return null;
  const date =
    value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(date.getTime())) return null;

  const parts = bangkokFormatter.formatToParts(date);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  // Intl renders midnight as "24" in some ICU versions; legacy's dayjs emits
  // "00". Normalising here keeps the two strings byte-identical.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get(
    'minute',
  )}:${get('second')}`;
}

/**
 * Renders a hook's `group` value as the id string used for comparison.
 *
 * Legacy just calls `String(groupId)`, which happens to work for the three
 * shapes this field really holds: an ObjectId (rows written by the app), a bare
 * string (rows written by migration scripts), and a populated subdocument. The
 * cases are spelled out here because an untyped `String()` on the populated
 * shape would silently produce "[object Object]" — a comparison that never
 * matches, which reads as "insufficient group access" rather than as a bug.
 */
function groupIdToString(groupId: unknown): string {
  if (typeof groupId === 'string') return groupId;
  if (groupId instanceof Types.ObjectId) return groupId.toHexString();
  if (groupId && typeof groupId === 'object') {
    const id = (groupId as { _id?: unknown })._id;
    if (typeof id === 'string') return id;
    if (id instanceof Types.ObjectId) return id.toHexString();
  }
  return '';
}

/** Escapes every regex metacharacter — guards against both broken queries and
 * ReDoS from an operator-typed search box. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * [FEAT-20260828-FORCEGRANTCOUNT] ผลของการติ๊ก "ให้สิทธิ์ OA นี้กับผู้ใช้ในกลุ่ม"
 *
 * ⚠️ `granted` ไม่เท่ากับจำนวนคนในกลุ่ม และนั่นถูกต้อง — ดูเหตุผลที่
 *    `grantHookToGroupUsers` · คนที่ไม่มี allowlist เห็น OA นี้อยู่แล้ว
 */
export interface ForceGrantReport {
  /** จำนวนคนที่ถูก **เพิ่ม** OA นี้เข้า allowlist จริง */
  readonly granted: number;
  /** จำนวนคนที่เข้าเงื่อนไข (มี allowlist) — รวมคนที่มี OA นี้อยู่แล้ว */
  readonly matched: number;
  /** คนที่ไม่มี allowlist ⇒ เห็นทุก OA ในกลุ่มอยู่แล้ว ⇒ ไม่ต้องแตะ */
  readonly already_unrestricted: number;
}

@Injectable()
export class HooksService {
  private readonly logger = new Logger(HooksService.name);

  constructor(
    @InjectModel(Hook.name) private readonly hookModel: Model<Hook>,
    @InjectModel(Group.name) private readonly groupModel: Model<Group>,
    @InjectModel(FlexMessage.name)
    private readonly flexModel: Model<FlexMessage>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly crypto: CryptoService,
    private readonly hookCache: HookCacheService,
    private readonly auditLog: HookAuditLogService,
    private readonly credentialCheck: HookCredentialCheckService,
    /**
     * Only `getTagEndpoints` uses this, to resolve the tool a hook points at
     * without repeating the "active tool" query. Not circular: CustomToolsService
     * injects the Hook *model*, never this service.
     */
    private readonly customTools: CustomToolsService,
    /**
     * Owns the write to `scope.bindings[].enabled` for the handoff kill switch.
     *
     * Provided by HooksModule rather than imported from HandoffModule: that
     * module imports '@/modules/hooks', so importing it back would close a
     * cycle. It injects only the HandoffTarget model — deliberately not
     * HandoffTargetService, which reaches the hooks barrel transitively and
     * crashes this module at boot.
     */
    private readonly handoffBindings: HandoffBindingSwitchService,
    /* [PHASE3-I-QUOTA] the quota READ moved to the central LINE layer. Read-only
       and customer-invisible, which is why it is first in the migration order.
       ⚠️ APPENDED AT THE END ON PURPOSE. Four specs construct this service
       POSITIONALLY, so inserting a parameter mid-list silently shifts every
       argument after it into the wrong slot — which is what the first attempt did
       and it took nine tests down with it. New dependencies go LAST.
       พารามิเตอร์ใหม่ต้องต่อท้ายเสมอ · แทรกกลาง = ของหลังเลื่อนหมดแบบเงียบ ๆ. */
    private readonly lineQuotaApi: LineQuotaApi,
  ) {}

  // ─────────────────────────────────────────────────────────────────────
  // Access helpers — copied from the legacy controller, same semantics
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Delegates to the one shared predicate (V10). It used to spell the rule out
   * inline as `superadmin || superuser`; that is the exact duplication which
   * put a wrong list into six other files, and `superuser` is a dead branch
   * anyway — see src/common/auth/super-role.ts for the database evidence.
   */
  private isSuperUser(user?: AuthenticatedUser): boolean {
    return isSuperUser(user);
  }

  private getAllowedGroupIds(user?: AuthenticatedUser): string[] {
    const groups = Array.isArray(user?.groups) ? user.groups : [];
    return groups.filter((id) => isValidObjectId(id)).map((id) => String(id));
  }

  /**
   * Throws the legacy 403s verbatim. The three messages are distinct in legacy
   * and the dashboard shows them to the operator, so they are not merged.
   */
  private ensureGroupAccess(
    user: AuthenticatedUser | undefined,
    groupId: unknown,
  ): void {
    if (this.isSuperUser(user)) return;

    const allowed = this.getAllowedGroupIds(user);
    if (allowed.length === 0) {
      throw new ForbiddenException('group access is required');
    }
    if (!groupId) {
      throw new ForbiddenException('group is required');
    }
    if (!allowed.includes(groupIdToString(groupId))) {
      throw new ForbiddenException('insufficient group access');
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Response mappers
  // ─────────────────────────────────────────────────────────────────────

  /** Decrypts the sensitive fields and converts both timestamps to Bangkok. */
  private mapBangkokTime(doc: LeanHook | null): LeanHook | null {
    if (!doc) return doc;
    const obj = this.crypto.decryptHookFields(doc) as LeanHook;
    obj['created_at'] = toBangkokTime(obj['created_at']);
    obj['updated_at'] = toBangkokTime(obj['updated_at']);
    return obj;
  }

  /**
   * List rows must not carry decrypted secrets.
   *
   * The list previously mapped through the decrypting path, so every secret
   * (access_token / custom_ai_key / channel_secret / …) was returned on each of
   * the ~15 dashboard screens that call it — including to users who hold no
   * hook.manage but are still in the group. The list only ever displays
   * id/name/alias/group/status, so stripping the sensitive set is safe and
   * every non-secret field is left exactly as it was.
   */
  private mapBangkokTimeListSafe(doc: LeanHook): LeanHook | null {
    const obj = this.mapBangkokTime(doc);
    if (obj) {
      for (const field of SENSITIVE_FIELDS) delete obj[field];
    }
    return obj;
  }

  /**
   * Detail withholds secrets too.
   *
   * Legacy replaces each set secret with the sentinel `__SECRET_KEPT__`: an
   * administrator does not need to *see* a key to manage a hook, only to know
   * one is configured. The frontend sends the sentinel back on save meaning
   * "keep the stored value", so the real secret never reaches a browser and
   * cannot be stolen via XSS.
   *
   * ⚠️ We go one step further than legacy here, and it is deliberate (R4
   * outranks parity): legacy only masks a secret that is truthy, so a hook
   * whose secret is an empty string still returns that raw value. We mask on
   * the same condition legacy does — see the report — but never emit an `enc:`
   * value, because `decryptHookFields` returns the ciphertext unchanged when a
   * value cannot be decrypted, and that ciphertext would otherwise be shipped
   * to the client under a "kept" label.
   */
  private maskSecretsForDetail(obj: LeanHook | null): LeanHook | null {
    if (!obj) return obj;
    for (const field of SENSITIVE_FIELDS) {
      if (obj[field]) obj[field] = SECRET_MASK;
    }
    return obj;
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /hook
  // ─────────────────────────────────────────────────────────────────────

  async getAllHooks(
    query: HookListQuery,
    user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const page = Math.max(Number.parseInt(query.page ?? '', 10) || 1, 1);
    const hasLimit = query.limit !== undefined;
    const limit = hasLimit
      ? Math.min(
          Number.parseInt(query.limit ?? '', 10) || LIST_LIMIT_DEFAULT,
          LIST_LIMIT_MAX,
        )
      : null;
    const skip = hasLimit && limit !== null ? (page - 1) * limit : 0;

    const filter: Record<string, unknown> = {};

    const groupFilter = query.group ?? query.group_id;
    if (groupFilter !== undefined) {
      if (!isValidObjectId(groupFilter)) {
        throw new BadRequestException('invalid group id');
      }
      if (!this.isSuperUser(user)) {
        this.ensureGroupAccess(user, groupFilter);
      }
      // Both shapes are matched because the column holds ObjectIds on rows
      // written by the app and strings on rows written by migration scripts.
      filter['group'] = {
        $in: [new Types.ObjectId(groupFilter), groupFilter],
      };
    } else if (!this.isSuperUser(user)) {
      const allowedGroupIds = this.getAllowedGroupIds(user);
      if (allowedGroupIds.length === 0) {
        throw new ForbiddenException('group access is required');
      }
      const objectIds = allowedGroupIds.map((id) => new Types.ObjectId(id));
      filter['$or'] = [
        { group: { $in: objectIds } },
        { group: { $in: allowedGroupIds } },
      ];
    }

    if (query.status !== undefined) filter['status'] = Number(query.status);
    if (query.fast_mode !== undefined) {
      filter['fast_mode'] = Number(query.fast_mode);
    }
    if (query.alias) filter['alias'] = query.alias;

    // `tag` is an array field; Mongo matches element-wise on its own.
    if (query.tag) filter['tag'] = query.tag;

    const keyword =
      typeof query.keyword === 'string' ? query.keyword.trim() : '';
    if (keyword) {
      const rx = new RegExp(escapeRegex(keyword), 'i');
      /**
       * Searchable fields = text the operator can actually see or use to refer
       * to a hook. The first four are what the frontend used to filter
       * client-side; the last three were added because a hook named through the
       * channel-neutral field could not be found by its own name.
       *
       * No field from SENSITIVE_FIELDS is searchable, deliberately: those are
       * stored encrypted so a regex could not match them anyway, and allowing a
       * search over secrets is a way to guess one character at a time.
       */
      const keywordOr = [
        { line_oa_name: rx },
        { company_name: rx },
        { alias: rx },
        { tag: rx },
        { display_name: rx },
        { description: rx },
        { chat_bot_id: rx },
      ];
      // $and, never $or: the non-superuser branch above already owns $or for
      // group scoping, and overwriting it would leak other groups' hooks.
      const existingAnd = Array.isArray(filter['$and'])
        ? (filter['$and'] as unknown[])
        : [];
      filter['$and'] = [...existingAnd, { $or: keywordOr }];
    }

    const sort = this.parseSort(query.sort);

    const findQuery = this.hookModel.find(filter).sort(sort).skip(skip);
    // `.limit(null)` and `.limit(0)` both mean "no limit" to Mongoose, which is
    // what legacy relies on when the caller sends no `limit`.
    if (limit !== null) findQuery.limit(limit);

    const [rows, total] = await Promise.all([
      findQuery.lean<LeanHook[]>().exec(),
      this.hookModel.countDocuments(filter).exec(),
    ]);

    const data = rows.map((row) => this.mapBangkokTimeListSafe(row));

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        // Mirrors legacy exactly, including `null` limit producing `Infinity`
        // here — JSON.stringify renders that as null, which is what the
        // dashboard already receives today.
        total_pages: limit === null ? null : Math.ceil(total / limit),
      },
    };
  }

  /** `sort=field:asc|desc`; anything other than `asc` means descending. */
  private parseSort(raw?: string): Record<string, 1 | -1> {
    if (!raw) return { created_at: -1 };
    const [field, direction] = raw.split(':');
    if (!field) return { created_at: -1 };
    return { [field]: direction === 'asc' ? 1 : -1 };
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /hook/tags
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Distinct tag values, for the list page's tag dropdown.
   *
   * Exists because the dropdown used to be built from the full 1,000-row list
   * the frontend downloaded. With server-side paging the frontend only sees the
   * current page, so without this endpoint the dropdown would silently shrink
   * to the tags on that page.
   *
   * Uses the same group scope as getAllHooks — omitting it would leak other
   * groups' tag names through the dropdown.
   */
  async getHookTags(user?: AuthenticatedUser): Promise<{ data: string[] }> {
    const filter: Record<string, unknown> = {};
    if (!this.isSuperUser(user)) {
      const allowedGroupIds = this.getAllowedGroupIds(user);
      if (allowedGroupIds.length === 0) {
        throw new ForbiddenException('group access is required');
      }
      const objectIds = allowedGroupIds.map((id) => new Types.ObjectId(id));
      filter['$or'] = [
        { group: { $in: objectIds } },
        { group: { $in: allowedGroupIds } },
      ];
    }

    const tags = await this.hookModel.distinct('tag', filter).exec();
    const data = (tags as unknown[])
      .filter((t): t is string => typeof t === 'string' && t !== '')
      .sort((a, b) => a.localeCompare(b));

    return { data };
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /hook/field-tabs
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Tab metadata for the clone modal.
   *
   * `label_key` is returned rather than translated text so the frontend renders
   * exactly the label the form shows, in whichever of the two languages is
   * active, without the backend storing the strings twice.
   */
  getHookFieldTabs(): Record<string, unknown> {
    const tabs = CLONEABLE_TABS.map((tab) => {
      const fields = fieldsForTabs([tab.key], false);
      const sensitive = Object.entries(SENSITIVE_FIELD).filter(
        ([, t]) => t === tab.key,
      );
      return {
        ...tab,
        field_count: fields.length,
        fields: fields.map((f) => ({ field: f, label_key: labelKeyOf(f) })),
        sensitive_fields: sensitive.map(([f]) => f),
        sensitive_field_items: sensitive.map(([f]) => ({
          field: f,
          label_key: labelKeyOf(f),
        })),
      };
    });
    return { tabs };
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /hook/:id
  // ─────────────────────────────────────────────────────────────────────

  async getHookById(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('invalid hook id');
    }

    const hook = await this.hookModel
      .findById(id)
      .populate('group')
      .lean<LeanHook>()
      .exec();
    if (!hook) {
      // Legacy answers `{message}` here, not the `{error}` envelope used
      // elsewhere in the same handler. Kept as-is — the dashboard branches on
      // it and normalising the shape would be an API change.
      throw new HookNotFoundException();
    }

    const group = hook['group'];
    if (!this.isSuperUser(user) && !group) {
      throw new ForbiddenException('group access is required');
    }
    if (group && typeof group === 'object' && '_id' in group) {
      this.ensureGroupAccess(user, group._id);
    } else if (group) {
      this.ensureGroupAccess(user, group);
    }

    /**
     * Detail returns configured-secret markers, so it is restricted to
     * hook.manage (or a superuser) on top of group membership. Before this
     * check, a group member without hook.manage — a ticket or assist_admin
     * account — could read every credential in full. The edit and clone screens
     * are already gated on hook.manage, so no normal flow is affected.
     */
    if (
      !this.isSuperUser(user) &&
      !(
        Array.isArray(user?.permissions) &&
        user.permissions.includes('hook.manage')
      )
    ) {
      throw new ForbiddenException('hook.manage permission required');
    }

    if (group && typeof group === 'object' && '_id' in group) {
      const populated = group as { _id: unknown; group_name?: unknown };
      hook['group'] = {
        id: populated._id,
        group_name: populated.group_name,
      };
    }

    const masked = this.maskSecretsForDetail(this.mapBangkokTime(hook));
    return masked ?? {};
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /hook/:id/tag-endpoints
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Path list for the "Sub Type" dropdown on the Dynamic Tag form.
   *
   * The form used to read paths straight off `hook.external_endpoints`, which
   * comes down with `/hook` already. OAs wired to a custom tool keep their paths
   * in `custom_tools` instead, so those OAs showed an empty dropdown. This
   * endpoint answers for both wirings.
   *
   * ⚠️ Permission is `dynamic_tags.manage`, NOT `custom_tools.manage`, even
   * though the custom-tool branch reads a tool. Whoever maintains tags may not
   * hold the tools permission, and a 403 empties the dropdown just as
   * effectively as the missing data did. The route is safe under the weaker
   * permission because it projects key/label/method/path only — no `base_url`,
   * no `username`/`password`/`api_key`, no payload template ever leaves here.
   *
   * Auth-only lines are filtered out: they mint tokens and carry no customer
   * data, so a tag pointed at one always reads empty.
   *
   * ⚠️ The two branches are NOT field-compatible, and that asymmetry is legacy's,
   * preserved deliberately: the `external_endpoints` branch filters on
   * `is_login` alone and emits four keys, while the custom-tool branch also
   * excludes `is_refresh` / `purpose === 'auth'` and adds `purpose` and
   * `is_profile`. Harmonising them would change what the dropdown renders.
   */
  async getTagEndpoints(id: string): Promise<Record<string, unknown>> {
    // Legacy guards the id explicitly here and answers 400 — unlike the usage
    // endpoint, which lets the CastError become a 500.
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid Hook ID format');
    }

    const hook = await this.hookModel.findById(id).lean<LeanHook>().exec();
    // NOTE: a plain NotFoundException, NOT HookNotFoundException. This route
    // answers `{ error: 'Hook not found' }` where /hook/:id answers
    // `{ message: ... }`; HookNotFoundFilter is bound to the exception class,
    // so throwing the plain one keeps this on the global `{ error }` path.
    if (!hook) throw new NotFoundException('Hook not found');

    const asRecord = (value: unknown): Record<string, unknown> | null =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    // Legacy: `String(v?.method || "GET").toUpperCase()` — note `||`, so an
    // empty string falls back to GET where `??` would have kept it. A non-string
    // method is corrupt config; GET is the same answer legacy lands on.
    const upperMethod = (value: unknown): string =>
      (typeof value === 'string' && value ? value : 'GET').toUpperCase();
    /** Legacy `x || ""`: any falsy value becomes the empty string. */
    const orEmpty = (value: unknown): unknown => (value ? value : '');

    // ── Original wiring: paths inline on the hook ──────────────────────
    if (!(hook['custom_tool_status'] === true && hook['custom_tool_id'])) {
      const endpoints = asRecord(hook['external_endpoints']) ?? {};
      return {
        source: 'hook',
        tool_name: '',
        endpoints: Object.entries(endpoints)
          .filter(([, value]) => {
            const row = asRecord(value);
            return Boolean(row) && row!['is_login'] !== true;
          })
          .map(([key, value]) => {
            const row = asRecord(value) ?? {};
            return {
              key,
              label: key,
              method: upperMethod(row['method']),
              path: orEmpty(row['path']),
            };
          }),
      };
    }

    // ── Custom-tool wiring: paths live on the linked tool ──────────────
    const tool = await this.customTools.getToolForHook({
      custom_tool_status: hook['custom_tool_status'],
      custom_tool_id: hook['custom_tool_id'],
    });
    if (!tool) {
      // 200 with a warning, NOT a 404: the OA is configured, the tool it points
      // at is gone or switched off, and the form needs to say so rather than
      // render an error page.
      return {
        source: 'custom_tool',
        tool_name: '',
        endpoints: [],
        warning:
          'OA นี้เปิด Custom Tool ไว้ แต่หา tool ที่ลิงก์ไม่เจอ (อาจถูกลบหรือปิดอยู่) — ตรวจที่เมนู Custom Tools',
      };
    }

    const rows = Array.isArray(tool['endpoints']) ? tool['endpoints'] : [];
    return {
      source: 'custom_tool',
      tool_name: orEmpty(tool['name']),
      endpoints: rows
        .filter((entry) => {
          const row = asRecord(entry);
          if (!row || row['status'] === false || !row['key']) return false;
          const isAuthLine =
            row['is_login'] === true ||
            row['is_refresh'] === true ||
            row['purpose'] === 'auth';
          return !isAuthLine;
        })
        .map((entry) => {
          const row = asRecord(entry) ?? {};
          return {
            key: row['key'],
            // `label || key`, so a blank label falls back rather than rendering
            // an unlabelled option.
            label: row['label'] ? row['label'] : row['key'],
            method: upperMethod(row['method']),
            path: orEmpty(row['path']),
            purpose: row['purpose'] ? row['purpose'] : 'data',
            is_profile: row['is_profile'] === true,
          };
        }),
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /hook/:id/quota  and  GET /hook/:id/bot-info
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Loads a hook and applies the id / existence / group checks shared by the
   * two LINE proxy endpoints, then returns its decrypted channel access token.
   *
   * The token is used only to call LINE from this process — it is never part of
   * a response.
   */
  private async loadHookAccessToken(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<string> {
    // A malformed :id used to escape as a Mongoose CastError and surface as a
    // 500. Every /hook/:id handler carries this guard for that reason.
    if (!isValidObjectId(id)) {
      throw new BadRequestException('invalid hook id');
    }

    const hook = await this.hookModel.findById(id).lean<LeanHook>().exec();
    if (!hook) {
      throw new HookNotFoundException();
    }

    const group = hook['group'];
    if (!this.isSuperUser(user) && !group) {
      throw new ForbiddenException('group access is required');
    }
    if (group) this.ensureGroupAccess(user, group);

    /* [FIX-20260815-QUOTATOKEN] Read `access_token` — the field hooks actually
     * carry. This used to read `line_key`, which no hook has.
     *
     * THE BUG. Both LINE proxy endpoints (`/quota`, `/bot-info`) answered
     * `Line access token is required` for every OA, including ones online and
     * sending messages fine. Counted on the live database 15/08:
     * **0 of 7 hooks carry a non-empty `line_key`**; 6 carry `access_token`.
     * The old read matched nothing, so these two endpoints could only fail.
     *
     * WHY ONLY HERE. Every other outbound path resolves the token as
     * `access_token ?? line_key` — chat.service.ts:676,876 ·
     * chat-media.service.ts:266,538 · webhook.service.ts:938 ·
     * broadcasts.service.ts:661 — so they all kept working. This function read
     * the legacy field ALONE and was the single place that broke.
     *
     * ⚠️ NO `line_key` FALLBACK HERE, by owner's decision 15/08:
     *    "เฉพาะตรงฟังก์ชันโควตา เลิกยุ่งกับ line_key ไม่ได้ใช้".
     *    Scope is deliberately narrow — this helper serves only `/quota` and
     *    `/bot-info` (:827, :856), both read-only proxies that call LINE and
     *    return counters. Nothing writes, nothing else calls it, so dropping
     *    the legacy name cannot reach the send paths above, which keep their
     *    own fallback untouched. Should a genuine legacy row ever appear,
     *    crypto.service.ts:215 already back-fills `access_token` from
     *    `line_key` on read, so even that case still resolves.
     *
     * `safeDecrypt` returns '' for anything it cannot read, so a corrupt value
     * lands on the error below rather than reaching LINE as a bearer token.
     *
     * revert: `hook['access_token'] ?? hook['line_key']` restores the fallback;
     *         reading `line_key` alone restores the bug.
     */
    const rawToken = hook['access_token'];
    const accessToken =
      typeof rawToken === 'string' ? this.crypto.safeDecrypt(rawToken) : null;

    if (!accessToken) {
      throw new BadRequestException('Line access token is required');
    }
    return accessToken;
  }

  /**
   * Server-side GET against the LINE Messaging API.
   *
   * Legacy uses axios; `fetch` is used here to avoid adding a dependency. The
   * observable difference that matters is the failure message, which legacy
   * surfaces as `error.message` from axios — see the shape note on each caller.
   */
  private async lineGet(
    url: string,
    accessToken: string,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LINE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new InternalServerErrorException(
          `Request failed with status code ${response.status}`,
        );
      }
      return (await response.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The OA's monthly LINE message allowance — `GET /hook/:id/quota`.
   *
   * ⚠️ THIS PATH DOES NOT USE `line_key`. Owner's decision 15/08:
   *    *"เฉพาะตรงฟังก์ชันโควตา เลิกยุ่งกับ line_key ไม่ได้ใช้"*.
   *    The token comes from `access_token` ONLY (see `loadHookAccessToken` for
   *    the full reasoning and the live count: 0 of 7 hooks carry `line_key`).
   *    Do not add a `line_key` fallback back into this path — the send paths
   *    (chat / webhook / broadcast) keep their own and are unaffected.
   *
   * Returns LINE's two payloads unflattened plus `remaining`, so the shape stays
   * recognisable against LINE's docs. `quota.type === 'none'` means UNLIMITED
   * and carries no `value`; `remaining` is null there rather than 0.
   */
  async getHookQuota(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const accessToken = await this.loadHookAccessToken(id, user);

    /* [FEAT-20260917-LINEQUOTA-CACHE] 5-minute cache via HookCacheService */
    const cached = await this.hookCache?.getLineQuota(id);
    if (cached) {
      return cached;
    }

    /* [PHASE3-I-QUOTA] the transport — and ONLY the transport — moved to
       `LineQuotaApi`. The two reads, the 5s timeout, the `remaining` clamp and the
       unflattened payloads are the same as the `lineGet` pair they replace; the
       central layer was written against this method's documented rules, and
       `hooks-quota-golden.spec.ts` was captured on the OLD path and passes here
       unchanged, which is the proof rather than the claim.
       ย้ายแค่ท่อ · รูปผลลัพธ์และข้อความ error เท่าเดิมทุกตัวอักษร.

       ⚠️ `lineGet` STAYS — `getHookBotInfo` still uses it for `/v2/bot/info`, and
       that migrates only when a LineInfoApi exists. Half-sharing one helper across
       a migrated and an un-migrated call is the debt this layer exists to kill.

       ⚠️ The summary REPORTS failure instead of throwing, so the throw is restated
       here with LINE's status in the same sentence the dashboard has always shown.
       revert: put the `lineGet` pair back and drop the injection. */
    const summary = await this.lineQuotaApi.getQuotaSummary(accessToken);
    if (!summary.ok) {
      throw new InternalServerErrorException(
        `Request failed with status code ${String(summary.status)}`,
      );
    }

    const result = {
      quota: summary.quota,
      consumption: summary.consumption,
      remaining: summary.remaining,
    };

    await this.hookCache?.setLineQuota(id, result, 300);

    return result;
  }

  /**
   * [FEAT-20260917-INSIGHTFOLLOWERS] LINE follower insight proxy — `GET /hook/:id/insight/followers`.
   * Returns followers, targetedReaches, blocks and status (with fallback if LINE returns error/unready).
   * Caches 5 minutes via HookCacheService.
   */
  async getHookFollowers(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const accessToken = await this.loadHookAccessToken(id, user);

    const cached = await this.hookCache?.getLineFollowers(id);
    if (cached) {
      return cached;
    }

    // Default to yesterday's date in Asia/Bangkok (YYYYMMDD) as required by LINE Insight API
    const now = new Date();
    const bkkOffset = 7 * 60 * 60 * 1000;
    const bkkYesterday = new Date(
      now.getTime() + bkkOffset - 24 * 60 * 60 * 1000,
    );
    const yyyy = bkkYesterday.getUTCFullYear();
    const mm = String(bkkYesterday.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(bkkYesterday.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}`;

    const res = await this.lineQuotaApi.getInsightFollowers(
      accessToken,
      dateStr,
    );

    let result: Record<string, unknown>;
    if (!res.ok) {
      this.logger.warn(
        `getHookFollowers: LINE insight API returned status ${res.status}: ${res.reason || 'unknown'}`,
      );
      result = {
        status: 'unavailable',
        followers: null,
        targetedReaches: null,
        blocks: null,
      };
    } else {
      const data = (res.data as Record<string, unknown>) || {};
      result = {
        status: data['status'] || 'ready',
        followers:
          typeof data['followers'] === 'number' ? data['followers'] : null,
        targetedReaches:
          typeof data['targetedReaches'] === 'number'
            ? data['targetedReaches']
            : null,
        blocks: typeof data['blocks'] === 'number' ? data['blocks'] : null,
      };
    }

    await this.hookCache?.setLineFollowers(id, result, 300);

    return result;
  }

  /**
   * Returns only the bot's picture URL.
   *
   * The dashboard's contact and demo-chat pages used to call api.line.me
   * directly from the browser using the hook's raw line_key as a Bearer token,
   * which put the real channel access token in every dashboard user's Network
   * tab. This proxies the call server-side; the token never leaves the backend.
   */
  async getHookBotInfo(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<{ pictureUrl: string | null }> {
    const accessToken = await this.loadHookAccessToken(id, user);
    const info = await this.lineGet(LINE_INFO_URL, accessToken);
    const pictureUrl = info['pictureUrl'];
    return { pictureUrl: typeof pictureUrl === 'string' ? pictureUrl : null };
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /hook/group/:groupId
  // ─────────────────────────────────────────────────────────────────────

  async getHooksByGroup(
    groupId: string,
    query: HookListQuery,
    user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(groupId)) {
      throw new BadRequestException('Invalid group identifier');
    }
    if (!this.isSuperUser(user)) {
      this.ensureGroupAccess(user, groupId);
    }

    const page = Math.max(Number.parseInt(query.page ?? '', 10) || 1, 1);
    const hasLimit = query.limit !== undefined;
    const limit = hasLimit
      ? Math.min(
          Number.parseInt(query.limit ?? '', 10) || LIST_LIMIT_DEFAULT,
          LIST_LIMIT_MAX,
        )
      : null;
    const skip = hasLimit && limit !== null ? (page - 1) * limit : 0;

    const filter: Record<string, unknown> = {
      group: new Types.ObjectId(groupId),
    };
    if (query.status !== undefined) filter['status'] = Number(query.status);
    if (query.fast_mode !== undefined) {
      filter['fast_mode'] = Number(query.fast_mode);
    }
    if (query.alias) filter['alias'] = query.alias;

    const findQuery = this.hookModel
      .find(filter)
      .sort(this.parseSort(query.sort));
    if (hasLimit && limit !== null) findQuery.skip(skip).limit(limit);

    const [rows, total] = await Promise.all([
      findQuery.lean<LeanHook[]>().exec(),
      this.hookModel.countDocuments(filter).exec(),
    ]);

    const data = rows.map((row) => this.mapBangkokTimeListSafe(row));

    return {
      data,
      pagination: {
        page,
        // Without a limit legacy reports the total as the page size and a
        // single page — the caller received everything.
        limit: hasLimit ? limit : total,
        total,
        total_pages: hasLimit && limit !== null ? Math.ceil(total / limit) : 1,
      },
    };
  }

  // ═════════════════════════════════════════════════════════════════════
  // WRITE PATHS
  //
  // ⚠️ NONE of these carry a permission decorator, and that is deliberate —
  // the legacy routes carry no `authorize(...)` either (apiRoutes.js:157-195;
  // of the eleven hook routes only GET /hook/:id/tag-endpoints does). The
  // accounts in real use hold `hook.manage` through their ROLE, not in their
  // own permissions claim, and the guard reads the claim — so a decorator here
  // would 403 exactly the operators these screens exist for. Access is enforced
  // per hook below, by group scoping, the same way the read endpoints do it.
  // ═════════════════════════════════════════════════════════════════════

  /** Legacy's `buildActorFromReq` — headers win over the JWT claim. */
  private buildActor(ctx: RequestContext): AuditActorValue {
    const userId = ctx.actorUserId || ctx.user?.userId || 'system';
    return {
      user_id: userId,
      username: ctx.actorUsername || ctx.user?.username || userId,
      display_name: ctx.actorDisplayName || ctx.user?.displayName,
    };
  }

  /** Legacy's `buildRequestMeta`. */
  private buildRequestMeta(ctx: RequestContext): {
    request_id?: string;
    ip?: string;
    user_agent?: string;
  } {
    return {
      request_id: ctx.requestId,
      ip: ctx.ip,
      user_agent: ctx.userAgent,
    };
  }

  /**
   * Encrypts a secret coming in as plaintext.
   * Empty stays empty — legacy never encrypts a blank, because "" is how the
   * form clears a credential and `enc:<ciphertext of "">` would read as set.
   */
  private encryptIfSet(value: unknown): unknown {
    const trimmed = W.trimIfString(value);
    return trimmed ? this.crypto.encrypt(trimmed as string) : trimmed;
  }

  /**
   * Resolves a group reference to its stored `_id`, proving it exists.
   * Legacy: hookController.js:686-706.
   */
  private async resolveGroupId(value: unknown): Promise<unknown> {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (!isValidObjectId(value)) {
      throw new BadRequestException('Invalid group identifier');
    }
    const group = await this.groupModel
      .findById(value)
      .lean<{ _id: Types.ObjectId }>()
      .exec();
    if (!group) throw new BadRequestException('Group not found');
    return group._id;
  }

  /**
   * Keeps only flex-card ids the caller may actually bind.
   *
   * Filters silently rather than throwing, exactly as legacy does: the form
   * only ever offers cards in the operator's own groups, so a dropped id means
   * someone called the API directly — which is the hole this closes. Duplicates
   * are removed and the operator's ordering is preserved.
   * Legacy: hookController.js:392-422.
   */
  private async normalizeFlexCustomIds(
    value: unknown,
    user?: AuthenticatedUser,
    flexType = 'custom',
  ): Promise<Types.ObjectId[] | undefined> {
    if (value === undefined) return undefined;
    if (value === null) return [];
    const arr = Array.isArray(value) ? value : [value];

    const seen = new Set<string>();
    const ids: Types.ObjectId[] = [];
    for (const v of arr) {
      if (!isValidObjectId(v as string)) continue;
      const key = String(v);
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(new Types.ObjectId(key));
    }
    if (ids.length === 0) return [];

    const filter: Record<string, unknown> = {
      _id: { $in: ids },
      flex_type: flexType,
      deleted_at: { $exists: false },
    };
    if (!this.isSuperUser(user)) {
      filter['group_ids'] = { $in: user?.groups ?? [] };
    }
    const allowed = await this.flexModel
      .find(filter)
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    const allowedSet = new Set(allowed.map((d) => String(d._id)));
    return ids.filter((id) => allowedSet.has(String(id)));
  }

  /**
   * `force_grant`: appends this OA to every group member's allowed_hooks.
   *
   * Only users that ALREADY carry `allowed_hooks` are touched — a legacy account
   * without the field sees every OA in its groups, and `$addToSet` would shrink
   * that to this one. Legacy: hookController.js:267-278.
   */
  private async grantHookToGroupUsers(
    hookId: unknown,
    groupId: unknown,
  ): Promise<ForceGrantReport> {
    const filter: Record<string, unknown> = {
      groups: groupId,
      allowed_hooks: { $exists: true },
      deleted_at: { $exists: false },
    };
    const res = await this.userModel
      .updateMany(
        filter,
        { $addToSet: { allowed_hooks: hookId } },
        {
          timestamps: false,
        },
      )
      .exec();

    /**
     * [FEAT-20260828-FORCEGRANTCOUNT] คืนตัวเลขออกไป แทนที่จะทิ้งผลของ `updateMany`
     *
     * 🔴 เดิมเมธอดนี้คืน `void` ⇒ ไม่มีใครรู้ว่าเกิดอะไรขึ้นเลย · แอดมินติ๊กช่องที่
     *    เขียนว่า "ให้สิทธิ์กับ user ทุกคนในกลุ่มทันที" แล้วเห็นว่าบางคนไม่ขยับ
     *    ก็จะสรุปว่าฟีเจอร์พัง — ทั้งที่มันทำถูก
     * 🔴 คนที่ **ไม่มี** `allowed_hooks` ถูกข้ามโดยตั้งใจ และนั่นคือสิ่งที่ต้องเป็น:
     *    ไม่มี field = "ไม่มี allowlist" = เห็น OA ทุกตัวในกลุ่มอยู่แล้ว
     *    (`auth.service.ts:255`) ⇒ ถ้า `$addToSet` ให้เขา จะกลายเป็นการสร้าง
     *    allowlist ที่มี OA ตัวเดียว **ตัดสิทธิ์ที่เขาเคยมีทั้งหมดทิ้ง**
     *    จากเห็นทุก OA เหลือเห็นตัวเดียว ⇒ นับแยกไว้ให้เห็น ไม่ใช่ไปแตะ
     * ⚠️ นับด้วยคิวรี่ของตัวเอง ไม่ใช่เดาจาก `matchedCount` — สองกลุ่มนี้เป็นคนละ
     *    เงื่อนไข และการลบกันเอาเองจะผิดทันทีที่มี user ถูกลบระหว่างสองคำสั่ง
     */
    /* ⚠️ ประกาศเป็น `Record<string, unknown>` เหมือน `filter` ด้านบน — `groupId`
       เป็น `unknown` (มาจาก body ที่ไม่มี DTO) ⇒ ส่งเข้า `countDocuments` แบบ
       object literal ตรง ๆ จะไม่ผ่าน type ของ mongoose · ตัว `updateMany` ข้างบน
       ผ่านได้เพราะ filter ถูกประกาศชนิดนี้ไว้แล้ว ทำให้เหมือนกันทั้งสองที่ */
    const unrestrictedFilter: Record<string, unknown> = {
      groups: groupId,
      allowed_hooks: { $exists: false },
      deleted_at: { $exists: false },
    };
    const unrestricted = await this.userModel
      .countDocuments(unrestrictedFilter)
      .exec();

    return {
      granted: res.modifiedCount ?? 0,
      matched: res.matchedCount ?? 0,
      already_unrestricted: unrestricted,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // POST /hook
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Creates a hook from a free-form body.
   *
   * No DTO validates the body, deliberately: legacy accepts any key and lets
   * the Mongoose schema drop what it does not know, and every rejection it does
   * make is an in-handler check answering its own message. A DTO under the
   * global ValidationPipe (`forbidNonWhitelisted: true`) would answer a
   * different envelope, or reject bodies the dashboard sends today.
   * Legacy: hookController.js:1075-1345.
   */
  async createHook(
    rawBody: W.FieldBag,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const body: W.FieldBag = { ...rawBody };
    const user = ctx.user;

    W.stripKeptSecrets(body, SENSITIVE_FIELDS, SECRET_MASK);

    // [FIX-20260817-MANGLEDMASK] A value that still LOOKS like the placeholder
    // is a hand-edited mask, never a real credential — writing it destroys a
    // live key (it did, on 17/08). Refuse the whole save, loudly.
    {
      const mangled = W.findMangledSentinels(
        body,
        SENSITIVE_FIELDS,
        SECRET_MASK,
      );
      if (mangled.length) {
        throw new BadRequestException(
          `${mangled.join(', ')}: value looks like the masked placeholder — ` +
            'press its edit button and enter the real value (or cancel the edit)',
        );
      }
    }

    const forceGrant = W.isTrueFlag(body['force_grant']);
    delete body['force_grant'];
    /**
     * `provision_handoff` / `clone_from` are control flags, not hook fields —
     * captured then deleted so neither Hook.create nor the audit diff persists
     * them. The provisioning they gate is NOT ported (it belongs to the handoff
     * module); absent flags mean the plain create path, which is what every
     * request in use sends. See the report's "deliberately not ported".
     */
    delete body['provision_handoff'];
    delete body['clone_from'];

    if (body['group'] !== undefined) {
      body['group'] = await this.resolveGroupId(body['group']);
    }
    if (!this.isSuperUser(user)) {
      this.ensureGroupAccess(user, body['group']);
    }

    // ── credentials: verified against the issuer before they are stored ──
    if (body['doc_id'] !== undefined) {
      body['doc_id'] = await this.ensureValidDocId(body['doc_id']);
    }
    if (body['line_key'] !== undefined) {
      body['line_key'] = await this.ensureValidLineKey(body['line_key']);
    }
    if (body['channel_secret'] !== undefined) {
      body['channel_secret'] = this.encryptIfSet(body['channel_secret']);
    }
    if (body['access_token'] !== undefined) {
      body['access_token'] = this.encryptIfSet(body['access_token']);
    }
    if (body['telegram_key'] !== undefined) {
      body['telegram_key'] = this.encryptIfSet(body['telegram_key']);
    }
    if (body['telegram_chat_id'] !== undefined) {
      body['telegram_chat_id'] = W.trimIfString(body['telegram_chat_id']);
    }
    if (body['custom_ai_key'] !== undefined) {
      /* [FIX-20260818-VENDORKEYPROBE · plan §7.4] Check the key against the vendor
         it belongs to — Google's model list for a Gemini key.

         ⚠️ [FEAT-20260904-VENDORSECCOL] This used to read `body['ai_vendor']`,
         because both vendors shared this one column and only the vendor field
         could say whose key it was. The column now says so itself:
         `custom_ai_key` is GEMINI's whatever `ai_vendor` holds, and DeepSeek's
         lives in `custom_ai_key_sec` below. The probe therefore no longer
         depends on a field the operator may be changing in the same request —
         which also removes the ordering hazard the old comment described.
         คอลัมน์บอกค่ายอยู่แล้ว ไม่ต้องถาม ai_vendor อีก */
      body['custom_ai_key'] = await this.ensureValidCustomAiKey(
        body['custom_ai_key'],
        VENDOR_GEMINI,
      );
    }
    if (body['custom_ai_key_sec'] !== undefined) {
      // [FEAT-20260904-VENDORSECCOL] the second vendor's key, probed against
      // DeepSeek's own endpoint. That probe is `rejectOnFailure: false` by
      // design (`ai-vendor/ai-key-probe.ts`) — we have never called it, so its
      // failure must not make a working key unsaveable.
      body['custom_ai_key_sec'] = await this.ensureValidCustomAiKey(
        body['custom_ai_key_sec'],
        VENDOR_DEEPSEEK,
      );
    }

    // ── ordinary fields, in legacy's order (the order decides which 400 wins) ──
    if (body['fast_mode'] !== undefined) {
      const normalized = W.parseFastModeInput(body['fast_mode']);
      if (normalized !== undefined) body['fast_mode'] = normalized;
    }
    if (body['suggestion_text'] !== undefined) {
      body['suggestion_text'] = W.normalizeSuggestionField(
        body['suggestion_text'],
        'suggestion_text',
      );
    }
    if (body['suggestion_company_text'] !== undefined) {
      body['suggestion_company_text'] = W.normalizeSuggestionField(
        body['suggestion_company_text'],
        'suggestion_company_text',
      );
    }
    if (body['suggestion_text_no_profile'] !== undefined) {
      body['suggestion_text_no_profile'] = W.normalizeSuggestionField(
        body['suggestion_text_no_profile'],
        'suggestion_text_no_profile',
      );
    }
    if (body['default_answer_text'] !== undefined) {
      body['default_answer_text'] = W.trimToString(body['default_answer_text']);
    }
    // [FIX-20260808-AIGENERROR] Trim like its sibling; empty/whitespace → '' →
    // treated as "no line" (silent) by resolveReplyText, same as default_answer.
    if (body['ai_generative_error_text'] !== undefined) {
      body['ai_generative_error_text'] = W.trimToString(
        body['ai_generative_error_text'],
      );
    }
    if (body['missing_api_data_text'] !== undefined) {
      body['missing_api_data_text'] = W.normalizeMissingApiDataText(
        body['missing_api_data_text'],
      );
    }
    if (body['status_off_action'] !== undefined) {
      body['status_off_action'] = W.normalizeStatusOffAction(
        body['status_off_action'],
      );
    }
    if (body['status_off_text'] !== undefined) {
      body['status_off_text'] = W.normalizeStatusOffText(
        body['status_off_text'],
      );
    }
    if (body['flex_custom_ids'] !== undefined) {
      body['flex_custom_ids'] = await this.normalizeFlexCustomIds(
        body['flex_custom_ids'],
        user,
      );
    }
    if (body['flex_profile_custom_ids'] !== undefined) {
      body['flex_profile_custom_ids'] = await this.normalizeFlexCustomIds(
        body['flex_profile_custom_ids'],
        user,
        'profile-semi-custom',
      );
    }
    if (body['gemini_temperature'] !== undefined) {
      body['gemini_temperature'] = W.parseGeminiTemperature(
        body['gemini_temperature'],
      );
    }
    if (body['gemini_top_k'] !== undefined) {
      body['gemini_top_k'] = W.parseGeminiTopK(body['gemini_top_k']);
    }
    // [P2-20260813] create has NO allow-list (Mongoose strict drops unknowns),
    // so validation has to happen here or a bad vendor reaches the document.
    if (body['ai_vendor'] !== undefined) {
      body['ai_vendor'] = parseAiVendor(body['ai_vendor']);
    }
    if (body['ai_model'] !== undefined) {
      body['ai_model'] = parseAiModel(body['ai_model']);
    }
    // [FEAT-20260904-VENDORSECCOL] same parser, second vendor. Create has NO
    // allow-list, so validating here is what stops a bad value reaching the doc.
    if (body['ai_model_sec'] !== undefined) {
      body['ai_model_sec'] = parseAiModel(body['ai_model_sec']);
    }
    // [FEAT-20260909-VENDORTRANSLATE] the translate lane's vendor, same parser
    // and the same reason: create has no allow-list to catch a bad name later.
    // The field name is passed so a typo blames the right box.
    if (body['ai_vendor_translate'] !== undefined) {
      body['ai_vendor_translate'] = parseAiVendor(
        body['ai_vendor_translate'],
        'ai_vendor_translate',
      );
    }
    if (body['translate_lang'] !== undefined) {
      body['translate_lang'] = parseHookTranslateLang(body['translate_lang']);
    }
    if (body['auto_translate'] !== undefined) {
      body['auto_translate'] = Boolean(body['auto_translate']);
    }
    /* [FEAT-20260909-DSREASONING] same reason: create has no allow-list.
       Looped rather than written five times — the shape is identical and five
       hand-copied blocks is five chances to paste the wrong column name. */
    for (const f of ['deepseek_thinking', 'deepseek_thinking_translate']) {
      if (body[f] !== undefined) body[f] = parseDeepSeekThinking(body[f], f);
    }
    for (const f of [
      'deepseek_reasoning_effort',
      'deepseek_reasoning_effort_translate',
    ]) {
      if (body[f] !== undefined) {
        body[f] = parseDeepSeekReasoningEffort(body[f], f);
      }
    }
    /* Gemini's translate budget reuses the parser its main-lane twin uses, so
       the two columns can never disagree about what a valid budget is. */
    if (body['gemini_thinking_budget_translate'] !== undefined) {
      body['gemini_thinking_budget_translate'] = W.parseGeminiThinkingBudget(
        body['gemini_thinking_budget_translate'],
      );
    }
    if (body['ai_history_limit'] !== undefined) {
      body['ai_history_limit'] = W.parseAiHistoryLimit(
        body['ai_history_limit'],
      );
    }
    if (body['ai_need_detail_limit'] !== undefined) {
      body['ai_need_detail_limit'] = W.parseAiNeedDetailLimit(
        body['ai_need_detail_limit'],
      );
    }
    if (body['ai_raw_json_analysis'] !== undefined) {
      body['ai_raw_json_analysis'] = W.parseAiRawJsonAnalysis(
        body['ai_raw_json_analysis'],
      );
    }
    if (body['ai_raw_site_rules'] !== undefined) {
      body['ai_raw_site_rules'] = W.parseAiRawSiteRules(
        body['ai_raw_site_rules'],
      );
    }
    // [FEAT-20260810-DOCRETRIEVAL] absent ⇒ untouched ⇒ schema default false.
    if (body['doc_retrieval'] !== undefined) {
      body['doc_retrieval'] = W.parseDocRetrieval(body['doc_retrieval']);
    }
    // [FEAT-20261026-RAGENGINE] absent ⇒ untouched ⇒ schema default null (= engine default).
    if (body['rag_prompt_mode'] !== undefined) {
      body['rag_prompt_mode'] = W.parseRagPromptMode(body['rag_prompt_mode']);
    }
    if (body['rag_search_mode'] !== undefined) {
      body['rag_search_mode'] = W.parseRagSearchMode(body['rag_search_mode']);
    }
    // [FEAT-20260830-STABLEPROMPT] same rule — absent ⇒ schema default false.
    if (body['ai_stable_prompt'] !== undefined) {
      body['ai_stable_prompt'] = W.parseAiStablePrompt(
        body['ai_stable_prompt'],
      );
    }
    // [FEAT-20260821-IGNOREABANDON] same rule — absent ⇒ schema default false.
    if (body['ignore_abandon_assist'] !== undefined) {
      body['ignore_abandon_assist'] = W.parseIgnoreAbandonAssist(
        body['ignore_abandon_assist'],
      );
    }
    if (body['ai_raw_json_rules'] !== undefined) {
      body['ai_raw_json_rules'] = W.parseAiRawJsonRules(
        body['ai_raw_json_rules'],
      );
    }
    if (body['ai_site_rules_guide'] !== undefined) {
      body['ai_site_rules_guide'] = W.parseAiSiteRulesGuide(
        body['ai_site_rules_guide'],
      );
    }
    // On create both sides of the pair come straight from the body.
    W.assertRawJsonRulesPresent(
      body['ai_raw_json_analysis'],
      body['ai_raw_json_rules'],
    );
    if (body['gemini_top_p'] !== undefined) {
      body['gemini_top_p'] = W.parseGeminiTopP(body['gemini_top_p']);
    }
    if (body['gemini_thinking_budget'] !== undefined) {
      body['gemini_thinking_budget'] = W.parseGeminiThinkingBudget(
        body['gemini_thinking_budget'],
      );
    }
    if (body['image_answer_text'] !== undefined) {
      body['image_answer_text'] = W.trimToString(body['image_answer_text']);
    }
    if (body['answer_link'] !== undefined) {
      body['answer_link'] = W.trimToString(body['answer_link']);
    }
    if (body['slip_verify_key'] !== undefined) {
      const sk = W.trimToString(body['slip_verify_key']);
      body['slip_verify_key'] = sk ? this.crypto.encrypt(sk) : sk;
    }
    if (body['match_account'] !== undefined) {
      body['match_account'] = Boolean(body['match_account']);
    }
    if (body['callback_slip'] !== undefined) {
      body['callback_slip'] = W.parseCallbackSlip(body['callback_slip']);
    }
    if (body['callback_token'] !== undefined) {
      body['callback_token'] = W.normalizeCallbackToken(body['callback_token']);
    }
    if (body['callback_action'] !== undefined) {
      const action = W.normalizeCallbackAction(body['callback_action']);
      // Legacy leaves an unrecognised action untouched rather than rejecting.
      if (action !== undefined) body['callback_action'] = action;
    }
    if (body['external_api_url'] !== undefined) {
      body['external_api_url'] =
        typeof body['external_api_url'] === 'string'
          ? body['external_api_url'].trim()
          : '';
    }
    if (body['external_user'] !== undefined) {
      body['external_user'] =
        typeof body['external_user'] === 'string'
          ? body['external_user'].trim()
          : '';
    }
    if (body['external_password'] !== undefined) {
      const ep =
        typeof body['external_password'] === 'string'
          ? body['external_password'].trim()
          : '';
      body['external_password'] = ep ? this.crypto.encrypt(ep) : ep;
    }
    if (body['external_endpoints'] !== undefined) {
      if (
        typeof body['external_endpoints'] !== 'object' ||
        body['external_endpoints'] === null
      ) {
        body['external_endpoints'] = {};
      }
    }

    for (const field of W.FLEX_FIELDS) {
      if (body[field]) {
        if (!isValidObjectId(body[field] as string)) {
          throw new BadRequestException(`Invalid identifier for ${field}`);
        }
      } else if (body[field] === '') {
        body[field] = null;
      }
    }

    if (body['qr_code_fail_anwser_text'] !== undefined) {
      body['qr_code_fail_anwser_text'] = W.legacyString(
        body['qr_code_fail_anwser_text'],
      ).trim();
    }
    if (body['match_account_number'] !== undefined) {
      body['match_account_number'] = W.legacyString(
        body['match_account_number'],
      ).trim();
    }
    if (body['slip_check'] !== undefined) {
      body['slip_check'] = Boolean(body['slip_check']);
    }
    for (const field of [
      'slip_check_min_amount',
      'slip_check_max_amount',
      'slip_check_out_of_time',
    ]) {
      if (body[field] !== undefined) {
        body[field] = W.parseAmountOrNull(body[field]);
      }
    }

    W.mirrorHookChannelFields(body);

    const created = await this.hookModel.create(body);
    // `.toObject()` gives a typed document; the write path treats a hook as an
    // open bag of fields (legacy does the same), hence the widening.
    const hookPayload = created.toObject() as unknown as LeanHook;

    // ── CACHE TRIGGER 1/5 (hookController.js:1292) ──────────────────────
    // Write-through so the webhook path sees the new alias immediately. A new
    // hook has no previous alias, so no eviction is needed here.
    await this.hookCache.cacheHook(hookPayload);

    /* [FEAT-20260828-FORCEGRANTCOUNT] เหมือนเส้น update — ผลถูกส่งกลับไม่ถูกทิ้ง */
    let forceGrantReport: ForceGrantReport | null = null;
    if (forceGrant && hookPayload['group']) {
      forceGrantReport = await this.grantHookToGroupUsers(
        hookPayload['_id'],
        hookPayload['group'],
      );
    }

    const actor = this.buildActor(ctx);
    this.auditLog.writeInBackground(
      {
        ref_id: hookPayload['_id'],
        hook_id: hookPayload['_id'],
        group_id: hookPayload['group'] ?? null,
        parent: 'hook',
        action: 'create',
        // The diff is taken from the NORMALISED body, so the log records what
        // was actually stored rather than what was typed.
        changed_fields: Object.keys(body).map((field) => ({
          field,
          from: null,
          to: body[field],
        })),
        actor,
        request_meta: this.buildRequestMeta(ctx),
        note:
          (body['audit_note'] as string | undefined) ||
          `Created hook: ${String(hookPayload['alias'])} (by ${
            actor.display_name || actor.username
          })`,
      },
      'audit log create failed',
    );

    /* [FEAT-20260828-FORCEGRANTCOUNT] additive เหมือนเส้น update — ไม่มีคีย์นี้
       เมื่อไม่ได้ติ๊ก ⇒ คำตอบของการสร้างปกติเหมือนเดิมทุกไบต์ */
    const createdDetail: Record<string, unknown> =
      this.mapBangkokTime(hookPayload) ?? {};
    return forceGrantReport
      ? { ...createdDetail, force_grant_result: forceGrantReport }
      : createdDetail;
  }

  // ── credential validators (R10: real outbound calls) ───────────────────

  /** Legacy: hookController.js:671-685. */
  private async ensureValidDocId(value: unknown): Promise<unknown> {
    const trimmed = W.trimIfString(value);
    if (!trimmed) return '';
    await this.credentialCheck.verifyDocId(W.legacyString(trimmed));
    return trimmed;
  }

  /** Legacy: hookController.js:655-670. */
  private async ensureValidLineKey(value: unknown): Promise<unknown> {
    const trimmed = W.trimIfString(value);
    if (!trimmed) return '';
    await this.credentialCheck.verifyLineKey(W.legacyString(trimmed));
    return this.crypto.encrypt(W.legacyString(trimmed));
  }

  /** Legacy: hookController.js:639-654. */
  private async ensureValidCustomAiKey(
    value: unknown,
    vendor?: unknown,
  ): Promise<unknown> {
    const trimmed = W.trimIfString(value);
    if (!trimmed) return '';
    await this.credentialCheck.verifyCustomAiKey(
      W.legacyString(trimmed),
      typeof vendor === 'string' ? vendor : null,
    );
    return this.crypto.encrypt(W.legacyString(trimmed));
  }

  // ── update-path credential validators ──────────────────────────────────
  //
  // Legacy passes `existing` as a second argument to the same three functions;
  // createHook simply calls them with it undefined. They are separate methods
  // here because the create path has no stored value to compare against and
  // reads better without a dangling `undefined`.
  //
  // ⚠️ The shared rule: a submitted secret EQUAL to the stored one short-circuits
  // BEFORE the outbound verify call. That is what stops every save of the OA form
  // from re-verifying (and, for custom_ai_key, re-billing) an unchanged key, and
  // it is why an already-stored key that has since been revoked upstream keeps
  // saving fine. Legacy: hookController.js:639-684.

  /** Legacy: hookController.js:671-684. `doc_id` is stored PLAIN, not encrypted. */
  private async ensureValidDocIdForUpdate(
    value: unknown,
    existing: unknown,
  ): Promise<unknown> {
    const trimmed = W.trimIfString(value);
    // [FIX-20260817-BLANKSECRET] '' keeps, null clears — see updateSecretField.
    if (value === null) return null;
    if (!trimmed) return undefined;
    // Compared as a plain string — unlike the other two, doc_id is never
    // ciphertext, so there is nothing to decrypt first.
    if (existing && W.legacyString(existing) === trimmed) return trimmed;
    await this.credentialCheck.verifyDocId(W.legacyString(trimmed));
    return trimmed;
  }

  /** Legacy: hookController.js:655-669. */
  private async ensureValidLineKeyForUpdate(
    value: unknown,
    existing: unknown,
  ): Promise<unknown> {
    const trimmed = W.trimIfString(value);
    // [FIX-20260817-BLANKSECRET] '' keeps, null clears — see updateSecretField.
    if (value === null) return null;
    if (!trimmed) return undefined;
    const existingPlain = this.crypto.safeDecrypt(existing as string);
    // Returns the STORED ciphertext, not a re-encryption — see updateSecretField.
    if (existingPlain && existingPlain === trimmed) return existing;
    await this.credentialCheck.verifyLineKey(W.legacyString(trimmed));
    return this.crypto.encrypt(W.legacyString(trimmed));
  }

  /** Legacy: hookController.js:639-653. */
  /**
   * [FIX-20260818-VENDORKEYPROBE · plan §7.4] `vendor` is the vendor the row will
   * HAVE after this save: the submitted value when the form carried one, else what
   * is already stored. Same bound-pair reasoning as `hook-clone/ai-pair.ts` — the
   * key must be checked against the vendor it is about to belong to, not the one
   * it is replacing.
   *
   * Note what this deliberately does NOT do: changing only `ai_vendor`, with no new
   * key, does not re-verify the stored key. Re-verifying would mean decrypting and
   * re-sending a live credential on an ordinary settings save.
   */
  private async ensureValidCustomAiKeyForUpdate(
    value: unknown,
    existing: unknown,
    vendor?: unknown,
  ): Promise<unknown> {
    const trimmed = W.trimIfString(value);
    // [FIX-20260817-BLANKSECRET] see updateSecretField: '' means "the form did
    // not carry it", null means "clear it". Returning '' here erased live keys.
    if (value === null) return null;
    if (!trimmed) return undefined;
    const existingPlain = this.crypto.safeDecrypt(existing as string);
    if (existingPlain && existingPlain === trimmed) return existing;
    await this.credentialCheck.verifyCustomAiKey(
      W.legacyString(trimmed),
      typeof vendor === 'string' ? vendor : null,
    );
    return this.crypto.encrypt(W.legacyString(trimmed));
  }

  // ─────────────────────────────────────────────────────────────────────
  // PUT /hook/:id
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Fields a PUT may write. Legacy: hookController.js:1369-1463.
   *
   * ⚠️ THIS LIST IS THE ONLY FILTER updateHook APPLIES. A key that is not here
   * is dropped SILENTLY and the response still reads 200 — so a field missing
   * from this array shows up as "operator pressed save, screen said success,
   * value did not persist", with nothing in any log. Legacy's own comments say
   * so five separate times, each added after that bug was hit in production.
   * Keep it in legacy's order and do not prune entries that look unused.
   */
  private static readonly ALLOWED_UPDATES: readonly string[] = [
    'line_oa_name',
    'alias',
    'company_name',
    'description',
    'tag',
    'line_url',
    'webhook_url',
    'status',
    'fast_mode',
    'auto_unassist_minutes',
    'suggestion_text',
    'suggestion_company_text',
    'suggestion_text_no_profile',
    'default_answer_text',
    // [FIX-20260808-AIGENERROR] OA-editable line for a Gemini/generative failure.
    'ai_generative_error_text',
    'missing_api_data_text',
    'status_off_action',
    'status_off_text',
    'doc_id',
    'line_id',
    'line_secret',
    'line_key',
    'channel_id',
    'channel_secret',
    'access_token',
    'custom_ai_key',
    // [FEAT-20260904-VENDORSECCOL] missing here = PUT answers 200 and the key is
    // dropped silently — the exact trap this list's header describes.
    'custom_ai_key_sec',
    'telegram_key',
    'telegram_chat_id',
    'gemini_temperature',
    'gemini_top_k',
    'gemini_top_p',
    'gemini_thinking_budget',
    // [P2-20260813] the vendor/model pair — missing here means a 200 response
    // with the value silently dropped, the trap this list's comments describe.
    'ai_vendor',
    'ai_model',
    // [FEAT-20260904-VENDORSECCOL] the second vendor's model — same trap.
    'ai_model_sec',
    // [FEAT-20260909-VENDORTRANSLATE] the translate lane's own vendor — same
    // trap again: omitted here, PUT answers 200 and the choice never lands.
    'ai_vendor_translate',
    /* [FEAT-20260918-HOOKTRANS] chat translation settings */
    'translate_lang',
    'auto_translate',
    // [FEAT-20260909-DSREASONING] the five new reasoning knobs — same trap,
    // third time today. `gemini_thinking_budget` is already listed above and is
    // deliberately not repeated.
    'gemini_thinking_budget_translate',
    'deepseek_thinking',
    'deepseek_reasoning_effort',
    'deepseek_thinking_translate',
    'deepseek_reasoning_effort_translate',
    'ai_history_limit',
    'ai_need_detail_limit',
    'ai_raw_json_analysis',
    'ai_raw_site_rules',
    // [FEAT-20260810-DOCRETRIEVAL] omit this and the flag is dropped silently
    // on every save — the trap this file's header warns about.
    'doc_retrieval',
    // [FEAT-20261026-RAGENGINE] the engine's two modes — same trap, same cure.
    'rag_prompt_mode',
    'rag_search_mode',
    // [FEAT-20260830-STABLEPROMPT] same trap, same cure.
    'ai_stable_prompt',
    // [FEAT-20260821-IGNOREABANDON] the same trap: `createHook` does NOT use
    // this list, so leaving the field out here would make create work and edit
    // silently do nothing. สร้างได้ แก้ไม่ติด = อาการของการลืมบรรทัดนี้.
    'ignore_abandon_assist',
    'domain_name',
    'ai_raw_json_rules',
    'ai_site_rules_guide',
    'telegram_noti_type',
    'image_answer_text',
    'answer_link',
    'customer_helper_text',
    'flex_profile_id',
    // [FEAT-20260810-CUSHELPERTYPE] ไม่ใส่ที่นี่ = ค่าถูกตัดทิ้งเงียบ ๆ ตอน save
    'flex_customerhelper_id',
    'flex_custom_ids',
    'flex_profile_custom_ids',
    'slip_verify_key',
    'match_account',
    'group',
    'flex_success',
    'flex_fail',
    'flex_other',
    'flex_duplicate',
    'flex_not_found',
    'flex_min_amount',
    'flex_error',
    'flex_success_not_match',
    'flex_out_of_time',
    'flex_max_amount',
    /* [FEAT-20260810-PAYSTATEFLEX] one card per payment reply state (1 state = 1
     * card). Omit this and every selection an admin makes is dropped silently on
     * save — the same trap `doc_retrieval` and `flex_customerhelper_id` above are
     * commented for. A missing key inside the map is a legal "not set", so `{}`
     * keeps every state on its current reply. ไม่ใส่ที่นี่ = เลือกการ์ดแล้วหาย. */
    'payment_flex_ids',
    'qr_code_fail_anwser_text',
    'match_account_number',
    /* [FEAT-20260902-SLIPPROVIDER] omit this and PUT answers 200 while the value
       never persists — create would work and edit would silently do nothing. */
    'slip_provider',
    /* [FEAT-20260903-VENDORBRANCH] the OA's sub-account at its provider. Same
       trap as the line above: leave it out and an admin's branch number is
       dropped on save with a 200 back, so the vendor answers "branch not found"
       on every slip and nothing anywhere points at the dashboard. */
    'slip_verify_branch',
    /* [FIX-20260903-HOSTNOTAFIELD] `slip_verify_base_url` sat here and is gone on
       purpose: the host is `provider.defaultBaseUrl`, not something an operator
       sends. Re-listing it would let a payload write a dead field. */
    'slip_check',
    // [REQUIREPROFILE] refuse a slip from a non-customer + its message.
    'slip_require_profile',
    'slip_require_profile_text',
    /* [FEAT-20260812-QRPRESCAN] omit this and a PUT silently drops the value while
       still answering 200 (see the warning at the end of this list).
       revert: delete this line */
    'qr_prescan_mode',
    /* [FIX-20260812-HELPERMARKERLEAK] omit this line and a PUT silently drops the
       value while still answering 200 (see the warning at the end of this list).
       revert: delete this line */
    'hook_text_reply_mode',
    'slip_check_min_amount',
    'slip_check_max_amount',
    'slip_check_out_of_time',
    'callback_slip',
    'callback_token',
    'callback_action',
    'external_api_url',
    'external_user',
    'external_password',
    'external_endpoints',
    'chat_bot_id',
    'customer_link_enabled',
    'customer_link_landing_url',
    'customer_link_web_code',
    'custom_tool_status',
    'custom_tool_id',
    /**
     * [FEAT-20260808-PAYTOOL-P4] WHAT: the separate payment-tool binding pair,
     * placed immediately after its `custom_tool_*` siblings.
     *
     * WHY: these two are the ONLY writable surface for the payment kill switch,
     * and this array is the only filter updateHook applies. Without them the PUT
     * dropped both keys silently and still answered 200 — the exact "operator
     * saves, screen says success, value never persists, nothing in any log"
     * failure this list's header warns about. เพิ่มต่อท้ายคู่ custom_tool_*
     * เพื่อให้ลำดับของ legacy ไม่ขยับ (ลำดับ array นี้ไม่ได้ถูกส่งออกไปหา client
     * แต่ header สั่งไว้ว่าให้คงลำดับเดิม จึงต่อท้ายแทนการแทรกกลาง).
     *
     * No normaliser is registered for these below — deliberately, because
     * `custom_tool_status`/`custom_tool_id` have none either: both pass through
     * raw and let Mongoose cast (Boolean / ObjectId) on findByIdAndUpdate with
     * runValidators. Mirroring that keeps a bad `payment_tool_id` a 400 CastError
     * on exactly the same path as a bad `custom_tool_id`.
     *
     * HOW TO CHANGE: to make the payment binding read-only again, delete these
     * two lines; the field stays on the schema and the PUT goes back to
     * dropping it.
     * revert: delete the two entries below.
     */
    'payment_tool_status',
    'payment_tool_id',
    // [WALLETPAYTOOL] walletpay lives in its own tool (different host). Additive:
    // absent / null ⇒ the runner uses the payment tool's own pay_walletpay endpoint.
    'walletpay_tool_status',
    'walletpay_tool_id',
  ];

  /**
   * Re-encrypts a secret unless the submitted plaintext already matches what is
   * stored, in which case the STORED CIPHERTEXT is kept byte-for-byte.
   *
   * That reuse is not an optimisation. Encryption here is randomised (fresh IV
   * per call), so re-encrypting an unchanged secret produces different bytes,
   * and the audit diff below compares stored values — every save would then log
   * a spurious "external_password changed" against a field nobody touched.
   * Legacy does this for all five secrets. Source: hookController.js:1573-1592.
   */
  private updateSecretField(submitted: unknown, existing: unknown): unknown {
    const value = W.trimIfString(submitted);
    /**
     * [FIX-20260817-BLANKSECRET] A BLANK is not an instruction to erase.
     *
     * The edit form posts every field it holds, so a secret that never loaded
     * into the form arrives as `''` — and returning that blank wrote it over a
     * live credential on a save that touched something else entirely (seen on
     * production: an OA's channel secret and AI key emptied by a rename).
     * `undefined` is the only value Mongoose drops from `findByIdAndUpdate`,
     * so returning it keeps the stored secret byte-for-byte (verified against
     * a real collection, not assumed).
     *
     * `null` still clears, because that is an operator deliberately removing a
     * credential — the two cases are told apart HERE and nowhere else.
     * ค่าว่าง = ฟอร์มไม่ได้ถือค่ามา ห้ามทับ · null = ตั้งใจล้าง ต้องล้างได้
     * revert: `if (!value) return value;`
     */
    if (submitted === null) return null;
    if (!value) return undefined;
    // safeDecrypt returns the input unchanged when it is not ciphertext, so a
    // hook whose secret was stored in plaintext still compares correctly.
    const existingPlain = this.crypto.safeDecrypt(existing as string);
    if (existingPlain === value) return existing;
    return this.crypto.encrypt(value as string);
  }

  /**
   * Updates one hook, field-whitelisted.
   *
   * This is the endpoint behind the OA edit screen's Save button. It differs
   * from createHook in three ways that matter, all of them legacy's doing:
   *   · unknown keys are dropped silently (see ALLOWED_UPDATES above);
   *   · secrets are compared against the stored value before re-encrypting;
   *   · `ai_raw_json_rules` is validated against the MERGE of body and stored
   *     document, not the body alone, so a form that posts one half of the pair
   *     is not rejected for the half it did not send.
   * Legacy: hookController.js:1350-1765.
   */
  async updateHook(
    id: string,
    rawBody: W.FieldBag,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const body: W.FieldBag = { ...rawBody };
    const user = ctx.user;

    W.stripKeptSecrets(body, SENSITIVE_FIELDS, SECRET_MASK);

    // [FIX-20260817-MANGLEDMASK] A value that still LOOKS like the placeholder
    // is a hand-edited mask, never a real credential — writing it destroys a
    // live key (it did, on 17/08). Refuse the whole save, loudly.
    {
      const mangled = W.findMangledSentinels(
        body,
        SENSITIVE_FIELDS,
        SECRET_MASK,
      );
      if (mangled.length) {
        throw new BadRequestException(
          `${mangled.join(', ')}: value looks like the masked placeholder — ` +
            'press its edit button and enter the real value (or cancel the edit)',
        );
      }
    }

    if (!isValidObjectId(id)) {
      throw new BadRequestException('invalid hook id');
    }
    const forceGrant = W.isTrueFlag(body['force_grant']);

    const existingHook = await this.hookModel
      .findById(id)
      .lean<LeanHook>()
      .exec();
    if (!existingHook) throw new HookNotFoundException();

    /**
     * ⚠️ Legacy's guard order, reproduced exactly: a non-superuser hitting a
     * hook with NO group gets "group access is required" (403) BEFORE
     * ensureGroupAccess is consulted, and a hook with a group is checked by
     * ensureGroupAccess. A superuser skips both. Collapsing this into a single
     * ensureGroupAccess call changes the message for the groupless case.
     */
    if (!this.isSuperUser(user) && !existingHook['group']) {
      throw new ForbiddenException('group access is required');
    }
    if (existingHook['group']) {
      this.ensureGroupAccess(user, existingHook['group']);
    }
    // [FIX-20260818-HOOKWRITESCOPE] tier 2 — the group check above never reads
    // `allowed_hooks`, so an operator provisioned for one OA could edit any OA
    // in their group by id.
    await assertHookInScope(user, this.hookModel, existingHook['_id']);

    const updates: W.FieldBag = {};
    for (const key of Object.keys(body)) {
      if (HooksService.ALLOWED_UPDATES.includes(key)) {
        updates[key] = body[key];
      }
    }

    // ── normalisers, in legacy's order (the order decides which 400 wins) ──
    if (Object.prototype.hasOwnProperty.call(updates, 'fast_mode')) {
      const normalized = W.parseFastModeInput(updates['fast_mode']);
      // Unparseable fast_mode is DROPPED, not rejected — createHook keeps the
      // raw value instead. The two paths genuinely differ here.
      if (normalized !== undefined) updates['fast_mode'] = normalized;
      else delete updates['fast_mode'];
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'suggestion_text')) {
      updates['suggestion_text'] = W.normalizeSuggestionField(
        updates['suggestion_text'],
        'suggestion_text',
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(updates, 'suggestion_company_text')
    ) {
      updates['suggestion_company_text'] = W.normalizeSuggestionField(
        updates['suggestion_company_text'],
        'suggestion_company_text',
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(
        updates,
        'suggestion_text_no_profile',
      )
    ) {
      updates['suggestion_text_no_profile'] = W.normalizeSuggestionField(
        updates['suggestion_text_no_profile'],
        'suggestion_text_no_profile',
      );
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'default_answer_text')) {
      updates['default_answer_text'] = W.trimToString(
        updates['default_answer_text'],
      );
    }
    // [FIX-20260808-AIGENERROR] Same trim on the update path.
    if (
      Object.prototype.hasOwnProperty.call(updates, 'ai_generative_error_text')
    ) {
      updates['ai_generative_error_text'] = W.trimToString(
        updates['ai_generative_error_text'],
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(updates, 'missing_api_data_text')
    ) {
      updates['missing_api_data_text'] = W.normalizeMissingApiDataText(
        updates['missing_api_data_text'],
      );
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'status_off_action')) {
      updates['status_off_action'] = W.normalizeStatusOffAction(
        updates['status_off_action'],
      );
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'status_off_text')) {
      updates['status_off_text'] = W.normalizeStatusOffText(
        updates['status_off_text'],
      );
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'flex_custom_ids')) {
      updates['flex_custom_ids'] = await this.normalizeFlexCustomIds(
        updates['flex_custom_ids'],
        user,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(updates, 'flex_profile_custom_ids')
    ) {
      updates['flex_profile_custom_ids'] = await this.normalizeFlexCustomIds(
        updates['flex_profile_custom_ids'],
        user,
        'profile-semi-custom',
      );
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'gemini_temperature')) {
      updates['gemini_temperature'] = W.parseGeminiTemperature(
        updates['gemini_temperature'],
      );
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'gemini_top_k')) {
      updates['gemini_top_k'] = W.parseGeminiTopK(updates['gemini_top_k']);
    }
    // [P2-20260813] hasOwnProperty, not `!== undefined`: an explicit null must
    // still clear the field back to the default vendor/model.
    if (Object.prototype.hasOwnProperty.call(updates, 'ai_vendor')) {
      updates['ai_vendor'] = parseAiVendor(updates['ai_vendor']);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'ai_model')) {
      updates['ai_model'] = parseAiModel(updates['ai_model']);
    }
    // [FEAT-20260904-VENDORSECCOL] the second vendor's model, same parser.
    if (Object.prototype.hasOwnProperty.call(updates, 'ai_model_sec')) {
      updates['ai_model_sec'] = parseAiModel(updates['ai_model_sec']);
    }
    // [FEAT-20260909-VENDORTRANSLATE] hasOwnProperty for the same reason as
    // `ai_vendor` above: an explicit null is how an operator says "go back to
    // following the main vendor", and `!== undefined` would silently ignore it.
    if (Object.prototype.hasOwnProperty.call(updates, 'ai_vendor_translate')) {
      updates['ai_vendor_translate'] = parseAiVendor(
        updates['ai_vendor_translate'],
        'ai_vendor_translate',
      );
    }
    /* [FEAT-20260918-HOOKTRANS] chat translation settings */
    if (Object.prototype.hasOwnProperty.call(updates, 'translate_lang')) {
      updates['translate_lang'] = parseHookTranslateLang(
        updates['translate_lang'],
      );
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'auto_translate')) {
      updates['auto_translate'] = Boolean(updates['auto_translate']);
    }
    // [FEAT-20260909-DSREASONING] hasOwnProperty, so an explicit null clears.
    for (const f of ['deepseek_thinking', 'deepseek_thinking_translate']) {
      if (Object.prototype.hasOwnProperty.call(updates, f)) {
        updates[f] = parseDeepSeekThinking(updates[f], f);
      }
    }
    for (const f of [
      'deepseek_reasoning_effort',
      'deepseek_reasoning_effort_translate',
    ]) {
      if (Object.prototype.hasOwnProperty.call(updates, f)) {
        updates[f] = parseDeepSeekReasoningEffort(updates[f], f);
      }
    }
    if (
      Object.prototype.hasOwnProperty.call(
        updates,
        'gemini_thinking_budget_translate',
      )
    ) {
      updates['gemini_thinking_budget_translate'] = W.parseGeminiThinkingBudget(
        updates['gemini_thinking_budget_translate'],
      );
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'gemini_top_p')) {
      updates['gemini_top_p'] = W.parseGeminiTopP(updates['gemini_top_p']);
    }
    if (
      Object.prototype.hasOwnProperty.call(updates, 'gemini_thinking_budget')
    ) {
      updates['gemini_thinking_budget'] = W.parseGeminiThinkingBudget(
        updates['gemini_thinking_budget'],
      );
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'ai_history_limit')) {
      updates['ai_history_limit'] = W.parseAiHistoryLimit(
        updates['ai_history_limit'],
      );
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'ai_need_detail_limit')) {
      updates['ai_need_detail_limit'] = W.parseAiNeedDetailLimit(
        updates['ai_need_detail_limit'],
      );
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'ai_raw_json_analysis')) {
      updates['ai_raw_json_analysis'] = W.parseAiRawJsonAnalysis(
        updates['ai_raw_json_analysis'],
      );
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'ai_raw_site_rules')) {
      updates['ai_raw_site_rules'] = W.parseAiRawSiteRules(
        updates['ai_raw_site_rules'],
      );
    }
    // [FEAT-20260810-DOCRETRIEVAL] same discipline as the sibling above.
    if (Object.prototype.hasOwnProperty.call(updates, 'doc_retrieval')) {
      updates['doc_retrieval'] = W.parseDocRetrieval(updates['doc_retrieval']);
    }
    // [FEAT-20261026-RAGENGINE] update half of the create-path parse above.
    if (Object.prototype.hasOwnProperty.call(updates, 'rag_prompt_mode')) {
      updates['rag_prompt_mode'] = W.parseRagPromptMode(
        updates['rag_prompt_mode'],
      );
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'rag_search_mode')) {
      updates['rag_search_mode'] = W.parseRagSearchMode(
        updates['rag_search_mode'],
      );
    }
    // [FEAT-20260830-STABLEPROMPT] update half of the create-path parse above.
    if (Object.prototype.hasOwnProperty.call(updates, 'ai_stable_prompt')) {
      updates['ai_stable_prompt'] = W.parseAiStablePrompt(
        updates['ai_stable_prompt'],
      );
    }
    // [FEAT-20260821-IGNOREABANDON] `hasOwnProperty`, not `!== undefined`: an
    // explicit clear must reach the parser too.
    if (
      Object.prototype.hasOwnProperty.call(updates, 'ignore_abandon_assist')
    ) {
      updates['ignore_abandon_assist'] = W.parseIgnoreAbandonAssist(
        updates['ignore_abandon_assist'],
      );
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'ai_raw_json_rules')) {
      updates['ai_raw_json_rules'] = W.parseAiRawJsonRules(
        updates['ai_raw_json_rules'],
      );
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'ai_site_rules_guide')) {
      updates['ai_site_rules_guide'] = W.parseAiSiteRulesGuide(
        updates['ai_site_rules_guide'],
      );
    }
    /**
     * Checked against the MERGED value, not the submitted one: the form can
     * post `ai_raw_json_analysis` alone, and rejecting it for a rules field it
     * never sent would break saving from the AI tab. Legacy:1545-1554.
     */
    W.assertRawJsonRulesPresent(
      Object.prototype.hasOwnProperty.call(updates, 'ai_raw_json_analysis')
        ? updates['ai_raw_json_analysis']
        : existingHook['ai_raw_json_analysis'],
      Object.prototype.hasOwnProperty.call(updates, 'ai_raw_json_rules')
        ? updates['ai_raw_json_rules']
        : existingHook['ai_raw_json_rules'],
    );

    // ── credentials verified against their issuer, then encrypted ──────────
    // ⚠️ These four read `body`, not `updates`: legacy keys them off the RAW
    // request. For custom_ai_key/doc_id/line_key that is a real difference —
    // each validator receives the EXISTING stored value as a fallback, so
    // posting a blank keeps what is already there rather than clearing it.
    if (body['custom_ai_key'] !== undefined) {
      /* [FEAT-20260904-VENDORSECCOL] Gemini's column ⇒ Gemini's probe, always.
         It used to resolve "submitted vendor, else the stored one", which was
         the best answer available while one column served both vendors. */
      updates['custom_ai_key'] = await this.ensureValidCustomAiKeyForUpdate(
        body['custom_ai_key'],
        existingHook['custom_ai_key'],
        VENDOR_GEMINI,
      );
    }
    if (body['custom_ai_key_sec'] !== undefined) {
      // [FEAT-20260904-VENDORSECCOL] DeepSeek's column ⇒ DeepSeek's probe.
      updates['custom_ai_key_sec'] = await this.ensureValidCustomAiKeyForUpdate(
        body['custom_ai_key_sec'],
        existingHook['custom_ai_key_sec'],
        VENDOR_DEEPSEEK,
      );
    }
    if (body['doc_id'] !== undefined) {
      updates['doc_id'] = await this.ensureValidDocIdForUpdate(
        body['doc_id'],
        existingHook['doc_id'],
      );
    }
    if (body['line_key'] !== undefined) {
      updates['line_key'] = await this.ensureValidLineKeyForUpdate(
        body['line_key'],
        existingHook['line_key'],
      );
    }
    if (body['telegram_key'] !== undefined) {
      updates['telegram_key'] = this.updateSecretField(
        body['telegram_key'],
        existingHook['telegram_key'],
      );
    }
    if (body['line_secret'] !== undefined) {
      updates['line_secret'] = this.updateSecretField(
        body['line_secret'],
        existingHook['line_secret'],
      );
    }
    if (body['channel_secret'] !== undefined) {
      updates['channel_secret'] = this.updateSecretField(
        body['channel_secret'],
        existingHook['channel_secret'],
      );
    }
    if (body['access_token'] !== undefined) {
      updates['access_token'] = this.updateSecretField(
        body['access_token'],
        existingHook['access_token'],
      );
    }

    /**
     * Write-side sync for a LEGACY hook (credentials stored under line_*).
     * The UI edits the channel_* fields and access_token; if this OA has no
     * channel_* of its
     * own but does have line_*, the new value is mirrored back onto line_* so
     * the webhook signature check (reads line_secret) and outbound push (reads
     * line_key) keep working after an edit. A channel_*-native hook never gains
     * line_* fields. Legacy:1594-1613.
     */
    const isLegacyHook =
      (existingHook['line_key'] ||
        existingHook['line_secret'] ||
        existingHook['line_id']) &&
      !existingHook['channel_secret'] &&
      !existingHook['access_token'];
    if (isLegacyHook) {
      if (
        body['channel_id'] !== undefined &&
        updates['channel_id'] !== undefined
      ) {
        // channel_id / line_id are plain, not encrypted.
        updates['line_id'] = updates['channel_id'];
      }
      if (
        body['channel_secret'] !== undefined &&
        updates['channel_secret'] !== undefined
      ) {
        updates['line_secret'] = updates['channel_secret'];
      }
      if (
        body['access_token'] !== undefined &&
        updates['access_token'] !== undefined
      ) {
        updates['line_key'] = updates['access_token'];
      }
    }

    /**
     * ⚠️ Flex ids are keyed off `body`, and the empty case is checked BEFORE
     * the ObjectId test, so `""` / null / 0 clear the field to null instead of
     * being rejected. createHook's loop is subtly different (it only maps `""`).
     * Legacy:1615-1637.
     */
    for (const field of W.FLEX_FIELDS) {
      if (body[field] === undefined) continue;
      if (!body[field] || body[field] === '') {
        updates[field] = null;
      } else if (isValidObjectId(body[field] as string)) {
        updates[field] = body[field];
      } else {
        throw new BadRequestException(`Invalid identifier for ${field}`);
      }
    }

    if (body['qr_code_fail_anwser_text'] !== undefined) {
      updates['qr_code_fail_anwser_text'] = W.legacyString(
        body['qr_code_fail_anwser_text'],
      ).trim();
    }
    if (body['match_account_number'] !== undefined) {
      updates['match_account_number'] = W.legacyString(
        body['match_account_number'],
      ).trim();
    }
    if (body['slip_check'] !== undefined) {
      updates['slip_check'] = Boolean(body['slip_check']);
    }
    for (const field of [
      'slip_check_min_amount',
      'slip_check_max_amount',
      'slip_check_out_of_time',
    ]) {
      if (body[field] !== undefined) {
        updates[field] = W.parseAmountOrNull(body[field]);
      }
    }
    if (body['telegram_chat_id'] !== undefined) {
      updates['telegram_chat_id'] = W.trimIfString(body['telegram_chat_id']);
    }
    if (body['callback_action'] !== undefined) {
      const action = W.normalizeCallbackAction(body['callback_action']);
      // An unrecognised action leaves the stored value untouched — legacy does
      // not reject it, and `updates` keeps whatever the whitelist copied in.
      if (action !== undefined) updates['callback_action'] = action;
    }
    if (body['external_api_url'] !== undefined) {
      updates['external_api_url'] =
        typeof body['external_api_url'] === 'string'
          ? body['external_api_url'].trim()
          : '';
    }
    if (body['external_user'] !== undefined) {
      updates['external_user'] =
        typeof body['external_user'] === 'string'
          ? body['external_user'].trim()
          : '';
    }
    if (body['external_password'] !== undefined) {
      // Non-strings collapse to "" here rather than passing through, so this
      // cannot use updateSecretField's trimIfString.
      const ep =
        typeof body['external_password'] === 'string'
          ? body['external_password'].trim()
          : '';
      /**
       * [FIX-20260817-BLANKSECRET] Same rule as updateSecretField, written out
       * because this handler keeps its own "non-string ⇒ ''" coercion: a blank
       * is the form failing to carry the value, NOT an instruction to erase.
       * Only an explicit `null` clears. This one is inline rather than shared,
       * which is exactly why the first pass of this fix missed it.
       * revert: `: ep ? this.crypto.encrypt(ep) : ep;`
       */
      if (body['external_password'] === null) {
        updates['external_password'] = null;
      } else if (!ep) {
        updates['external_password'] = undefined;
      } else {
        const existingEpPlain = this.crypto.safeDecrypt(
          existingHook['external_password'] as string,
        );
        updates['external_password'] =
          existingEpPlain === ep
            ? existingHook['external_password']
            : this.crypto.encrypt(ep);
      }
    }
    if (body['slip_verify_key'] !== undefined) {
      const sk = W.trimToString(body['slip_verify_key']);
      // [FIX-20260817-BLANKSECRET] blank keeps, explicit null clears — see the
      // external_password block above and updateSecretField for the reasoning.
      // revert: `: sk ? this.crypto.encrypt(sk) : sk;`
      if (body['slip_verify_key'] === null) {
        updates['slip_verify_key'] = null;
      } else if (!sk) {
        updates['slip_verify_key'] = undefined;
      } else {
        const existingSkPlain = this.crypto.safeDecrypt(
          existingHook['slip_verify_key'] as string,
        );
        updates['slip_verify_key'] =
          existingSkPlain === sk
            ? existingHook['slip_verify_key']
            : this.crypto.encrypt(sk);
      }
    }
    if (body['external_endpoints'] !== undefined) {
      updates['external_endpoints'] =
        typeof body['external_endpoints'] === 'object' &&
        body['external_endpoints'] !== null
          ? body['external_endpoints']
          : {};
    }
    if (body['callback_token'] !== undefined) {
      updates['callback_token'] = W.normalizeCallbackToken(
        body['callback_token'],
      );
    }
    if (body['callback_slip'] !== undefined) {
      updates['callback_slip'] = W.parseCallbackSlip(body['callback_slip']);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'group')) {
      updates['group'] = await this.resolveGroupId(updates['group']);
      // Re-checked against the NEW group: moving an OA into a group the caller
      // cannot see would otherwise hand it away.
      this.ensureGroupAccess(user, updates['group']);
    }

    W.mirrorHookChannelFields(updates);

    const hook = await this.hookModel
      .findByIdAndUpdate(id, updates, { new: true, runValidators: true })
      .lean<LeanHook>()
      .exec();
    if (!hook) throw new HookNotFoundException();

    // ── CACHE TRIGGER 3/5 (hookController.js:1727) ────────────────────────
    // previousAlias matters here: a renamed OA must have its OLD alias evicted,
    // or the webhook path keeps resolving the stale entry.
    await this.hookCache.cacheHook(hook, {
      previousAlias: existingHook['alias'] as string | undefined,
    });

    /* [FEAT-20260828-FORCEGRANTCOUNT] เก็บผลไว้ตอบกลับ ไม่ทิ้ง
       ⚠️ `null` = ไม่ได้ติ๊ก · ต่างจาก `{granted:0}` = ติ๊กแล้วแต่ไม่มีใครต้องเพิ่ม
          สองอย่างนี้ต้องแยกออกจากกันบนหน้าจอ */
    let forceGrantReport: ForceGrantReport | null = null;
    if (forceGrant && hook['group']) {
      forceGrantReport = await this.grantHookToGroupUsers(
        hook['_id'],
        hook['group'],
      );
    }

    /**
     * One audit row listing every whitelisted key that was SUBMITTED — not
     * every key that actually changed. Legacy diffs `Object.keys(updates)` and
     * records from/to even when they are equal, so re-saving an untouched form
     * still writes a row. Preserved: the history screen's row count is the
     * behaviour operators already read.
     */
    /**
     * [FIX-20260817-BLANKSECRET] `undefined` entries are the keys the secret
     * guards declined to write (a blank submission). Mongoose skipped them, so
     * listing them here would log a change that never happened — and on the
     * history screen a secret would appear "touched" on every unrelated save.
     * Keys the caller really submitted still appear, equal-valued ones included,
     * which is the legacy row count described above.
     */
    const changedFields = Object.keys(updates)
      .filter((field) => updates[field] !== undefined)
      .map((field) => ({
        field,
        from: existingHook[field],
        to: hook[field],
      }));
    if (changedFields.length > 0) {
      this.auditLog.writeInBackground(
        {
          ref_id: hook['_id'],
          hook_id: hook['_id'],
          group_id: hook['group'] ?? null,
          parent: 'hook',
          action: 'update',
          changed_fields: changedFields,
          actor: this.buildActor(ctx),
          request_meta: this.buildRequestMeta(ctx),
          note: body['audit_note'] as string | undefined,
        },
        'audit log update failed',
      );
    }

    // [FIX-20260808-HOOKSECRETMASK] Mask sensitive fields in the write response
    // exactly like getHookById (H-S3). Returning mapBangkokTime alone handed the
    // decrypted access_token / line_key / *_secret / *_key back in the PUT body to
    // any group member — these routes carry no hook.manage gate by design, so the
    // response was a straight secret leak. The dashboard already consumes the
    // masked marker shape from the detail endpoint, so this is seamless.
    /* [FEAT-20260828-FORCEGRANTCOUNT] เพิ่มคีย์เดียวแบบ additive
       🔴 ไม่แตะ body เดิมสักคีย์ — ผู้เรียกเดิมทุกตัวอ่านสิ่งที่เคยอ่านได้เหมือนเดิม
          และคีย์นี้ **ไม่โผล่เลย** เมื่อไม่ได้ติ๊ก ⇒ คำตอบของคำขอปกติเหมือนเดิมทุกไบต์ */
    const detail = this.maskSecretsForDetail(this.mapBangkokTime(hook)) ?? {};
    return forceGrantReport
      ? { ...detail, force_grant_result: forceGrantReport }
      : detail;
  }

  // ─────────────────────────────────────────────────────────────────────
  // PATCH /hook/status
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Toggles one hook on or off.
   *
   * ⚠️ Legacy's LINE webhook-registration block (hookController.js:1804-1925)
   * is commented out in the source — "TEMPORARILY COMMENTED OUT PER USER
   * REQUEST TO PREVENT 'Invalid webhook endpoint URL'". It is not ported: dead
   * code, and porting it would add an outbound LINE call this endpoint does not
   * make today. `webhook_steps` therefore never appears in the response, which
   * is exactly what legacy returns (the array is built empty and the key is
   * only attached when non-empty).
   */
  async updateHookStatus(
    body: W.FieldBag,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const id = body['id'];
    if (!id) throw new BadRequestException('id is required');
    const normalizedStatus = W.parseStatusFlag(body['status']);

    const existingHook = await this.hookModel
      .findById(id)
      .lean<LeanHook>()
      .exec();
    if (!existingHook) throw new HookNotFoundException();

    // Guard added in legacy to match updateHook — without it any authenticated
    // caller could toggle another group's OA with nothing but its id.
    this.ensureGroupAccess(ctx.user, existingHook['group']);
    // [FIX-20260818-HOOKWRITESCOPE] tier 2 — see updateHook.
    await assertHookInScope(ctx.user, this.hookModel, existingHook['_id']);

    const hook = await this.hookModel
      .findByIdAndUpdate(
        id as string,
        { status: normalizedStatus },
        { new: true, runValidators: true },
      )
      .lean<LeanHook>()
      .exec();
    if (!hook) throw new HookNotFoundException();

    // ── CACHE TRIGGER 2/5 (hookController.js:1933) ──────────────────────
    // previousAlias is passed even though this endpoint cannot change an
    // alias: it is what legacy does, and it costs nothing when the two match.
    await this.hookCache.cacheHook(hook, {
      previousAlias: existingHook['alias'] as string | undefined,
    });

    if (existingHook['status'] !== hook['status']) {
      this.auditLog.writeInBackground(
        {
          ref_id: hook['_id'],
          hook_id: hook['_id'],
          group_id: hook['group'] ?? null,
          parent: 'hook',
          action: 'update',
          changed_fields: [
            {
              field: 'status',
              from: existingHook['status'],
              to: hook['status'],
            },
          ],
          actor: this.buildActor(ctx),
          request_meta: this.buildRequestMeta(ctx),
          note: body['audit_note'] as string | undefined,
        },
        'audit log update failed',
      );
    }

    // [FIX-20260808-HOOKSECRETMASK] Mask the write response like getHookById
    // (H-S3) — PATCH /hook/status also returned the decrypted secrets to any
    // group member. Same masked marker shape the dashboard already handles.
    return this.maskSecretsForDetail(this.mapBangkokTime(hook)) ?? {};
  }

  // ─────────────────────────────────────────────────────────────────────
  // PATCH /hook/status/bulk  and  PATCH /hook/settings/bulk
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Loads the hooks a bulk request names and refuses the WHOLE request if the
   * caller may not touch any one of them.
   *
   * All-or-nothing on purpose (lifted from `bulkUpdatePermissions` in the user
   * controller): half a batch applied and then an error is worse than no batch,
   * because the operator cannot tell which half. The 403 names the offending
   * aliases — someone who ticked twenty OAs needs to know which to untick.
   */
  private async loadBulkTargets(
    rawIds: unknown,
    ctx: RequestContext,
  ): Promise<LeanHook[]> {
    const ids = Array.isArray(rawIds) ? rawIds.filter(Boolean) : [];
    if (ids.length === 0) throw new BadRequestException('ids is required');

    const validIds = ids.filter((id) => isValidObjectId(id as string));
    if (validIds.length === 0) {
      throw new BadRequestException('no valid hook id');
    }

    const hooks = await this.hookModel
      .find({ _id: { $in: validIds } })
      .lean<LeanHook[]>()
      .exec();
    if (hooks.length === 0) throw new NotFoundException('no matching hooks');

    const blocked: BlockedHook[] = [];
    for (const hook of hooks) {
      try {
        this.ensureGroupAccess(ctx.user, hook['group']);
        // [FIX-20260818-HOOKWRITESCOPE] tier 2, inside the same try so an
        // out-of-scope OA lands in `blocked` exactly like a wrong-group one.
        await assertHookInScope(ctx.user, this.hookModel, hook['_id']);
      } catch (error) {
        blocked.push({
          alias: (hook['alias'] as string) || String(hook['_id']),
          reason: (error as Error).message || 'no access',
        });
      }
    }
    if (blocked.length > 0) throw new BlockedHooksException(blocked);

    return hooks;
  }

  /** Writes one audit entry per changed hook, fire-and-forget as legacy does. */
  private auditBulk(
    targets: LeanHook[],
    change: (hook: LeanHook) => AuditChange,
    note: string,
    ctx: RequestContext,
    label: string,
  ): void {
    for (const hook of targets) {
      this.auditLog.writeInBackground(
        {
          ref_id: String(hook['_id']),
          hook_id: hook['_id'],
          group_id: hook['group'] ?? null,
          parent: 'hook',
          action: 'update',
          changed_fields: [change(hook)],
          actor: this.buildActor(ctx),
          request_meta: this.buildRequestMeta(ctx),
          note,
        },
        label,
      );
    }
  }

  async bulkUpdateHookStatus(
    body: W.FieldBag,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    // Order matters: legacy checks ids, THEN status, then id validity. A body
    // that is wrong in two ways must fail on the same one on both backends.
    const ids = Array.isArray(body['ids']) ? body['ids'].filter(Boolean) : [];
    if (ids.length === 0) throw new BadRequestException('ids is required');
    const normalizedStatus = W.parseStatusFlag(body['status']);

    const hooks = await this.loadBulkTargets(body['ids'], ctx);

    // Already at the target value = nothing to write. Idempotent by design.
    const targets = hooks.filter((h) => h['status'] !== normalizedStatus);
    if (targets.length === 0) {
      return {
        success: true,
        matched: hooks.length,
        modified: 0,
        aliases: hooks.map((h) => (h['alias'] as string) || String(h['_id'])),
      };
    }

    const result = await this.hookModel
      .updateMany(
        { _id: { $in: targets.map((h) => h['_id']) } },
        { $set: { status: normalizedStatus } },
      )
      .exec();

    // ── CACHE TRIGGER 3/5 (hookController.js:2045) ──────────────────────
    // Per hook, or a webhook already in flight keeps reading the old status
    // from the cache. `previousAlias` evicts the key the row is filed under.
    for (const hook of targets) {
      await this.hookCache.cacheHook(
        { ...hook, status: normalizedStatus },
        { previousAlias: hook['alias'] as string | undefined },
      );
    }

    this.auditBulk(
      targets,
      (hook) => ({
        field: 'status',
        from: hook['status'],
        to: normalizedStatus,
      }),
      (body['audit_note'] as string | undefined) || 'bulk status update',
      ctx,
      '[BULKSTATUS] audit log failed',
    );

    return {
      success: true,
      matched: hooks.length,
      modified: result.modifiedCount ?? targets.length,
      aliases: targets.map((h) => (h['alias'] as string) || String(h['_id'])),
    };
  }

  /**
   * Bulk-toggles ONE whitelisted boolean setting.
   *
   * `status` is deliberately absent from the whitelist — it has its own
   * endpoint with different semantics and a numeric type.
   */
  async bulkUpdateHookSetting(
    body: W.FieldBag,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const ids = Array.isArray(body['ids']) ? body['ids'].filter(Boolean) : [];
    if (ids.length === 0) throw new BadRequestException('ids is required');

    const field = typeof body['field'] === 'string' ? body['field'] : '';
    if (!W.BULK_SETTING_FIELDS.includes(field)) {
      throw new BadRequestException(
        'field must be one of: ' + W.BULK_SETTING_FIELDS.join(', '),
      );
    }

    // A real boolean only: these flags have no coercion parser on the update
    // path, so "true" would be stored verbatim and read as truthy garbage.
    if (typeof body['value'] !== 'boolean') {
      throw new BadRequestException('value must be a boolean');
    }
    const value = body['value'];

    const hooks = await this.loadBulkTargets(body['ids'], ctx);

    const targets = hooks.filter((h) => Boolean(h[field]) !== value);
    if (targets.length === 0) {
      return {
        success: true,
        field,
        matched: hooks.length,
        modified: 0,
        aliases: hooks.map((h) => (h['alias'] as string) || String(h['_id'])),
      };
    }

    const result = await this.hookModel
      .updateMany(
        { _id: { $in: targets.map((h) => h['_id']) } },
        { $set: { [field]: value } },
      )
      .exec();

    // ── CACHE TRIGGER 4/5 (hookController.js:2154) ──────────────────────
    for (const hook of targets) {
      await this.hookCache.cacheHook(
        { ...hook, [field]: value },
        { previousAlias: hook['alias'] as string | undefined },
      );
    }

    this.auditBulk(
      targets,
      (hook) => ({ field, from: hook[field], to: value }),
      (body['audit_note'] as string | undefined) || `bulk ${field} update`,
      ctx,
      '[BULKSETTING] audit log failed',
    );

    return {
      success: true,
      field,
      matched: hooks.length,
      modified: result.modifiedCount ?? targets.length,
      aliases: targets.map((h) => (h['alias'] as string) || String(h['_id'])),
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // PATCH /hook/handoff/bulk — the per-OA handoff kill switch
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Turns handoff dispatch off (or back on) for a set of OAs.
   *
   * NEW ENDPOINT — legacy has no equivalent, so there is no legacy behaviour to
   * match for the endpoint itself. What must match legacy exactly is the DATA
   * SHAPE it writes: the runtime gate reads `scope.bindings[].enabled`
   * (`services/handoff/index.js:oaEnabled`), so that is the only field touched.
   *
   * Shape, group scoping, all-or-nothing semantics and audit rows mirror
   * `bulkUpdateHookSetting` above — an operator ticking OAs in the dashboard
   * gets the same contract whichever bulk action they use.
   *
   * ⚠️ WHAT THIS PROVES AND WHAT IT DOES NOT
   * This writes the flag the gate reads. The gate itself
   * (`oaEnabled`/`eligibleTargets`/`enqueue`) is NOT ported into this codebase
   * yet, so nothing here stops a dispatch at runtime — it sets the state that
   * will stop it once that code lands. Do not read a green test on this
   * endpoint as "handoff is disabled end to end".
   *
   * There is no `target_key` parameter by design; see
   * `HandoffTargetService.setBindingEnabledForHooks` for the invariant that
   * makes choosing a single target incoherent.
   */
  async bulkUpdateHookHandoff(
    body: W.FieldBag,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    // Same order of checks as the sibling bulk endpoints: ids, then value, then
    // id validity — so a body wrong in two ways fails on the same one here.
    const ids = Array.isArray(body['ids']) ? body['ids'].filter(Boolean) : [];
    if (ids.length === 0) throw new BadRequestException('ids is required');

    // A real boolean only. `"false"` is truthy and would silently enable an OA
    // the operator was trying to kill — the one direction that must never be
    // guessed on a money path.
    if (typeof body['value'] !== 'boolean') {
      throw new BadRequestException('value must be a boolean');
    }
    const value = body['value'];

    // Throws BlockedHooksException naming the aliases if the caller lacks
    // access to ANY id, before a single write — all-or-nothing.
    const hooks = await this.loadBulkTargets(body['ids'], ctx);

    const flip = await this.handoffBindings.setBindingEnabledForHooks(
      hooks.map((h) => h['_id'] as Types.ObjectId),
      value,
    );

    /*
     * Audited per hook that actually moved — NOT the whole batch.
     *
     * Auditing every named hook would record `from: !value` against OAs that
     * were already at the requested value, and against OAs bound to no target
     * at all, where nothing happened. That is a false entry in the trail an
     * operator later uses to reconstruct who killed which OA and when. A
     * repeated call therefore leaves no rows at all.
     */
    const changed = new Set(flip.changedHookIds);
    const auditable = hooks.filter((h) => changed.has(String(h['_id'])));
    if (auditable.length > 0) {
      this.auditBulk(
        auditable,
        () => ({ field: 'handoff_enabled', from: !value, to: value }),
        (body['audit_note'] as string | undefined) || 'bulk handoff update',
        ctx,
        '[BULKHANDOFF] audit log failed',
      );
    }

    return {
      success: true,
      matched: hooks.length,
      // Bindings flipped, not hooks — an OA bound to two targets counts twice.
      modified: flip.changedBindings,
      targets_modified: flip.modifiedTargets,
      aliases: hooks.map((h) => (h['alias'] as string) || String(h['_id'])),
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // PATCH /hook/payment/bulk — the per-OA payment kill switch
  // ─────────────────────────────────────────────────────────────────────

  /**
   * [FEAT-20260808-PAYTOOL-P4] Turns the payment tool ON or OFF for a set of OAs.
   *
   * WHAT: writes `payment_tool_status` across many hooks in one action — the
   * switch `payment-runner.service.ts` reads before it will do anything.
   *
   * WHY A DEDICATED ROUTE instead of adding 'payment_tool_status' to
   * `BULK_SETTING_FIELDS` (the one-line alternative):
   * `bulkUpdateHookSetting` is deliberately FIELD-GENERIC — it takes `field`
   * from the body and writes `$set: { [field]: value }` with no per-field step.
   * There is nowhere in it to put the enable-time readiness check below without
   * bolting an `if (field === 'payment_tool_status')` branch into a method whose
   * whole point is not having per-field branches. The whitelist route would
   * therefore have shipped the switch with NO validation at all. Modelled on
   * `bulkUpdateHookHandoff` above, which is the existing "new bulk kill switch"
   * precedent — same shape, same group scoping, same all-or-nothing contract.
   * ทำเป็น route แยกเพราะต้องมีด่านตรวจตอนเปิด ซึ่ง settings/bulk ใส่ไม่ได้.
   *
   * HOW TO CHANGE LATER: to fold this back into the generic route, delete this
   * method plus its controller entry and add 'payment_tool_status' to
   * `BULK_SETTING_FIELDS` in hook-write.helpers.ts — accepting that the
   * readiness check disappears with it.
   * revert: delete this method and its route.
   */
  async bulkUpdateHookPayment(
    body: W.FieldBag,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    // Same order of checks as every sibling bulk endpoint: ids, then value,
    // then id validity — a body wrong in two ways fails on the same one here.
    const ids = Array.isArray(body['ids']) ? body['ids'].filter(Boolean) : [];
    if (ids.length === 0) throw new BadRequestException('ids is required');

    /**
     * A real boolean only — copied verbatim from `bulkUpdateHookHandoff`.
     * `"false"` is a truthy STRING: coercing it would silently ENABLE payment
     * on an OA the operator was trying to kill. That is the one direction that
     * must never be guessed on a money path. ห้ามเดา — ต้องเป็น boolean แท้.
     */
    if (typeof body['value'] !== 'boolean') {
      throw new BadRequestException('value must be a boolean');
    }
    const value = body['value'];

    /**
     * No `confirm: true` gate, matching the three sibling bulk routes
     * (status, settings, handoff).
     * Only `cloneHookSettings` demands it, and for a different reason: clone
     * OVERWRITES many unrelated settings at once and is irreversible per field,
     * so it needs a stop. This endpoint writes ONE boolean that the same
     * endpoint can immediately write back — and the OFF direction is a kill
     * switch, which must never be gated behind a second required field an
     * integration might forget. Consistency with `handoff/bulk`, the closest
     * precedent, matters more here than borrowing clone's ceremony.
     * HOW TO CHANGE LATER: to require confirmation, add the same
     * `if (body['confirm'] !== true) throw ...` guard cloneHookSettings uses —
     * but gate it on `value === true` only, never on the OFF path.
     */

    // Throws BlockedHooksException naming the aliases if the caller lacks
    // access to ANY id, before a single write — all-or-nothing.
    const hooks = await this.loadBulkTargets(body['ids'], ctx);

    if (value === true) {
      await this.assertPaymentTargetsReady(hooks);
    }

    // Already at the target value = nothing to write, exactly as the sibling
    // bulk routes treat a no-op. Idempotent by design.
    const targets = hooks.filter(
      (h) => Boolean(h['payment_tool_status']) !== value,
    );
    if (targets.length === 0) {
      return {
        success: true,
        matched: hooks.length,
        modified: 0,
        aliases: hooks.map((h) => (h['alias'] as string) || String(h['_id'])),
      };
    }

    const result = await this.hookModel
      .updateMany(
        { _id: { $in: targets.map((h) => h['_id']) } },
        { $set: { payment_tool_status: value } },
      )
      .exec();

    /**
     * ── CACHE EVICTION — MANDATORY, mirrors CACHE TRIGGER 3/5 and 4/5 ──────
     * Not optional and not an optimisation. The webhook path resolves a hook
     * from the L1/L2 cache, so a request already in flight would keep reading
     * the OLD `payment_tool_status` until the TTL expired — i.e. the kill
     * switch appears to work while payment keeps running on a money path.
     * `previousAlias` evicts the key the row is actually filed under.
     */
    for (const hook of targets) {
      await this.hookCache.cacheHook(
        { ...hook, payment_tool_status: value },
        { previousAlias: hook['alias'] as string | undefined },
      );
    }

    /**
     * Audited per hook that actually MOVED, not per hook named — the precedent
     * `bulkUpdateHookHandoff` sets deliberately. Recording `from: !value`
     * against an OA that was already at the requested value is a false entry in
     * the trail an operator later uses to reconstruct who switched payment on
     * for which shop and when. A repeated call therefore leaves no rows.
     */
    this.auditBulk(
      targets,
      (hook) => ({
        field: 'payment_tool_status',
        from: hook['payment_tool_status'],
        to: value,
      }),
      (body['audit_note'] as string | undefined) || 'bulk payment update',
      ctx,
      '[BULKPAYMENT] audit log failed',
    );

    return {
      success: true,
      matched: hooks.length,
      modified: result.modifiedCount ?? targets.length,
      aliases: targets.map((h) => (h['alias'] as string) || String(h['_id'])),
    };
  }

  /**
   * [FEAT-20260821-IGNOREABANDON] The per-OA "leave them alone" bulk switch.
   *
   * WHY A DEDICATED ROUTE instead of adding 'ignore_abandon_assist' to
   * `BULK_SETTING_FIELDS` — the one-line alternative:
   * that whitelist is echoed back to the operator inside a rejection message
   * (`'field must be one of: ' + BULK_SETTING_FIELDS.join(', ')`, ~:2514), and
   * `z-test/golden/hook-write.golden-spec.ts` compares that message with
   * legacy's BYTE FOR BYTE ("rejects a field outside the whitelist
   * identically"). Legacy's list has the same three entries and cannot grow,
   * so a fourth name here would put every hook-write golden case into
   * permanent disagreement — for a field legacy has never heard of.
   * เติมชื่อในลิสต์ = ข้อความ error เปลี่ยน = golden ต่างจาก legacy ตลอดกาล.
   *
   * A dedicated route is the house precedent for exactly this, not an
   * invention: `bulkUpdateHookHandoff` and `bulkUpdateHookPayment` above were
   * both written this way, and both say so in their own headers.
   *
   * ⚠️ NO READINESS CHECK, unlike payment's — and that is correct. Payment
   * refuses to switch ON unless every OA can actually take money. Nothing can
   * go wrong by not chasing a customer, in either direction, so a gate here
   * would be ceremony. ไม่ต้องมีด่านตรวจ เพราะปิดการตามไม่ทำให้อะไรพัง.
   *
   * HOW TO CHANGE LATER: to fold this into the generic route, delete this
   * method plus its controller entry and add 'ignore_abandon_assist' to
   * `BULK_SETTING_FIELDS` — accepting the golden divergence described above.
   * revert: delete this method and its route.
   */
  async bulkUpdateHookAbandon(
    body: W.FieldBag,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    // Same order of checks as every sibling bulk endpoint: ids, then value,
    // then id validity — a body wrong in two ways fails on the same one here.
    const ids = Array.isArray(body['ids']) ? body['ids'].filter(Boolean) : [];
    if (ids.length === 0) throw new BadRequestException('ids is required');

    /* A real boolean only — copied verbatim from the two siblings. `"false"`
       is a truthy STRING; coercing it would switch the chase OFF for OAs the
       operator was trying to switch it back ON for. ห้ามเดา — ต้องเป็น boolean แท้. */
    if (typeof body['value'] !== 'boolean') {
      throw new BadRequestException('value must be a boolean');
    }
    const value = body['value'];

    // Throws BlockedHooksException naming the aliases if the caller lacks
    // access to ANY id, before a single write — all-or-nothing.
    const hooks = await this.loadBulkTargets(body['ids'], ctx);

    /* Only the ones that actually move. `=== true` on both sides so a row that
       predates the column (reads `undefined`) counts as OFF and is written when
       switching ON — the same lean-read rule the gate follows. */
    const targets = hooks.filter(
      (h) => (h['ignore_abandon_assist'] === true) !== value,
    );
    if (targets.length === 0) {
      return {
        success: true,
        matched: hooks.length,
        modified: 0,
        aliases: hooks.map((h) => (h['alias'] as string) || String(h['_id'])),
      };
    }

    const result = await this.hookModel
      .updateMany(
        { _id: { $in: targets.map((h) => h['_id']) } },
        { $set: { ignore_abandon_assist: value } },
      )
      .exec();

    /**
     * ── CACHE EVICTION — MANDATORY, same reason as the payment switch above ─
     * The webhook resolves a hook from the L1/L2 cache before it consults the
     * follow-up gate, so without this a request already in flight keeps
     * reading the OLD value until the TTL expires — the switch would look like
     * it worked while customers kept being chased. `previousAlias` evicts the
     * key the row is actually filed under.
     */
    for (const hook of targets) {
      await this.hookCache.cacheHook(
        { ...hook, ignore_abandon_assist: value },
        { previousAlias: hook['alias'] as string | undefined },
      );
    }

    /* Audited per hook that actually MOVED, not per hook named — the precedent
       both siblings set. A repeated call leaves no rows at all. */
    this.auditBulk(
      targets,
      (hook) => ({
        field: 'ignore_abandon_assist',
        from: hook['ignore_abandon_assist'] === true,
        to: value,
      }),
      (body['audit_note'] as string | undefined) || 'bulk abandon-chase update',
      ctx,
      '[BULKABANDON] audit log failed',
    );

    return {
      success: true,
      matched: hooks.length,
      modified: result.modifiedCount ?? targets.length,
      aliases: targets.map((h) => (h['alias'] as string) || String(h['_id'])),
    };
  }

  /**
   * [FEAT-20260828-BULKAI] Bulk-set the AI vendor and/or model across many OAs.
   *
   * เจ้าของ 28/08: *"หัวข้อ ai แยกเลย / กำหนด ai model / vendor ได้ ติ๊กแยกสอง
   * อย่างนี้ได้ ไว้ให้ bulk ตัวไหน ไม่ต้องพ่วงกัน"*
   *
   * 🔴 A ROUTE OF ITS OWN, NOT AN ENTRY IN `settings/bulk`. That endpoint
   *    refuses anything but a real boolean (`bulkUpdateHookSetting`, the
   *    `typeof body['value'] !== 'boolean'` guard) because every method behind
   *    it is an on/off flag. These two fields are STRINGS with different
   *    validation each. Widening that guard to let a string through would
   *    loosen the check for all six existing methods at once — the one thing
   *    that must not happen. เส้นใหม่ ไม่แตะเส้นเดิม.
   *
   * 🔴 THE TWO FIELDS ARE INDEPENDENT, WHICH IS WHAT WAS ASKED. Absent means
   *    "leave this one alone"; present means "write it". So an operator can set
   *    the vendor for 20 OAs without touching the models they already have, or
   *    vice versa. `parseAiVendor` / `parseAiModel` already answer `undefined`
   *    for absent, which is exactly this distinction — reused, not re-written.
   *    ⚠️ `hook.schema.ts:225` records that a model is only meaningful together
   *       with its vendor (the family default depends on it). Writing a model
   *       alone is therefore ALLOWED but can name a model the OA's existing
   *       vendor does not have — that fails at the vendor, not here. The
   *       dashboard warns; this layer does not refuse, because refusing would
   *       block the legitimate "fix the model on OAs I know are all Gemini".
   *
   * 🔴 NOTHING PROVIDED IS A 400, NOT A NO-OP. A body with neither field is a
   *    caller bug (a screen that forgot to tick anything). Answering "success,
   *    modified 0" would let that ship unnoticed.
   *
   * ⚠️ Only rows that actually MOVE are written and audited — the rule every
   *    sibling bulk method follows. A repeated call leaves no audit rows.
   * ⚠️ Cache eviction is MANDATORY for the same reason as the abandon switch:
   *    the webhook resolves a hook from L1/L2 before it asks which vendor to
   *    call, so a stale entry keeps answering with the OLD model while the
   *    dashboard shows the new one.
   *
   * revert: delete this method, its controller route and the FE method entry —
   *   no schema changes to undo, both fields already existed.
   */
  async bulkUpdateHookAi(
    body: W.FieldBag,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    // Same order of checks as every sibling: ids, then values, then access.
    const ids = Array.isArray(body['ids']) ? body['ids'].filter(Boolean) : [];
    if (ids.length === 0) throw new BadRequestException('ids is required');

    /* Reuses the SAME parsers the per-hook write uses — one answer to "is this
       a valid vendor", so the bulk path can never accept what the single path
       rejects. `undefined` = the caller did not tick this field. */
    const vendor = parseAiVendor(body['ai_vendor']);
    const model = parseAiModel(body['ai_model']);
    if (vendor === undefined && model === undefined) {
      throw new BadRequestException(
        'at least one of ai_vendor or ai_model is required',
      );
    }
    /* [FEAT-20260904-VENDORSECCOL] The COLUMN is chosen from the vendor, so a
       caller naming it directly believes something untrue about this endpoint.
       Answering 200 and ignoring the field is the silent-drop class this whole
       task exists to close, so it is refused with the field that does work.
       บอกชื่อคอลัมน์มาเอง = เข้าใจผิด ต้องบอกกลับ ไม่ใช่รับแล้วทิ้ง */
    if (body['ai_model_sec'] !== undefined) {
      throw new BadRequestException(
        'ai_model_sec is not accepted here — send ai_model; the column is ' +
          'chosen from the vendor each hook ends up on',
      );
    }

    /* Throws BlockedHooksException naming the aliases if the caller lacks
       access to ANY id, before a single write — all-or-nothing. */
    const hooks = await this.loadBulkTargets(body['ids'], ctx);

    /* ⭐ [FEAT-20260904-VENDORSECCOL] THE MODEL GOES IN THE COLUMN OF THE VENDOR
     * THE ROW ENDS UP ON. Owner, 04/09: *"ถ้า bulk deepseek ก็ต้องได้ deepseek /
     * gemini ก็ gemini ต้องไม่โกหก"*.
     *
     * This used to be one shared patch with `ai_model` hard-coded. After the
     * column split that wrote a DeepSeek model into GEMINI's column: the save
     * succeeded, the audit row said the model changed, and DeepSeek went on
     * answering with its family default. Nothing anywhere reported that the
     * value had no effect. เซฟผ่าน ไม่มีผล ไม่มีอะไรฟ้อง
     *
     * ⚠️ "MODEL ONLY" IS WHY THIS CANNOT BE ONE `$set`. With no vendor in the
     * request each target keeps its own, and the targets may be on different
     * vendors — so there is no single column that is right for all of them.
     * The patch is therefore built PER ROW and the rows are grouped by the
     * patch they need; today that is at most two writes.
     *
     * revert: rebuild one `patch` with `ai_model` and a single updateMany —
     *         and accept that a bulk switch to DeepSeek silently does nothing. */
    const patchFor = (
      hook: Record<string, unknown>,
    ): Record<string, unknown> => {
      const p: Record<string, unknown> = {};
      if (vendor !== undefined) p['ai_vendor'] = vendor;
      if (model !== undefined) {
        // the vendor this row ENDS UP on: the one being written, else its own
        const endsUpOn =
          vendor !== undefined
            ? vendor
            : (hook['ai_vendor'] as string | null | undefined);
        p[resolveVendorColumns(endsUpOn).modelField] = model;
      }
      return p;
    };

    /* `?? null` on both sides: a row written before these columns existed reads
       `undefined`, and `undefined !== null` would mark every such row as
       "moved" and rewrite it with the value it already means. */
    const moves = (hook: Record<string, unknown>): boolean =>
      Object.entries(patchFor(hook)).some(
        ([field, next]) => (hook[field] ?? null) !== next,
      );

    const targets = hooks.filter(moves);
    if (targets.length === 0) {
      return {
        success: true,
        matched: hooks.length,
        modified: 0,
        aliases: hooks.map((h) => (h['alias'] as string) || String(h['_id'])),
      };
    }

    /* Group by the patch itself, so rows needing the same write share one
       statement and rows needing a different column get their own. */
    const groups = new Map<
      string,
      { patch: Record<string, unknown>; hooks: Record<string, unknown>[] }
    >();
    for (const hook of targets) {
      const patch = patchFor(hook);
      const key = JSON.stringify(patch);
      const g = groups.get(key) ?? { patch, hooks: [] };
      g.hooks.push(hook);
      groups.set(key, g);
    }

    let modifiedTotal = 0;
    for (const { patch, hooks: rows } of groups.values()) {
      const result = await this.hookModel
        .updateMany(
          { _id: { $in: rows.map((h) => h['_id']) } },
          { $set: patch },
        )
        .exec();
      modifiedTotal +=
        (result as { modifiedCount?: number }).modifiedCount ?? 0;

      for (const hook of rows) {
        await this.hookCache.cacheHook(
          { ...hook, ...patch },
          { previousAlias: hook['alias'] as string | undefined },
        );
      }

      /* One audit row per hook per FIELD that moved — an operator reading the
         log has to be able to tell "vendor changed" from "model changed", and a
         single row naming both would hide which one the OA actually needed.
         ⚠️ The field named here is the column ACTUALLY written: a row saying
         `ai_model` while `ai_model_sec` moved is the same lie in another place. */
      for (const [field, next] of Object.entries(patch)) {
        const movedForField = rows.filter((h) => (h[field] ?? null) !== next);
        if (movedForField.length === 0) continue;
        this.auditBulk(
          movedForField,
          (hook) => ({ field, from: hook[field] ?? null, to: next }),
          (body['audit_note'] as string | undefined) ||
            'bulk AI vendor/model update',
          ctx,
          '[BULKAI] audit log failed',
        );
      }
    }

    return {
      success: true,
      matched: hooks.length,
      // summed across the groups; falls back to the row count the same way the
      // sibling bulk methods do when the driver reports nothing.
      modified: modifiedTotal || targets.length,
      aliases: targets.map((h) => (h['alias'] as string) || String(h['_id'])),
    };
  }

  /**
   * [FEAT-20260822-NOTICEMODE] Per-OA write for the notice settings mode.
   *
   * A DEDICATED route (`PUT /hook/notice/:id`), not seven entries in
   * `ALLOWED_UPDATES` — that list's rejection text is golden-pinned against
   * legacy, and the owner's rule for this mode is "แยก path ใหม่ ห้ามกระทบ
   * ของเดิม". Field semantics (typeof guards, scope enum, the D6 card gate,
   * behavioural diff) all live in `notice-settings/` — this method is only the
   * plumbing every sibling write has: load → access check → validate → write →
   * cache evict → audit → masked response.
   *
   * D6 (owner): a notice toggle cannot be ON without its flex card — judged on
   * the EFFECTIVE state after the write, so "turn it on" on a card-less OA and
   * "remove the card" while it is on are both refused with a 400.
   *
   * revert: delete this method, `bulkUpdateHookNotice` below, their two routes
   * and the notice-settings/ folder.
   */
  async updateHookNotice(
    id: string,
    body: W.FieldBag,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    if (!id || !isValidObjectId(id)) {
      throw new BadRequestException('id is required');
    }
    // Shape first, row second — a body wrong in two ways fails the same way
    // whether or not the id exists, matching the sibling ordering rule.
    const candidates = N.parseNoticeFields(body);

    const existing = await this.hookModel.findById(id).lean<LeanHook>().exec();
    if (!existing) throw new HookNotFoundException();

    // Same two-tier guard as updateHookStatus — without it any authenticated
    // caller could reconfigure another group's OA with nothing but its id.
    this.ensureGroupAccess(ctx.user, existing['group']);
    await assertHookInScope(ctx.user, this.hookModel, existing['_id']);

    const violation = N.noticeCardViolation(candidates, existing);
    if (violation) throw new BadRequestException(violation);

    const changes = N.diffNoticeChanges(candidates, existing);
    if (changes.length === 0) {
      // Nothing moves — no write, no audit row, same masked answer.
      return this.maskSecretsForDetail(this.mapBangkokTime(existing)) ?? {};
    }

    const hook = await this.hookModel
      .findByIdAndUpdate(
        id,
        { $set: candidates },
        { new: true, runValidators: true },
      )
      .lean<LeanHook>()
      .exec();
    if (!hook) throw new HookNotFoundException();

    // ── CACHE EVICTION — same reason as every sibling: the webhook path
    // resolves hooks from L1/L2, and the runtime phase will read these fields
    // there. Wired now so that phase never meets a stale row.
    await this.hookCache.cacheHook(hook, {
      previousAlias: existing['alias'] as string | undefined,
    });

    this.auditLog.writeInBackground(
      {
        ref_id: hook['_id'],
        hook_id: hook['_id'],
        group_id: hook['group'] ?? null,
        parent: 'hook',
        action: 'update',
        changed_fields: changes,
        actor: this.buildActor(ctx),
        request_meta: this.buildRequestMeta(ctx),
        note: body['audit_note'] as string | undefined,
      },
      '[NOTICEMODE] audit log failed',
    );

    return this.maskSecretsForDetail(this.mapBangkokTime(hook)) ?? {};
  }

  /**
   * [FEAT-20260822-NOTICEMODE] Bulk write for the notice settings mode —
   * `PATCH /hook/notice/bulk`, placed beside `abandon/bulk` because it copies
   * that contract: all-or-nothing group access, audit per hook that MOVED,
   * cache eviction, and a dedicated route for the golden-whitelist reason the
   * abandon header spells out.
   *
   * Body: `{ ids: [...], fields: { <any notice fields> }, audit_note? }`.
   * Flex ids ARE accepted here — cards are global documents (clone already
   * fans one card onto many OAs), so bulk shares the exact same gate as the
   * per-hook route. Owner, 22/08 round 5: "เอาดีที่สุด ห้ามเป็นหนี้" — one
   * rule everywhere, no bulk special case.
   *
   * D6 in bulk follows `assertPaymentTargetsReady`'s stance: switching a
   * notice ON refuses the WHOLE batch if any target lacks its card, naming the
   * offending aliases via the existing `blocked` 403 contract.
   * revert: delete this method, its route, and the notice-settings/ folder.
   */
  async bulkUpdateHookNotice(
    body: W.FieldBag,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    // Same order of checks as every sibling bulk endpoint: ids first.
    const ids = Array.isArray(body['ids']) ? body['ids'].filter(Boolean) : [];
    if (ids.length === 0) throw new BadRequestException('ids is required');

    const rawFields = body['fields'];
    if (
      rawFields === null ||
      typeof rawFields !== 'object' ||
      Array.isArray(rawFields)
    ) {
      throw new BadRequestException('fields is required');
    }
    // Shape does not depend on any row — validated ONCE for the whole batch.
    const candidates = N.parseNoticeFields(
      rawFields as Record<string, unknown>,
    );

    // Throws BlockedHooksException naming the aliases if the caller lacks
    // access to ANY id, before a single write — all-or-nothing.
    const hooks = await this.loadBulkTargets(body['ids'], ctx);

    // D6 across the batch — refused whole, aliases named, nothing written.
    const blocked: BlockedHook[] = [];
    for (const hook of hooks) {
      const violation = N.noticeCardViolation(candidates, hook);
      if (violation) {
        blocked.push({
          alias: (hook['alias'] as string) || String(hook['_id']),
          reason: violation,
        });
      }
    }
    if (blocked.length > 0) throw new BlockedHooksException(blocked);

    // Only the hooks that actually MOVE — `=== true` behavioural reads inside
    // diffNoticeChanges, so a row that predates the columns counts as OFF and
    // becomes a target when switching ON. Idempotent by design.
    const perHook = hooks.map((hook) => ({
      hook,
      changes: N.diffNoticeChanges(candidates, hook),
    }));
    const targets = perHook.filter((p) => p.changes.length > 0);
    if (targets.length === 0) {
      return {
        success: true,
        matched: hooks.length,
        modified: 0,
        aliases: hooks.map((h) => (h['alias'] as string) || String(h['_id'])),
      };
    }

    const result = await this.hookModel
      .updateMany(
        { _id: { $in: targets.map((p) => p.hook['_id']) } },
        { $set: candidates },
      )
      .exec();

    // ── CACHE EVICTION — MANDATORY, same reason as the siblings above ─────
    for (const { hook } of targets) {
      await this.hookCache.cacheHook(
        { ...hook, ...candidates },
        { previousAlias: hook['alias'] as string | undefined },
      );
    }

    /* Audited per hook that actually MOVED, with ITS OWN field diff — not
     * `auditBulk`, which records one identical change per hook; here two rows
     * of the same batch can move different subsets. A repeated call leaves no
     * rows at all, the precedent every sibling sets. */
    for (const { hook, changes } of targets) {
      this.auditLog.writeInBackground(
        {
          ref_id: String(hook['_id']),
          hook_id: hook['_id'],
          group_id: hook['group'] ?? null,
          parent: 'hook',
          action: 'update',
          changed_fields: changes,
          actor: this.buildActor(ctx),
          request_meta: this.buildRequestMeta(ctx),
          note:
            (body['audit_note'] as string | undefined) || 'bulk notice update',
        },
        '[BULKNOTICE] audit log failed',
      );
    }

    return {
      success: true,
      matched: hooks.length,
      modified: result.modifiedCount ?? targets.length,
      aliases: targets.map(
        (p) => (p.hook['alias'] as string) || String(p.hook['_id']),
      ),
    };
  }

  /**
   * [FEAT-20260808-PAYTOOL-P4] Refuses the whole batch unless EVERY target is
   * actually ready to take payment. Runs on the ON path only.
   *
   * ══════════════════════════════════════════════════════════════════════
   * WHAT THIS PREVENTS — read this before deleting it
   * ══════════════════════════════════════════════════════════════════════
   * Without this check an operator can switch payment ON for an OA whose
   * `payment_tool_id` is null, or points at a tool that was deleted, disabled,
   * or is not a payment tool at all. Nothing complains. The dashboard toggle
   * goes green and stays green.
   *
   * Then at runtime `payment-runner.service.ts` (`resolvePaymentTool`) hits its
   * gate — `payment_tool_status !== true || !payment_tool_id`, and then the
   * tool's own status/category test — and returns null. A null resolve is a
   * SILENT no-op: the customer sends a slip, nothing happens, no error is
   * raised, nothing is written to any log. สวิตช์ขึ้นเขียวแต่ระบบไม่ทำงาน —
   * แอดมินไม่รู้ตัวจนลูกค้าโวย. On 50 shops switched in one action, the first
   * signal is a customer complaint, and the operator's own screen contradicts it.
   *
   * ⚠️ SEVERITY, STATED PLAINLY SO IT IS NOT OVERSTATED LATER: this is
   * FAIL-CLOSED, not fail-dangerous. The unready state makes payment do
   * NOTHING; it never moves money to the wrong place, never double-charges,
   * never pays out incorrectly. This is a MISLEADING-STATE bug, not a
   * money-loss bug. It is worth a hard stop because the state is invisible and
   * bulk multiplies it — not because funds are at risk.
   *
   * TRADE-OFF: strict costs the operator one extra step — bind the tool first,
   * then enable — and a batch of 50 fails if one shop is unbound. In exchange,
   * "switch is ON" and "payment actually works" can never disagree.
   *
   * ⚠️ THIS EXCEEDS THE PRECEDENT ON PURPOSE. `bulkUpdateHookHandoff` does NOT
   * pre-validate its targets. That difference is deliberate and owner-approved,
   * NOT an inconsistency to be tidied up: handoff failing to dispatch surfaces
   * elsewhere, whereas an unready payment tool is completely silent. Do not
   * "fix" this back to match the sibling.
   *
   * HOW TO CHANGE LATER — to fall back to the permissive precedent, delete the
   * single `if (value === true) await this.assertPaymentTargetsReady(hooks)`
   * call in `bulkUpdateHookPayment` (this method can then go too). The operator
   * would then experience: the bulk call always succeeds, toggles read ON for
   * every OA, and any unready shop silently accepts no payments until someone
   * notices by hand. To soften instead of removing — e.g. skip unready OAs and
   * report them rather than refusing the batch — replace the throw below with a
   * filter on `hooks` and add the skipped aliases to the response; that breaks
   * the all-or-nothing contract the sibling bulk routes share, so it is a
   * contract change, not a tweak.
   */
  private async assertPaymentTargetsReady(hooks: LeanHook[]): Promise<void> {
    const blocked: BlockedHook[] = [];

    for (const hook of hooks) {
      const alias = (hook['alias'] as string) || String(hook['_id']);

      // ── 1. bound at all? ──────────────────────────────────────────────
      // The runner's own first gate. A null id is the common case: the OA was
      // never wired to a tool.
      const rawId = hook['payment_tool_id'];
      if (!rawId) {
        blocked.push({
          alias,
          reason: 'ยังไม่ได้ผูก payment tool (payment_tool_id ว่าง)',
        });
        continue;
      }

      /**
       * A stored id is an ObjectId; anything else on the document is corrupt
       * and is treated as "not bound" rather than stringified blindly — the
       * same rule `getToolForHook` applies to `custom_tool_id`.
       */
      const toolId =
        rawId instanceof Types.ObjectId
          ? rawId.toHexString()
          : typeof rawId === 'string'
            ? rawId
            : null;
      if (!toolId || !isValidObjectId(toolId)) {
        blocked.push({
          alias,
          reason: 'payment_tool_id เสียหาย (ไม่ใช่ ObjectId)',
        });
        continue;
      }

      // ── 2. does that id resolve to a LIVE PAYMENT tool? ───────────────
      /**
       * Read uncached and un-populated on purpose. `getToolForHook` is keyed to
       * `custom_tool_*` and caches for 60s; a money switch must not be decided
       * from a stale entry, and this path runs once per bulk request rather
       * than on the hot path, so the extra query is affordable.
       * `deleted_at: null` matches how every other tool query filters.
       */
      const tool = await this.customTools.findPaymentToolForBinding(toolId);
      if (!tool) {
        blocked.push({
          alias,
          reason: 'payment tool ที่ผูกไว้หาไม่เจอ (ถูกลบหรือปิดอยู่)',
        });
        continue;
      }
      if (tool['category'] !== 'payment') {
        // A generic tool bound here resolves to null in the runner exactly like
        // a missing one, so it is refused for the same reason.
        blocked.push({
          alias,
          reason: 'tool ที่ผูกไว้ไม่ใช่ category "payment"',
        });
      }
    }

    /**
     * A NEW USE of the EXISTING contract, not a new pattern: the same
     * `BlockedHooksException` → `BlockedHooksFilter` pair that `loadBulkTargets`
     * throws for a group-access failure, so the dashboard's existing 403
     * handler renders `{ error, blocked: [{ alias, reason }] }` unchanged and
     * the operator sees exactly WHICH OAs to fix — the whole point of the
     * `blocked` key. All-or-nothing: nothing has been written at this point.
     *
     * ⚠️ The exception's `error` string is fixed at "some OA are outside your
     * group access", which is inaccurate for a readiness failure. It is left
     * alone deliberately — the message is part of the ported legacy contract
     * and `diffContractValues` compares it by value, so changing it would break
     * parity for the group-access case that shares the class. The per-OA
     * `reason` carries the real cause, which is what the operator reads.
     */
    if (blocked.length > 0) throw new BlockedHooksException(blocked);
  }

  // ─────────────────────────────────────────────────────────────────────
  // DELETE /hook/:id
  // ─────────────────────────────────────────────────────────────────────

  /**
   * ⚠️ No group check, matching legacy exactly (hookController.js:2196-2234):
   * the handler validates the id, deletes, and answers. That is a real gap —
   * any authenticated caller can delete any OA by id — but closing it here
   * would be a behaviour change this port is not allowed to make silently, and
   * it must land together with the frontend and a migration of whoever relies
   * on it. Recorded in the report as a finding, not fixed in passing.
   */
  async deleteHook(
    id: string,
    body: W.FieldBag,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('invalid hook id');
    }

    // [FIX-20260808-HOOKDELSCOPE] Enforce the SAME group scope every other hook
    // write applies (H-S6). deleteHook went straight to findByIdAndDelete, so any
    // authenticated user could hard-delete another tenant's OA by id and evict its
    // cache. Legacy hookController.js:2196 was also unscoped; closed here
    // in-service, consistent with this controller's design (hook routes carry no
    // route-level permission and scope by group membership in the service).
    const actorUser = ctx.user;
    if (!this.isSuperUser(actorUser)) {
      const existing = await this.hookModel
        .findById(id)
        .select('group')
        .lean<{ group?: unknown }>()
        .exec();
      if (!existing) throw new HookNotFoundException();
      const existingGroup = existing.group;
      if (!existingGroup) {
        throw new ForbiddenException('group access is required');
      }
      if (
        typeof existingGroup === 'object' &&
        existingGroup !== null &&
        '_id' in existingGroup
      ) {
        this.ensureGroupAccess(actorUser, existingGroup._id);
      } else {
        this.ensureGroupAccess(actorUser, existingGroup);
      }
      // [FIX-20260818-HOOKWRITESCOPE] tier 2. Without it the three accounts
      // holding a whitelist could hard-delete the OAs they were provisioned
      // away from — the worst of the six write paths.
      await assertHookInScope(actorUser, this.hookModel, id);
    }

    const deleted = await this.hookModel
      .findByIdAndDelete(id)
      .lean<LeanHook>()
      .exec();
    if (!deleted) throw new HookNotFoundException();

    // ── CACHE TRIGGER 5/5 (hookController.js:2208) ──────────────────────
    // Without this the alias keeps resolving from L1/L2 to a hook that no
    // longer exists — and the webhook reads line_secret from that entry, so a
    // deleted OA would carry on verifying signatures until the TTL expired.
    await this.hookCache.invalidateHookCache(
      deleted['alias'] as string | undefined,
    );

    this.auditLog.writeInBackground(
      {
        ref_id: deleted['_id'],
        hook_id: deleted['_id'],
        group_id: deleted['group'] ?? null,
        parent: 'hook',
        action: 'delete',
        actor: this.buildActor(ctx),
        request_meta: this.buildRequestMeta(ctx),
        note: body?.['audit_note'] as string | undefined,
      },
      'audit log delete failed',
    );

    return { message: 'Hook deleted successfully', id: deleted['_id'] };
  }

  // ─────────────────────────────────────────────────────────────────────
  // POST /hook/:id/clone
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Copies selected tabs of one hook onto others.
   *
   * ⚠️ Values are copied EXACTLY as stored — never decrypt-then-re-encrypt. The
   * ciphertext is already keyed for this deployment, so copying it verbatim
   * works and the plaintext never enters memory. Re-encrypting would also break
   * the moment the key rotates.
   *
   * Not ported: `provision_handoff`, which shares the source's handoff chain
   * bindings onto each target. It lives in the handoff module, which this step
   * does not touch. Omitting the flag — what every request in use does — is
   * byte-identical to legacy; sending it is a known divergence.
   */
  async cloneHookSettings(
    sourceId: string,
    body: W.FieldBag,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(sourceId)) {
      throw new BadRequestException('invalid hook id');
    }

    const targetIds = body['target_ids'];
    const tabs = body['tabs'];
    const includeSecrets = body['include_secrets'];
    const allowCrossGroup = body['allow_cross_group'] === true;
    const forceGrant = W.isTrueFlag(body['force_grant']);
    /* [P2-20260813] Vendor-only clone. Default (false) copies the vendor WITH
       its key, because a vendor without its key is an OA that answers nothing.
       When true the operator has said "just the vendor" — see the fields block
       below, where the key is set to null rather than left alone. */
    const aiVendorWithoutKey = W.isTrueFlag(body['ai_vendor_without_key']);

    // Two-step confirmation is part of the contract — this endpoint overwrites
    // settings on many OAs at once and is reachable without the modal.
    if (body['confirm'] !== true) {
      throw new BadRequestException('confirm is required');
    }
    if (!Array.isArray(tabs) || tabs.length === 0) {
      throw new BadRequestException('tabs is required');
    }
    const validTabKeys = new Set(CLONEABLE_TABS.map((t) => t.key));
    const badTab = (tabs as unknown[]).find(
      (t) => !validTabKeys.has(t as string),
    );
    if (badTab !== undefined) {
      throw new BadRequestException(`unknown tab: ${W.legacyString(badTab)}`);
    }
    if (!Array.isArray(targetIds) || targetIds.length === 0) {
      throw new BadRequestException('target_ids is required');
    }
    const badId = (targetIds as unknown[]).find(
      (id) => !isValidObjectId(id as string),
    );
    if (badId !== undefined) {
      throw new BadRequestException('invalid target hook id');
    }
    if (
      (targetIds as unknown[]).some((id) => String(id) === String(sourceId))
    ) {
      throw new BadRequestException('cannot clone a hook onto itself');
    }

    /**
     * A secret is copied only when the operator ticked it AND its tab is
     * selected. ติ๊ก custom_ai_key แต่ไม่ได้เลือกแท็บ AI = ไม่คัดลอก —
     * guards against a tick left over from the previous run.
     */
    const tabList = tabs as string[];
    const wantedSecrets = new Set(
      (Array.isArray(includeSecrets)
        ? (includeSecrets as string[])
        : []
      ).filter(
        (f) => SENSITIVE_FIELD[f] && tabList.includes(SENSITIVE_FIELD[f]),
      ),
    );

    const source = await this.hookModel
      .findById(sourceId)
      .lean<LeanHook>()
      .exec();
    if (!source) throw new HookNotFoundException('Source hook not found');
    this.ensureGroupAccess(ctx.user, source['group']);
    // [FIX-20260818-HOOKWRITESCOPE] tier 2 — reading another OA's settings to
    // copy them is the same disclosure as reading them directly.
    await assertHookInScope(ctx.user, this.hookModel, source['_id']);

    const fields = [...fieldsForTabs(tabList, false), ...wantedSecrets];

    /* [FEAT-20260822-CLONEFIELDS] Tick SOME fields of a tab, not the whole tab.
     * Owner, 22/08: "ติ๊กเฉพาะบางรายการได้ เช่นเอาแค่ doc ก็ได้ · ติ๊กอะไรไปแค่นั้น".
     *
     * `fields` is OPTIONAL. Absent → `fields` above is untouched and the clone
     * is byte-identical to before. Present → it must be a non-empty list where
     * every entry is already in `fields` — i.e. registered to a ticked tab and
     * not NEVER_CLONE, and a secret only if the operator also ticked it in
     * `include_secrets` (a secret named here alone is a 400, never a bypass).
     * The check runs BEFORE any target is read or written, so a bad request
     * touches nothing. Order is kept from the registry, not from the request,
     * so `updates`/audit rows stay in the same order as a whole-tab clone.
     *
     * ⚠️ [FEAT-20260904-VENDORSECCOL] This used to say that ticking `ai_vendor`
     * alone still dragged its key. It does NOT any more: a key is written only
     * when its own column is ticked, and a vendor arriving without one is
     * reported (`ai_key_missing_for_vendor`) rather than silently completed.
     * ติ๊กแค่ vendor = ได้แค่ vendor · คีย์ต้องติ๊กเอง
     * revert: delete this block; `fields` stays the whole-tab list. */
    const fieldPick = body['fields'];
    if (fieldPick !== undefined) {
      if (!Array.isArray(fieldPick) || fieldPick.length === 0) {
        throw new BadRequestException('fields must be a non-empty list');
      }
      const allowed = new Set(fields);
      const bad = (fieldPick as unknown[]).find(
        (f) => typeof f !== 'string' || !allowed.has(f),
      );
      if (bad !== undefined) {
        throw new BadRequestException(
          `field not cloneable with the ticked tabs: ${W.legacyString(bad)}`,
        );
      }
      const picked = new Set(fieldPick as string[]);
      fields.splice(
        0,
        fields.length,
        ...fields.filter((f) => picked.has(f) || wantedSecrets.has(f)),
      );
    }
    /* [P2-20260813 · rewritten FEAT-20260904-VENDORSECCOL] ai_vendor and the
     * vendor's key are RELATED, but they are no longer a bound pair the code
     * completes on the operator's behalf.
     *
     * They sit in different maps by design — the vendor is a name (copied with
     * its tab) and the key is a credential (opt-in per tick). That used to mean
     * a tab clone could hand the target a vendor with no key, so the code either
     * dragged the key along or cleared the target's — "never a half state".
     *
     * 🔴 Both of those WRITE a credential nobody ticked, which the owner's rule
     * of 04/09 forbids outright. And the hazard that justified them (the OTHER
     * vendor's key being fired at this one) cannot happen now that each vendor
     * reads its own column. So the half state is allowed to exist and is SAID
     * OUT LOUD instead — see the per-target block below.
     * ห้ามทับคีย์เพราะไม่ได้ติ๊ก · สถานะที่ยังไม่ครบ ให้บอก ไม่ใช่ไปเติมให้เอง
     *
     * Scope: ONLY the AI pair. Every other tab and secret is untouched.
     * revert: delete this block and the flag above. */
    const clonesVendor = fields.includes('ai_vendor');
    /* ⚠️ Clone deliberately does NOT re-run `parseAiVendor` on the copied value.
     * Considered and rejected: clone is a row-to-row copy, and every write path
     * that can put `ai_vendor` into a row already rejects an unrecognised name,
     * so a value that fails the parser cannot exist in a source row to be
     * copied. Validating here would be a branch no input can reach, and it
     * would make clone fail on rows written before the column existed. If a
     * corrupt value ever did appear, the transport registry falls back to the
     * default vendor rather than breaking the reply. คัดลอกค่าที่ผ่านด่านมาแล้ว. */
    /* ⚠️ The pair rule only fires when the vendor actually MOVES, and that is a
     * per-target question — the same source can leave one OA's vendor unchanged
     * while switching another's. Deciding it once here (as this block first did)
     * dragged the key on every target, so cloning knob settings between two OAs
     * that were both already on the same vendor overwrote the target's own
     * working key with the source's, with no secret ticked and nothing in the
     * result to say so. Found by probing same-vendor→same-vendor.
     * The decision therefore lives in the per-target loop below, next to mode
     * B's, which was already gated this way. ค่ายไม่ได้ย้าย = ไม่มีอะไรต้องผูก. */
    /* ⚠️ Contradictory input, found by probing the two flags together: an
     * operator can tick include_secrets['custom_ai_key'] AND ask for
     * vendor-only. The end state was already right (the clear below wins), but
     * the key was copied first and then nulled, so the audit trail carried TWO
     * custom_ai_key rows — one saying "copied", one saying "cleared" — and a
     * reader cannot tell what happened. Vendor-only wins outright: drop the
     * field from the copy list so exactly one row is written.
     * ติ๊กขัดกันเอง → เอาอันที่ชัดกว่า และเขียน audit แถวเดียว. */
    if (clonesVendor && aiVendorWithoutKey) {
      /* [FEAT-20260904-VENDORSECCOL] This flag now does exactly ONE thing, and it
         is the only thing left for it to do: drop both key ticks. It is a brake
         ("even though I ticked a key, do not carry it"), never an eraser — it
         wrote `null` over the target's key until 04/09, which the owner's rule
         forbids. Nothing it does reaches the database.
         flag นี้เหลืองานเดียว: ถอดติ๊กคีย์ออก · ไม่เขียน ไม่ล้าง */
      for (const keyField of ['custom_ai_key', 'custom_ai_key_sec']) {
        const at = fields.indexOf(keyField);
        if (at !== -1) fields.splice(at, 1);
      }
    }
    const results: Record<string, unknown>[] = [];

    for (const rawTargetId of targetIds as string[]) {
      const targetId = String(rawTargetId);
      const target = await this.hookModel
        .findById(targetId)
        .lean<LeanHook>()
        .exec();
      if (!target) {
        results.push({ hook_id: targetId, ok: false, reason: 'not_found' });
        continue;
      }

      /**
       * Two layers: (1) the caller's own group access, always enforced;
       * (2) target group == source group, which `allow_cross_group` may lift.
       * Cross-group is therefore gated by the login's permissions, never
       * bypassed — ข้ามกลุ่มได้เฉพาะกลุ่มที่ login มีสิทธิ์.
       */
      if (
        !allowCrossGroup &&
        groupIdToString(target['group']) !== groupIdToString(source['group'])
      ) {
        results.push({
          hook_id: targetId,
          ok: false,
          reason: 'different_group',
        });
        continue;
      }
      try {
        this.ensureGroupAccess(ctx.user, target['group']);
        // [FIX-20260818-HOOKWRITESCOPE] tier 2, inside the same try so an
        // out-of-scope target reports `forbidden` like a wrong-group one.
        await assertHookInScope(ctx.user, this.hookModel, target['_id']);
      } catch {
        results.push({ hook_id: targetId, ok: false, reason: 'forbidden' });
        continue;
      }

      const updates: Record<string, unknown> = {};
      const changedFields: AuditChange[] = [];
      for (const field of fields) {
        if (NEVER_CLONE.has(field)) continue; // second layer, per legacy
        const nextVal = source[field];
        const prevVal = target[field];
        if (JSON.stringify(prevVal) === JSON.stringify(nextVal)) continue;
        /* [FIX-20260822-CLONEUNDEF] A FIELD THE SOURCE DOES NOT HAVE IS NOT A
         * WRITE — and it never was. The comparison above uses JSON, and
         * `JSON.stringify(undefined)` is `undefined`, so a source row that
         * never stored this column still reaches here; mongoose then strips
         * `undefined` out of `$set` (verified on 9.9.1: `{a: undefined, b: 1,
         * c: null}` casts to `{b: 1, c: null}`), so the database was never
         * touched. What DID happen was a lie in three places: `changed` counted
         * it, an audit row named a change nobody made, and the hook cache was
         * invalidated for a write that did not occur. Skipping it changes no
         * data — it makes the report match the data.
         *
         * ⚠️ `null` is NOT skipped: a source that really holds `null` is
         * clearing the field on purpose, and that write still happens.
         * ⛔ If "clone" should ever mean "make the target identical, including
         * unsetting what the source lacks", that is a $unset — a data-affecting
         * change that needs the owner's approval first, not a quiet edit here.
         * ไม่มีค่าที่ต้นทาง = ไม่ได้เขียนอะไร ห้ามนับ ห้ามลง log. */
        if (nextVal === undefined) continue;
        updates[field] = nextVal;
        changedFields.push({
          field,
          from: W.maskForAudit(field, prevVal, CLONE_SECRET_KEYS),
          to: W.maskForAudit(field, nextVal, CLONE_SECRET_KEYS),
        });
      }

      /* ══ [FEAT-20260904-VENDORSECCOL] A KEY IS WRITTEN ONLY IF IT WAS TICKED ══
       *
       * Owner, 04/09: *"เอาคีย์ 1 ไหม เอาคีย์ 2 ไหม · ถ้าไม่เอาก็ไม่ทับ ไม่ทำอะไรกับ
       * ค่านั้น"* — each vendor's key is its own opt-in tick, and an unticked key
       * is NOT WRITTEN, NOT CLEARED, NOT TOUCHED. Nothing below writes a key
       * column; the copy loop above does, and only for a ticked field.
       * ไม่ติ๊ก = ไม่แตะ เด็ดขาด
       *
       * TWO BEHAVIOURS WERE REMOVED HERE, both introduced by P2-20260813, both
       * written when a single `custom_ai_key` served every vendor:
       *
       *   mode A — when the vendor moved, the source's key was copied WITHOUT a
       *     tick, so the target would not sit on a vendor it had no key for.
       *   mode B — `ai_vendor_without_key` CLEARED the target's key, so it could
       *     not fire the previous vendor's credential at the new vendor.
       *
       * Both were guarding a hazard the column split deleted: a key now lives in
       * a column only its own vendor reads, so a leftover credential is never
       * sent anywhere. What remains is an OA that may not be able to answer —
       * information, not a reason to overwrite somebody's paid key. So it is
       * REPORTED instead (`ai_key_missing_for_vendor` on this target's result
       * row), and the admin decides: tick the key, or go and enter one.
       * ของเดิมกันการรั่ว · การรั่วหมดไปแล้ว เหลือแค่ "อาจตอบไม่ได้" ซึ่งต้องบอก ไม่ใช่ไปทับ
       *
       * ⚠️ WHY `hasSharedFallback` AND NOT `!key`. A keyless GEMINI hook still
       * answers — it rides the shared env ladder — so warning about it would be
       * false. Only a vendor with no rung to fall back to is genuinely stuck.
       * The fact lives on the vendor table so vendor #3 answers it too.
       *
       * ⚠️ Read from the RESULTING vendor, not the source's: when the vendor did
       * not move for this target, the OA the admin is looking at is still on its
       * own vendor, and that is the one that has to be able to answer.
       *
       * revert: `git show ckpt-aivendorsec-be-04092026 -- <this file>` carries
       *         both blocks; restoring them re-enables the drag and the clear. */
      const resultingVendor = (
        updates['ai_vendor'] !== undefined
          ? updates['ai_vendor']
          : target['ai_vendor']
      ) as string | null | undefined;
      const resultingColumns = resolveVendorColumns(resultingVendor);
      const resultingKey =
        updates[resultingColumns.keyField] !== undefined
          ? updates[resultingColumns.keyField]
          : target[resultingColumns.keyField];
      /* Only when this clone actually carried vendor settings — otherwise a
         slip-tab clone would start commenting on an AI state it never touched. */
      const aiKeyMissingForVendor =
        clonesVendor &&
        !resultingColumns.hasSharedFallback &&
        resultingKey == null
          ? (resultingVendor ?? null)
          : null;

      /* [FEAT-20260822-NOTICEMODE] A notice status and its flex card are a
       * BOUND PAIR — same hazard the ai_vendor ↔ custom_ai_key blocks above
       * document, same per-target gating. A Multi-Clone field-pick can tick a
       * status without its card; copied alone onto a card-less OA it writes
       * status-ON-without-card — the exact state the D6 write gate refuses
       * ("ไม่ให้เซฟ เตือนเลือกให้ครบ"). So when the status MOVES TO ON for
       * this target and the target holds no card of its own, the source's card
       * rides along. Per-target on purpose: a target that already carries its
       * own card keeps it — overwriting it would replace a working binding the
       * operator never ticked (the same-vendor lesson above). Cards are global
       * documents (see the payment_flex_ids note in hook-field-tabs.ts), so
       * the target can resolve the source's id. A source whose status is ON
       * always has a card — every notice write path enforces D6 — so there is
       * no "source has nothing to drag" branch, per the no-unreachable-branch
       * rule the vendor block cites. ติ๊กครึ่งคู่ = ยังได้ทั้งคู่ เฉพาะเป้าที่ไม่มีการ์ด.
       * revert: delete this block. */
      for (const pair of N.NOTICE_CARD_PAIRS) {
        if (
          updates[pair.status] === true &&
          !fields.includes(pair.flex) &&
          N.readNoticeFlex(target[pair.flex]) === null &&
          N.readNoticeFlex(source[pair.flex]) !== null
        ) {
          updates[pair.flex] = source[pair.flex];
          changedFields.push({
            field: pair.flex,
            from: W.maskForAudit(
              pair.flex,
              target[pair.flex],
              CLONE_SECRET_KEYS,
            ),
            to: W.maskForAudit(pair.flex, source[pair.flex], CLONE_SECRET_KEYS),
          });
        }
      }

      /* [FIX-20260822-NOTICEHARDEN] THE CLONE HONOURS THE SAME CARD GATE AS
       * THE WRITE ROUTES. `PUT /hook/notice/:id` and `PATCH /hook/notice/bulk`
       * refuse a state where a notice toggle is ON without every card its side
       * needs; the clone path did not, so a field-pick of the SCOPE alone —
       * onto a target already switched on — could leave `status: true`,
       * `scope: 'slip'` and no all-cards. That hook then stayed silent at
       * runtime (no case could load a card) AND rejected every later PUT,
       * including edits to the other side: an OA locked out by a clone.
       *
       * Judged on the state the write would LEAVE (updates over target), the
       * same effective-state rule the routes use. A violating target is
       * reported and SKIPPED — never half-written — so the rest of the batch
       * still clones. โคลนต้องไม่สร้างสถานะที่ route ของตัวเองปฏิเสธ.
       * revert: delete this block; the clone goes back to writing blind. */
      /* ⚠️ SCOPED TO CLONES THAT ACTUALLY TOUCH THE NOTICE FIELDS. Judging the
       * effective state unconditionally meant a target carrying a pre-existing
       * bad notice state (reachable before this gate existed, or by hand) had
       * EVERY later clone refused — an operator copying `ai_prompt` to twenty
       * OAs would silently lose one of them to a setting they never picked.
       * The gate answers for what this clone WRITES, not for what it found.
       * ตรวจเฉพาะตอนโคลนแตะ field ของ notice จริง ๆ. */
      /* ⚠️ AND ON WHAT WILL ACTUALLY BE WRITTEN. A source row that never stored
       * a notice field puts an explicit `undefined` into `updates` (the differ
       * above compares JSON, and `JSON.stringify(undefined)` is `undefined`),
       * which mongoose strips out of `$set` — nothing is written, yet the gate
       * used to read that key as "the toggle is being turned off" and waved the
       * clone through, leaving exactly the locked-out OA this block exists to
       * prevent. See withoutUndefined's header for the mirror case.
       * ตัดค่า undefined ทิ้งก่อนตัดสิน ไม่งั้นประตูโดนหลบ. */
      /* [FEAT-20261016-SLIPGUARDLOAN] a provider move without its key is held for this target and
         reported — loan only; on shop-api nothing is ever a move (hook-clone/slip-pair.ts) */
      const slipHeld = holdSlipProviderWithoutKey({
        updates,
        changedFields,
        target,
        fields,
      });
      const effectiveUpdates = N.withoutUndefined(updates);
      const touchesNotice = N.NOTICE_FIELDS.some((f) => f in effectiveUpdates);
      const noticeViolation = touchesNotice
        ? N.noticeCardViolation(effectiveUpdates, target)
        : null;
      if (noticeViolation) {
        results.push({
          hook_id: targetId,
          ok: false,
          reason: 'notice_cards_incomplete',
          detail: noticeViolation,
          alias: target['alias'],
        });
        continue;
      }

      // Sharing web_code is a conscious act, so it is reported whenever the
      // operator opted in — even if the value already matched.
      const webCodeSharedWith = wantedSecrets.has('customer_link_web_code')
        ? (source['alias'] as string) ||
          (source['line_oa_name'] as string) ||
          String(sourceId)
        : undefined;

      // Best-effort: a failed grant must not fail an otherwise good clone.
      let granted = false;
      if (forceGrant && target['group']) {
        try {
          await this.grantHookToGroupUsers(targetId, target['group']);
          granted = true;
        } catch {
          /* logged by the caller's error path in legacy; non-fatal */
        }
      }

      if (changedFields.length === 0) {
        results.push({
          hook_id: targetId,
          ok: true,
          changed: 0,
          alias: target['alias'],
          web_code_shared_with: webCodeSharedWith,
          granted,
          ...(slipHeld ? { slip_provider_held_without_key: true } : {}),
        });
        continue;
      }

      await this.hookModel.updateOne({ _id: targetId }, { $set: updates });

      // [FIX-20260812-CLONECACHE] clone เขียน field ที่ webhook อ่าน (flex_custom_ids,
      // custom_tool_id, ฯลฯ) แต่เดิม **ไม่บอก HookCacheService** ⇒ webhook เสิร์ฟ hook
      // ตัวเก่าจน TTL หมด (L1 15วิ / L2 12ชม). invalidate ด้วย alias ของ target (มีใน
      // scope อยู่แล้ว — ดู :2912) ⇒ L1+L2+pub/sub ทุก instance โหลดใหม่รอบหน้า.
      // เฉพาะ target ที่เขียนจริง (changed>0) — เคส changed:0 continue ไปก่อนถึงนี่แล้ว.
      // best-effort: invalidate กลืน error เอง (fail-open) ไม่ทำให้ clone ล้ม.
      // revert: ลบ 1 บรรทัดนี้.
      await this.hookCache.invalidateHookCache(target['alias'] as string);

      /**
       * One entry per target: who copied what, from where, which tabs.
       * ⚠️ `action: "update"` because the schema enum has no "clone" — adding
       * one would change a schema other flows share, so the note carries it.
       */
      await this.auditLog
        .createAuditLog({
          ref_id: targetId,
          hook_id: targetId,
          group_id: target['group'] ?? null,
          parent: 'hook',
          action: 'update',
          changed_fields: changedFields,
          actor: this.buildActor(ctx),
          request_meta: this.buildRequestMeta(ctx),
          note:
            `[CLONE] คัดลอกจาก ${
              (source['alias'] as string) ||
              (source['line_oa_name'] as string) ||
              sourceId
            } ` +
            `(id: ${sourceId}) · แท็บ: ${tabList.join(', ')}` +
            (wantedSecrets.size
              ? ` · รวมค่าลับ: ${[...wantedSecrets].join(', ')}`
              : ''),
        })
        .catch(() => {
          // A broken log must not make written data look like a failure.
        });

      results.push({
        hook_id: targetId,
        ok: true,
        changed: changedFields.length,
        alias: target['alias'],
        web_code_shared_with: webCodeSharedWith,
        granted,
        /* [FEAT-20260904-VENDORSECCOL] The one thing the operator cannot see for
           themselves: this OA was just pointed at a vendor it holds no key for,
           so it will refuse every message until someone enters one. Present ONLY
           when true, so a normal clone result keeps the shape it has today and
           no existing reader has to change. ไม่ได้ทับคีย์ให้ แต่บอกให้รู้ */
        ...(aiKeyMissingForVendor
          ? { ai_key_missing_for_vendor: aiKeyMissingForVendor }
          : {}),
        ...(slipHeld ? { slip_provider_held_without_key: true } : {}),
      });
    }

    const okCount = results.filter((r) => r['ok']).length;
    return {
      source: { hook_id: sourceId, alias: source['alias'] },
      tabs,
      included_secrets: [...wantedSecrets],
      // [FEAT-20260822-CLONEFIELDS] the exact list that was applied — the proof
      // the operator can read back ("ติ๊กอะไรไปแค่นั้น"). Present in both modes.
      fields_applied: [...fields],
      total: results.length,
      success: okCount,
      failed: results.length - okCount,
      results,
    };
  }
}
