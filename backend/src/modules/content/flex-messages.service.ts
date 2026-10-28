import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
/* [FEAT-20260831-MENUMAINTAG] the menu card-tag spelling, on neutral ground:
   `modules/menu` keeps a named allow-list of importers and must stay deletable
   in one command, so the constant is NOT taken from there. See the leaf. */
import { MENU_CARD_TAG_PREFIX } from '@/common/utils/menu-card-tag';

import type { Model } from 'mongoose';
import mongoose from 'mongoose';

import { isSuperUser, type AuthenticatedUser } from '@/common';
import { escapeRegex } from '@/common/utils';
import { AuditLogService } from '@/modules/audit';
import {
  FlexMessage,
  Hook,
  type FlexMessageDocument,
  type HookDocument,
} from '@/modules/hooks';
import {
  Counter,
  TranslationDictCacheService,
  type CounterDocument,
} from '@/modules/system';

import type {
  BulkFlexGroupsDto,
  CreateFlexMessageDto,
  UpdateFlexMessageDto,
} from './dto';
import {
  CONTENT_TAG_MAX,
  CONTENT_TAG_PREFIX,
  normalizeContentTags,
  type ContentTag,
} from './flex-content-tags.util';
import {
  DEFAULT_SOURCE,
  FLEX_VAR_SOURCES,
  FLEX_VAR_TYPES,
  buildContextVarGuidelines,
  buildCustomerHelperVarGuidelines,
  listFlexVarSources,
  type TranslateFn,
} from './flex-var/flex-var-guidelines';
// [FEAT-20260829-MENUPBGUIDE] revert: drop this import + its block in getFlexVariableGuidelines
import { buildMenuPostbackGuidelines } from './flex-var/menu-postback-guidelines';
import { buildPayLinkGuidelines } from './flex-var/paylink-guidelines';

/**
 * Flex card templates, ported from legacy
 * `src/controllers/flex/flexMessageController.js`.
 */

/**
 * Accepted card types. Anything unrecognised — missing, misspelled, injected —
 * becomes `slip`, which is what the whole system was before the field existed.
 *
 * ⚠️ Append only. Never reorder or drop an entry: values already stored in the
 * database have to keep passing.
 */
/**
 * [FEAT-20260829-FLEXMENUTYPE] the one spelling of the menu type. Named so the
 * allow-list, the tab filter and any future reader cannot drift apart.
 */
export const FLEX_TYPE_MENU = 'menu';

const FLEX_TYPES = [
  'normal',
  'slip',
  'profile',
  'custom',
  'profile-semi-custom',
  'template_message',
  // [FEAT-20260810-CUSHELPERTYPE] การ์ดที่ตอบตอน AI ขึ้น tag [[[customer-helper]]]
  // ผูกกับ OA ผ่าน `hook.flex_customerhelper_id` — ไม่ใช่ลิสต์ จึง grant-all ไม่ได้
  // (ไม่มีใน GRANT_FIELD_BY_TYPE โดยตั้งใจ) revert: ลบบรรทัดนี้
  'customerhelper',
  /**
   * [FEAT-20260829-FLEXMENUTYPE] cards for the `[[[menu-*]]]` family.
   *
   * ⚠️ THIS ENTRY MUST EXIST BEFORE ANY UI ASKS FOR IT. `normalizeFlexType`
   * coerces an unknown value to `'slip'`, so `?flex_type=menu` without this line
   * does not return nothing — it returns SLIP cards, and a "Flex Menu" page
   * would quietly list the wrong rows.
   *
   * Deliberately NOT added to `FLEX_VAR_TYPES`: a menu card has no
   * profile/site-rules variable story, exactly like `template_message`. What its
   * author needs is the postback catalogue, which is served separately.
   *
   * revert: delete this entry.
   */
  FLEX_TYPE_MENU,
];

/**
 * [FIX-20260829-EXCLUDEIDSTR] The 24-char hex of a Mongo id, whatever shape it
 * arrived in — WITHOUT the two failure modes this line has already had.
 *
 * The parameter is typed `unknown`, so a bare `String(v)` is genuinely unsafe
 * to the type checker: on a plain object it yields "[object Object]", which
 * `new ObjectId(...)` then rejects. That is what `no-base-to-string` was
 * reporting, and it was right about the TYPE even though the only caller passes
 * an ObjectId instance (`existing._id`, flex-messages.service.ts:919).
 *
 * ⚠️ DO NOT "fix" this with `safeString`. That is the exact edit that caused a
 * real outage: `safeString` maps every object to `''`, so this became
 * `new ObjectId('')`, which throws `BSONError: input must be a 24 character hex
 * string`, escaped as a bare 500, and made the flex edit screen unable to save
 * ANY card. The comment at the call site records that incident in full.
 *
 * So: an ObjectId answers with its own `toHexString()` (the value legacy relies
 * on), a string passes through, and anything else answers '' — which reaches
 * `new ObjectId('')` and throws exactly as the previous code did for a
 * malformed id. Behaviour for every input the callers can actually produce is
 * unchanged; only the "[object Object]" path is removed.
 *
 * revert: inline `String(excludeId)` again and accept the lint error.
 */
function objectIdText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    value &&
    typeof (value as { toHexString?: unknown }).toHexString === 'function'
  ) {
    return (value as { toHexString: () => string }).toHexString();
  }
  return '';
}

/**
 * Coerce an untrusted value to a string without ever producing
 * "[object Object]".
 *
 * These functions take whatever arrived on the wire, and a bare `String(v)` on
 * an object yields a placeholder that then travels into an error message the
 * admin has to act on. Anything non-primitive becomes '' instead, which every
 * caller here already treats as "absent".
 */
function safeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  // null, undefined, objects, arrays, symbols and functions all read as absent.
  return '';
}

/**
 * [FEAT-20260829-FLEXMENUTYPE] the sub-types a menu card may carry.
 * Append-only, exactly like FLEX_TYPES: a value already stored has to keep
 * passing. `main` and `sub` today.
 */
const FLEX_SUB_TYPES = ['main', 'sub'];

/**
 * Coerce a sub-type, and refuse it outright for any type but `menu`.
 *
 * ⚠️ Unknown ⇒ **null**, never a guessed default. A typo must not silently pick
 * a side: the card simply has no sub-type, the menu source will not match it,
 * and that is visible. Choosing `main` as a fallback would hide the mistake.
 * ⚠️ Trimmed but NOT lower-cased. This value is a key a query matches on, not
 * prose — accepting `MAIN` would put two spellings of one thing in the database.
 */
export function normalizeFlexSubType(
  value: unknown,
  flexType: unknown,
): string | null {
  if (safeString(flexType).trim() !== FLEX_TYPE_MENU) return null;
  const trimmed = safeString(value).trim();
  return FLEX_SUB_TYPES.includes(trimmed) ? trimmed : null;
}

/**
 * [FEAT-20260829-FLEXMENUSLUG] the optional free-text label a menu card may carry.
 *
 * ⚠️ Optional means OPTIONAL. Empty stays **null** — no name, no counter, no
 * guessed value. That is what makes "no backfill" true rather than a claim:
 * a card that has never been given one is indistinguishable from one that never
 * will be, and both simply read null.
 * ⚠️ Menu cards only, like the sub-type. A slug left on a slip card would be
 * dead weight a future menu query could trip over.
 * ⚠️ Trimmed and nothing else. The owner asked for TEXT, not an identifier, so
 * no charset rule is invented here — but a trailing space is never meant, and
 * it would make two slugs that look identical differ.
 */
export function normalizeFlexSlug(
  value: unknown,
  flexType: unknown,
): string | null {
  if (safeString(flexType).trim() !== FLEX_TYPE_MENU) return null;
  const trimmed = safeString(value).trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeFlexType(value: unknown): string {
  const trimmed = safeString(value).trim();
  return FLEX_TYPES.includes(trimmed) ? trimmed : 'slip';
}

/**
 * Types that get a running reference tag, each with its OWN counter.
 *
 * ⚠️ Every `counterId` must be distinct, and must differ from `dynamic_tag_ins`
 * — sharing one would interleave two independent numbering schemes.
 * ⚠️ `profile` / `slip` / `normal` are absent on purpose: they get no tag.
 */
const FLEX_TAG_CONFIG: Record<string, { prefix: string; counterId: string }> = {
  custom: { prefix: 'flex_m', counterId: 'flex_message_tag' },
  'profile-semi-custom': {
    prefix: 'flex_pc',
    counterId: 'flex_profile_custom_tag',
  },
  /* [FEAT-20260831-MENUMAINTAG] a menu card is keyed by TYPE **and** SUB-TYPE:
     a main card and a sub card are different things to an operator and must not
     share a series. The spellings come from the menu module's grammar file —
     the only place a menu-shaped marker may be written — so a rename there
     reaches the minter without a second literal here.
     ⚠️ `sub` is minted even though nothing reads it yet (owner, 31/08: "ทำเผื่อไว้
        แต่ไม่ใช้ก็ได้ seamless") — a number that exists costs nothing and cannot
        be handed out twice later. */
  [`${FLEX_TYPE_MENU}:main`]: {
    prefix: MENU_CARD_TAG_PREFIX.main,
    counterId: 'menu_main_tag',
  },
  [`${FLEX_TYPE_MENU}:sub`]: {
    prefix: MENU_CARD_TAG_PREFIX.sub,
    counterId: 'menu_sub_tag',
  },
};

/**
 * [FEAT-20260831-MENUMAINTAG] The key `FLEX_TAG_CONFIG` is read by.
 *
 * Every other type is its own key, exactly as before. Only `menu` splits, and
 * only here — one function, so a caller cannot forget the sub-type on one path
 * and remember it on another. A menu card whose sub-type is missing or unknown
 * yields a key nothing answers, i.e. no tag, which is the honest outcome: we do
 * not know which series it belongs to. ไม่รู้ว่าอยู่ชุดไหน = ไม่แจกเลข.
 */
/**
 * [FEAT-20260831-MENUVARSET] The data sources a MENU card may draw on — fixed,
 * not requested.
 *
 * The flex form always asks for `profile` (it is the default source chip), so a
 * filter over the request would leave a menu card with nothing. What a menu may
 * use is a RULE about the card kind, so it is stated here once and the request
 * is ignored for that type only. เป็นกฎของชนิดการ์ด ไม่ใช่สิ่งที่จอขอมา.
 */
const MENU_SOURCE_ROLES = ['site_rules'] as const;

const flexTagKey = (flexType: string, subType?: string | null): string =>
  flexType === FLEX_TYPE_MENU ? `${flexType}:${subType ?? ''}` : flexType;

/** Does this card get a running reference tag at all? */
const hasFlexTag = (flexType: string, subType?: string | null): boolean =>
  Boolean(FLEX_TAG_CONFIG[flexTagKey(flexType, subType)]);

/** Which hook field a grantable card is added to, by card type. */
const GRANT_FIELD_BY_TYPE: Record<string, string> = {
  custom: 'flex_custom_ids',
  'profile-semi-custom': 'flex_profile_custom_ids',
};

/**
 * A rejection legacy reports with TWO keys, not one:
 *
 *   { "error": "ชื่อเทมเพลตนี้ถูกใช้แล้ว …", "field": "name" }
 *
 * `AllExceptionsFilter` reduces every thrown HttpException to `{ error }` — the
 * right default for the whole API, but it would drop `field`, and the form reads
 * that key to decide which input to highlight. So these two cases are RETURNED
 * by the service and written by the controller with an explicit status, rather
 * than thrown. Everything else in this file still throws and still goes through
 * the shared envelope.
 */
export interface FlexFieldError {
  error: string;
  field: string;
  /** HTTP status the controller must send: 400 for content_tags, 409 for name. */
  status: number;
}

export const isFlexFieldError = (v: unknown): v is FlexFieldError =>
  typeof v === 'object' &&
  v !== null &&
  'field' in v &&
  'error' in v &&
  'status' in v;

export interface FlexGrantResult {
  granted: number;
  field?: string;
  groups?: number;
  skipped?: string;
  error?: string;
}

/**
 * [FEAT-20260830-FLEXBULKGROUPS] what `POST /api/flex-messages/bulk-groups`
 * answers with.
 *
 * `matched` counts the cards this caller was allowed to load, so
 * `matched < flex_ids.length` is normal, not an error: `skipped` names the ids
 * that were deleted or sit outside the caller's groups. `modified` counts only
 * the cards whose scope actually changed — re-running the same batch answers
 * 200 with `modified: 0`.
 */
export interface BulkFlexGroupsResult {
  success: true;
  matched: number;
  modified: number;
  /** The scope every matched card now carries, echoed back for the UI. */
  group_ids: string[];
  updated: { id: string; name: string }[];
  skipped: string[];
}

export interface FlexMessageListItem {
  id: unknown;
  name: string;
  content_json: unknown;
  flex_type: string;
  /** [FEAT-20260829-FLEXMENUTYPE] null on every card that is not a menu. */
  flex_sub_type: string | null;
  /** [FEAT-20260829-FLEXMENUSLUG] optional free text; null when not set. */
  flex_slug: string | null;
  source_role: string | null;
  source_roles: string[];
  content_tags: ContentTag[];
  flex_tag: string | null;
  callback_detail: string;
  // [FEAT-20260810-CARDTICKET] see the schema for what these do.
  direct_ticket_on_reply?: boolean;
  direct_ticket_text?: string;
  callback_tag: string;
  group_ids: unknown[];
  created_by: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface FlexMessageRow {
  _id: unknown;
  name?: string;
  content_json?: unknown;
  flex_type?: string;
  flex_sub_type?: string | null;
  flex_slug?: string | null;
  source_role?: string | null;
  source_roles?: string[];
  content_tags?: ContentTag[];
  flex_tag?: string | null;
  callback_detail?: string;
  // [FEAT-20260810-CARDTICKET]
  direct_ticket_on_reply?: boolean;
  direct_ticket_text?: string;
  callback_tag?: string;
  group_ids?: mongoose.Types.ObjectId[];
  created_by?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

@Injectable()
export class FlexMessagesService {
  private readonly logger = new Logger(FlexMessagesService.name);

  constructor(
    @InjectModel(FlexMessage.name)
    private readonly flexModel: Model<FlexMessageDocument>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    @InjectModel(Counter.name)
    private readonly counterModel: Model<CounterDocument>,
    private readonly auditLogService: AuditLogService,
    /**
     * Supplies `translate` for the example column. The dictionary is cached in
     * process, so building 451 examples is Map lookups, not queries.
     */
    private readonly dictCache: TranslationDictCacheService,
  ) {}

  /**
   * GET /api/flex-messages/variables — the guideline table the card form shows,
   * and the allowlist it validates against.
   *
   * ⚠️ Its route MUST be declared before `flex-messages/:id`; see the controller.
   *
   * `?flex_type=` selects the card shape (only profile-shaped cards get
   * `{{content}}`), and anything unrecognised silently becomes `normal` rather
   * than erroring — the form sends whatever the card holds.
   *
   * `?source=` is a comma-separated list filtered against the registry. An empty
   * result falls back to `profile`. Note it does NOT auto-prepend `profile` the
   * way the card-render path does: asking for only `site_rules` here returns
   * only `site_rules` rows, and that asymmetry is legacy's.
   */
  getFlexVariableGuidelines(query: { flex_type?: string; source?: string }): {
    data: Record<string, unknown>;
  } {
    const requestedType = String(query.flex_type ?? '').trim();
    const flexType = (FLEX_VAR_TYPES as readonly string[]).includes(
      requestedType,
    )
      ? requestedType
      : 'normal';

    const requestedSources = String(query.source ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const sources = requestedSources.filter((r) => FLEX_VAR_SOURCES[r]);
    if (!sources.length) sources.push(DEFAULT_SOURCE);

    const translate: TranslateFn = (dict, key, opts) =>
      this.dictCache.translate(dict, key as never, {
        scope: opts.scope,
        path: opts.path,
      });

    /* [FEAT-20260831-MENUVARSET] Owner, 31/08: a menu card may use the postback
       payloads, the hook context values and the contact-admin button — and NOT
       the customer-variable catalogue, which belongs to cards that answer a
       person. The rows below are that catalogue, so a menu card skips them
       entirely; everything a menu card DOES get is pushed further down.
       ⚠️ The skip is here, not inside the sources: `profile` and `site_rules`
          answer for every other type unchanged, which is the half of this rule
          that matters most (ห้ามยุ่ง normal).
       revert: drop `isMenu` and let the loop run for every type. */
    const isMenu = requestedType === FLEX_TYPE_MENU;
    /* [FEAT-20260831-MENUVARSET] a menu card takes the SITE's own values and
       nothing else from this table.
       Owner, 31/08 (second pass): the site numbers belong on a menu — it shows
       deposit and withdraw rules — while `{{profile.*}}` never did: a menu is
       drawn once for everyone, so a per-person value on it would be wrong by
       construction, not merely unused.
       ⚠️ The role list is FIXED here rather than taken from the request: what a
          menu card may use is a rule, not a preference of whichever screen asked.
          Every other type still receives exactly the roles it requested. */
    const roles = isMenu ? MENU_SOURCE_ROLES : sources;
    const rows: Record<string, unknown>[] = [];
    for (const role of roles) {
      const source = FLEX_VAR_SOURCES[role];
      if (!source) continue;
      let base: ReturnType<typeof source.guide> = [];
      try {
        base = source.guide(flexType, translate) || [];
      } catch {
        // Legacy logs and continues, so one broken source cannot empty the
        // whole table. `site_rules` takes this path here — see the R9 note.
        continue;
      }
      for (const row of base) {
        const bare = String(row.tag || '').replace(/^\{\{|\}\}$/g, '');
        rows.push({
          ...row,
          tag: row.noPrefix ? `{{${bare}}}` : `{{${role}.${bare}}}`,
          /**
           * The un-namespaced spelling, offered only by the implicit source.
           * `undefined` is dropped by JSON.stringify, so the key is simply
           * absent on rows that have no legacy form — which is what the wire
           * shows on legacy too.
           */
          legacy_tag:
            source.implicit && !row.noPrefix ? `{{${bare}}}` : undefined,
          source_role: role,
          source_label: source.label,
        });
      }
    }

    for (const row of buildContextVarGuidelines()) {
      rows.push({
        ...row,
        source_role: 'context',
        source_label: 'ตัวแปรบริบท (ของ hook)',
      });
    }

    /* [FEAT-20260810-CUSHELPERTYPE] tag เฉพาะการ์ด customer-helper
       เปิดให้เฉพาะ flexType นี้ตามที่เจ้าของสั่ง — ตารางนี้เป็น allowlist ตอน
       validate ด้วย ⇒ ชนิดอื่นพิมพ์ {{cus_land_url}} จะถูกตีกลับตอนเซฟ
       revert: ลบ block นี้ ⇒ tag หายจากตารางและถูกตีกลับทุกชนิดเหมือนเดิม */
    /* [FEAT-20260829-MENUPBGUIDE] the postback spec for menu cards.
       Same shape as the customer-helper block directly below: rows appear ONLY
       for this flexType, so no other card's guide changes.
       ⚠️ A menu card reaches here only because the caller passes flex_type=menu;
       `menu` is deliberately absent from FLEX_VAR_TYPES (it has no
       profile/site-rules variable story), so `flexType` is coerced to 'normal'
       for the variable rows above and these postback rows are keyed off the
       RAW requested type instead.
       revert: delete this block + menu-postback-guidelines.ts */
    /* [FIX-20260831-PAYLINKONESOURCE] paylink rows are served for EVERY type
       that may carry one — `slip` as well as `menu` — so the dashboard has a
       single place to read them from and can stop keeping its own copy. The
       table decides which type gets which tag. */
    /* ⚠️ the RAW requested type, not the coerced one: `slip` is not in
       `FLEX_VAR_TYPES` (it has no customer-variable catalogue), so the coerced
       value would be 'normal' and a slip card would be offered nothing — which
       is precisely why the dashboard grew its own copy. */
    for (const row of buildPayLinkGuidelines(requestedType)) {
      rows.push({
        ...row,
        source_role: 'context',
        source_label: 'ปุ่ม paylink (พฤติกรรมปุ่ม ไม่ใช่ค่าที่แสดง)',
      });
    }

    if (isMenu) {
      /* [FEAT-20260831-MENUVARSET] menu-only extras. The paylink rows above
         already covered this type; what is left here is the postback grammar. */
      for (const row of buildMenuPostbackGuidelines()) {
        rows.push({
          ...row,
          source_role: 'context',
          source_label: 'ปุ่มเมนู (postback) — คัดลอกไปวางในปุ่มได้เลย',
        });
      }
    }

    if (flexType === 'customerhelper') {
      for (const row of buildCustomerHelperVarGuidelines()) {
        rows.push({
          ...row,
          source_role: 'context',
          source_label: 'ตัวแปรของ customer-helper',
        });
      }
    }

    return {
      data: {
        flex_type: flexType,
        // The sources actually used this round, not the ones asked for —
        // which is none of them on a menu card. [FEAT-20260831-MENUVARSET]
        sources: roles,
        // Sent so the form builds its chips from here rather than hardcoding.
        available: listFlexVarSources(),
        rows,
        content_tag: { prefix: CONTENT_TAG_PREFIX, max: CONTENT_TAG_MAX },
      },
    };
  }

  /**
   * Group filter shared by get / update / delete, identical to the one the list
   * uses — closing the IDOR where knowing an id from another group was enough
   * to read, edit or delete that group's card.
   *
   * The filter goes INTO the query rather than being checked afterwards, so a
   * card outside the caller's groups answers 404 exactly like a bad id. That
   * refusal to distinguish "does not exist" from "exists but forbidden" is what
   * stops the endpoint being an enumeration oracle.
   */
  private scopeFilter(
    user?: AuthenticatedUser | null,
  ): Record<string, unknown> {
    if (isSuperUser(user)) return {};
    const userGroups = user?.groups ?? [];
    return { group_ids: { $in: userGroups } };
  }

  private static ensureValidGroupIds(
    input: unknown,
  ): mongoose.Types.ObjectId[] {
    if (!input) return [];
    const rawArray = Array.isArray(input) ? input : [input];
    return rawArray
      .filter((id) => mongoose.isValidObjectId(id as string))
      .map((id) => new mongoose.Types.ObjectId(id as string));
  }

  /**
   * Allocate the next reference tag for a card type.
   *
   * `$inc` with `upsert` is atomic server-side, so concurrent creates on
   * different processes cannot collide — which is also why `flex_tag` carries no
   * unique index (most cards leave it null, and nulls collide under one).
   */
  private async generateFlexTag(
    flexType: string,
    /* [FEAT-20260831-MENUMAINTAG] only `menu` reads it; every other type ignores
       it, which is why the parameter is optional and every existing call site
       still compiles unchanged. */
    subType?: string | null,
  ): Promise<string | null> {
    const cfg = FLEX_TAG_CONFIG[flexTagKey(flexType, subType)];
    if (!cfg) return null;
    const counter = await this.counterModel.findOneAndUpdate(
      { _id: cfg.counterId },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    return `${cfg.prefix}${String(counter?.seq ?? 0).padStart(5, '0')}`;
  }

  /**
   * [FIX-20260831-MENUSLUGDUP] Is this menu slug already spoken for?
   * ==========================================================================
   * A slug is how a button names the card it opens (`menu:v1:open:<slug>`), and
   * the engine resolves it BEFORE any group check, so two cards sharing one is a
   * real ambiguity rather than a cosmetic clash.
   *
   * 🔴 DELETED CARDS COUNT. เจอจริง 31/08 บนเครื่องเจ้าของ: two cards held
   * `sub-register`, one soft-deleted an hour earlier; the lookup answered with
   * the deleted one, the renderer refused it, and the live card was never
   * reached — a button that did nothing and explained nothing. A check that
   * skipped deleted rows would allow exactly the collision it exists to stop.
   * ห้ามซ้ำกับใบที่ถูกลบด้วย — นั่นคือใบที่ทำให้เงียบ.
   *
   * ⚠️ NOT scoped to the caller's groups, unlike `isFlexNameTaken` right below.
   * A name is a label a person reads, and refusing one because of a card in
   * another group would be unexplainable; a slug is machinery, and the engine
   * does not know about groups when it resolves one.
   * ⚠️ Menu types only, and never for a blank slug: every other type stores
   * `flex_slug: null`, so a rule that fired on null would refuse every second
   * card of every other kind.
   *
   * revert: delete this method and its two call sites; slugs may collide again.
   */
  private async isMenuSlugTaken(
    slug: unknown,
    flexType: string,
    excludeId?: unknown,
  ): Promise<boolean> {
    if (flexType !== FLEX_TYPE_MENU) return false;
    const trimmed = safeString(slug).trim();
    if (!trimmed) return false;
    const query: Record<string, unknown> = {
      flex_type: FLEX_TYPE_MENU,
      flex_slug: trimmed,
    };
    if (excludeId) {
      /* A malformed id must not throw on a save path: `new ObjectId('nope')`
         raises a BSONError, which would escape as a bare 500 — the same trap the
         name check documents just below. An unusable id simply excludes nothing. */
      const raw = String(excludeId);
      if (mongoose.isValidObjectId(raw)) {
        query['_id'] = { $ne: new mongoose.Types.ObjectId(raw) };
      }
    }
    const hit = await this.flexModel.findOne(query).lean().exec();
    return Boolean(hit);
  }

  /**
   * Template names must be unique among the cards the caller can SEE.
   *
   * Scoped rather than global on purpose: a clash reported against a card in
   * another group would be unexplainable to the admin looking at the screen.
   * Compared case-insensitively and trimmed, so "Chat" and "chat " collide.
   */
  private async isFlexNameTaken(
    name: unknown,
    user: AuthenticatedUser | undefined,
    excludeId?: unknown,
  ): Promise<boolean> {
    const trimmed = safeString(name).trim();
    if (!trimmed) return false;
    const query: Record<string, unknown> = {
      name: new RegExp(`^${escapeRegex(trimmed)}$`, 'i'),
      deleted_at: { $exists: false },
      ...this.scopeFilter(user),
    };
    if (excludeId) {
      // ⚠️ `String(...)`, NOT `safeString(...)`. Legacy is
      // `new mongoose.Types.ObjectId(String(excludeId))`
      // (flexMessageController.js:401), and the only caller passes
      // `existing._id` — an ObjectId INSTANCE, not a string.
      //
      // `safeString` maps every object to `''` (see its own comment: "objects …
      // read as absent"), so this became `new ObjectId('')`, which throws
      // `BSONError: input must be a 24 character hex string`. That escaped as a
      // bare 500 `{"error":"internal error"}` and made the flex edit screen
      // unable to save ANY card whose name was submitted — i.e. every save.
      //
      // `String(objectId)` yields the 24-char hex, which is what legacy relies
      // on. Keeping the ObjectId construction (rather than passing the instance
      // straight through) preserves legacy's behaviour for a malformed id too:
      // it throws there as well.
      query._id = { $ne: new mongoose.Types.ObjectId(objectIdText(excludeId)) };
    }
    return Boolean(await this.flexModel.findOne(query).select('_id').lean());
  }

  /**
   * `null` / `''` / `'profile'` all mean the implicit profile block, which is
   * the pre-feature behaviour. Any other value is stored as sent: new roles
   * appear on custom tools without this file needing to know about them, and the
   * webhook falls back to profile if it cannot resolve one.
   */
  private static normalizeSourceRole(
    value: unknown,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    const s = safeString(value).trim();
    return s === '' || s === 'profile' ? null : s;
  }

  /**
   * Source list, filtered to the known registry, de-duplicated, order preserved.
   *
   * Legacy filters against `FLEX_VAR_SOURCES` from `config/flexVarSources.js`.
   * The runtime form of that registry is ported in
   * `webhook/flex-data-vars.util.ts:539-556`; this admin-CRUD validation path
   * needs only the role names, so the complete legacy set — `profile` and
   * `site_rules` — is stated here directly. The effect is identical for every
   * input.
   */
  private static normalizeSourceRoles(value: unknown): string[] | undefined {
    if (value === undefined) return undefined;
    const known = new Set(['profile', 'site_rules']);
    const arr = Array.isArray(value) ? value : [value];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of arr) {
      const k = String(x ?? '').trim();
      if (!k || seen.has(k) || !known.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    return out;
  }

  /**
   * Tick this card on every hook in its groups (∩ what the caller may touch).
   *
   * Additive only (`$addToSet`, idempotent) — it never removes a card from a
   * hook, so running it twice changes nothing and a mistake here cannot
   * un-grant an existing card.
   */
  private async grantFlexToHooks(
    user: AuthenticatedUser | undefined,
    flexId: unknown,
    flexType: string,
    flexGroupIds: unknown[],
  ): Promise<FlexGrantResult> {
    const field = GRANT_FIELD_BY_TYPE[flexType];
    // profile picks a single card (flex_profile_id); slip/normal/template have
    // no reply list at all. Neither is grantable.
    if (!field) return { granted: 0, skipped: 'type_not_grantable' };

    const flexGroups = (flexGroupIds ?? []).map((g) => String(g));
    let scopedGroups = flexGroups;
    if (!isSuperUser(user)) {
      const userGroups = (user?.groups ?? []).map((g) => String(g));
      scopedGroups = flexGroups.filter((g) => userGroups.includes(g));
    }
    if (scopedGroups.length === 0) {
      return { granted: 0, skipped: 'no_groups_in_scope' };
    }

    const result = await this.hookModel.updateMany(
      {
        group: {
          $in: scopedGroups.map((g) => new mongoose.Types.ObjectId(g)),
        },
      },
      { $addToSet: { [field]: new mongoose.Types.ObjectId(String(flexId)) } },
    );
    return {
      granted: result.modifiedCount ?? 0,
      field,
      groups: scopedGroups.length,
    };
  }

  /** Shared response mapping. Old rows have no `flex_type` → `slip`. */
  private static toListItem(item: FlexMessageRow): FlexMessageListItem {
    return {
      id: item._id,
      name: item.name ?? '',
      content_json: item.content_json,
      flex_type: item.flex_type || 'slip',
      // [FEAT-20260829-FLEXMENUTYPE] null on every card that is not a menu.
      flex_sub_type: item.flex_sub_type ?? null,
      // [FEAT-20260829-FLEXMENUSLUG] null on every card that is not a menu.
      flex_slug: item.flex_slug ?? null,
      // ⚠️ source_role / source_roles / content_tags must come back even when
      // empty. Omitting one makes the form load with a blank chip, which looks
      // like the admin deselected it — and the next save then writes [] over
      // the real configuration in the database.
      source_role: item.source_role ?? null,
      source_roles: item.source_roles ?? [],
      content_tags: item.content_tags ?? [],
      flex_tag: item.flex_tag || null,
      callback_detail: item.callback_detail || '',
      callback_tag: item.callback_tag || '',
      /* [FEAT-20260810-CARDTICKET] returned so reopening a card shows what is
         stored. Absent on every card saved before this feature ⇒ false/''. */
      direct_ticket_on_reply: item.direct_ticket_on_reply === true,
      direct_ticket_text: item.direct_ticket_text || '',
      group_ids: item.group_ids ?? [],
      created_by: item.created_by,
      created_at: item.created_at,
      updated_at: item.updated_at,
    };
  }

  public async listFlexMessages(
    query: Record<string, string | undefined>,
    user?: AuthenticatedUser,
  ): Promise<{
    data: FlexMessageListItem[];
    meta: { total: number; page: number; limit: number };
  }> {
    const page = Math.max(Number(query['page']) || 1, 1);
    const limit = Math.min(Math.max(Number(query['limit']) || 25, 1), 200);

    const filters: Record<string, unknown> = {
      deleted_at: { $exists: false },
    };

    if (!isSuperUser(user)) {
      filters.group_ids = { $in: user?.groups ?? [] };
    }

    // An explicit filter replaces the scope filter entirely — same as legacy.
    // Not a hole: the values still have to be group ids the caller knows, and
    // every read below is scoped again by the same rule.
    if (query['group_id']) {
      const filterGroups = FlexMessagesService.ensureValidGroupIds(
        query['group_id'],
      );
      if (filterGroups.length > 0) {
        filters.group_ids = { $in: filterGroups };
      }
    }

    if (query['name']) {
      // Escaped so a search for "[[[flex_m00001]]]" is a literal, not a regex.
      const rx = new RegExp(escapeRegex(query['name']), 'i');
      filters.$or = [{ name: rx }, { flex_tag: rx }];
    }

    /**
     * [FEAT-20260829-FLEXMENUTYPE] the dashboard's two tabs, decided HERE.
     *
     * `tab=menu`   → menu cards only.
     * `tab=normal` → everything that is NOT a menu card.
     *
     * ⚠️ `$ne` and nothing else. Two of the live rows carry no `flex_type` at
     * all; `$ne` matches a missing field and keeps them, while listing the other
     * types explicitly would drop them from the page people use every day —
     * measured: 55 rows with `$ne`, 53 with an `$in` list. Same trap the
     * `$in: ['slip', null]` line below was written to avoid.
     *
     * ⚠️ The policy lives on the server on purpose. "Normal means not menu" is
     * one sentence in one place; putting it in the dashboard would mean editing
     * the front end again the day a second type gets its own page.
     *
     * An unrecognised `tab` is IGNORED rather than guessed — a typo must not
     * silently show one tab's contents under the other. `flex_type` still works
     * exactly as before and takes precedence when both are sent.
     *
     * revert: delete this block; `tab` becomes an unknown query param again.
     */
    if (!query['flex_type']) {
      if (query['tab'] === 'menu') filters.flex_type = FLEX_TYPE_MENU;
      else if (query['tab'] === 'normal')
        filters.flex_type = { $ne: FLEX_TYPE_MENU };
    }

    if (query['flex_type']) {
      const wanted = normalizeFlexType(query['flex_type']);
      // `$in` with null covers both "field is null" and "field absent" in one
      // clause, so pre-feature rows do not vanish the moment someone filters.
      filters.flex_type = wanted === 'slip' ? { $in: ['slip', null] } : wanted;
    }

    const total = await this.flexModel.countDocuments(filters);
    const rows = await this.flexModel
      .find(filters)
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return {
      data: (rows as unknown as FlexMessageRow[]).map((row) =>
        FlexMessagesService.toListItem(row),
      ),
      meta: { total, page, limit },
    };
  }

  public async getFlexMessageById(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<Omit<FlexMessageListItem, never>> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid identifier');
    }
    const row = await this.flexModel
      .findOne({
        _id: id,
        deleted_at: { $exists: false },
        ...this.scopeFilter(user),
      })
      .lean();

    if (!row) throw new NotFoundException('Flex message not found');
    return FlexMessagesService.toListItem(row);
  }

  public async createFlexMessage(
    dto: CreateFlexMessageDto,
    user: AuthenticatedUser | undefined,
    requestMeta: AuditRequestMetaLike,
  ): Promise<Record<string, unknown> | FlexFieldError> {
    const { name, content_json } = dto;
    if (!name || !content_json) {
      throw new BadRequestException('name and content_json are required');
    }

    // Validated before anything is written: a bad slot must be a 400 with the
    // reason, never a silent collapse to "declares nothing".
    const tagsCheck = normalizeContentTags(dto.content_tags);
    if (tagsCheck.error) {
      return { error: tagsCheck.error, field: 'content_tags', status: 400 };
    }

    if (await this.isFlexNameTaken(name, user)) {
      return {
        error: 'ชื่อเทมเพลตนี้ถูกใช้แล้ว กรุณาตั้งชื่ออื่น',
        field: 'name',
        status: 409,
      };
    }

    /* [FIX-20260831-MENUSLUGDUP] a menu slug names the card a button opens, so a
       duplicate makes the destination a coin toss — and the copy that wins may be
       a DELETED one, which renders nothing and says nothing. Refused here, where
       the operator can still fix it. */
    if (
      await this.isMenuSlugTaken(
        dto.flex_slug,
        normalizeFlexType(dto.flex_type),
      )
    ) {
      return {
        error: 'Menu Slug นี้ถูกใช้แล้ว (รวมการ์ดที่ถูกลบ) กรุณาตั้งชื่ออื่น',
        field: 'flex_slug',
        status: 409,
      };
    }

    const userId = user?.userId;
    const finalGroupIds = FlexMessagesService.ensureValidGroupIds(
      dto.group_ids,
    );
    const finalFlexType = normalizeFlexType(dto.flex_type);
    /* [FEAT-20260831-MENUMAINTAG] normalised ONCE and reused for both the tag and
       the stored column below — a menu card's series is decided by its sub-type,
       so reading it twice would be two chances to disagree. */
    const finalFlexSubType = normalizeFlexSubType(
      dto.flex_sub_type,
      finalFlexType,
    );
    const finalFlexTag = hasFlexTag(finalFlexType, finalFlexSubType)
      ? await this.generateFlexTag(finalFlexType, finalFlexSubType)
      : null;

    const created = await this.flexModel.create({
      name,
      content_json,
      flex_type: finalFlexType,
      // [FEAT-20260829-FLEXMENUTYPE] forced null unless the type is `menu`.
      flex_sub_type: finalFlexSubType,
      // [FEAT-20260829-FLEXMENUSLUG] null unless the type is `menu`; blank = null.
      flex_slug: normalizeFlexSlug(dto.flex_slug, finalFlexType),
      flex_tag: finalFlexTag,
      source_role:
        FlexMessagesService.normalizeSourceRole(dto.source_role) ?? null,
      /* [FIX-20260831-MENUROLESAVE] a menu card STORES the rule it is already
         shown. `MENU_SOURCE_ROLES` decides which variables the guide offers for
         this type; the row has to declare the same set, because the central
         builder reads `source_roles` off the doc to decide what to build. With
         `[]` saved, the guide advertised `{{site_rules.*}}` and the card then
         printed them raw at a customer — seen live 31/08 on `sub-register`.
         One rule, one constant, both ends. */
      source_roles:
        finalFlexType === FLEX_TYPE_MENU
          ? [...MENU_SOURCE_ROLES]
          : (FlexMessagesService.normalizeSourceRoles(dto.source_roles) ?? []),
      content_tags: tagsCheck.value,
      callback_detail: dto.callback_detail || '',
      callback_tag: dto.callback_tag || '',
      // [FEAT-20260810-CARDTICKET] omitted ⇒ off, matching the schema default.
      direct_ticket_on_reply: dto.direct_ticket_on_reply === true,
      direct_ticket_text: dto.direct_ticket_text || '',
      group_ids: finalGroupIds,
      created_by: userId,
      updated_by: userId,
    });

    const actor = buildActor(user);
    // Fire-and-forget, exactly as legacy: an audit write that fails must not
    // fail the create the admin just performed.
    await this.auditLogService
      .createAuditLog({
        ref_id: created._id,
        group_id: created.group_ids?.[0] ?? null,
        parent: 'flex_message',
        action: 'create',
        changed_fields: [
          { field: 'name', from: null, to: name },
          { field: 'content_json', from: null, to: content_json },
          { field: 'flex_type', from: null, to: finalFlexType },
          { field: 'flex_tag', from: null, to: finalFlexTag },
          { field: 'callback_detail', from: null, to: dto.callback_detail },
          { field: 'callback_tag', from: null, to: dto.callback_tag },
          { field: 'group_ids', from: null, to: finalGroupIds },
        ],
        actor,
        request_meta: requestMeta,
        note: `Created Flex template: ${name} (by ${actor.display_name || actor.username})`,
      })
      .catch((err: Error) =>
        this.logger.error(`flex audit log failed: ${err.message}`),
      );

    let grant: FlexGrantResult | null = null;
    if (dto.grant_all_hooks === true) {
      grant = await this.grantFlexToHooks(
        user,
        created._id,
        finalFlexType,
        finalGroupIds,
      ).catch((err: Error) => {
        this.logger.error(`flex grant-all failed: ${err.message}`);
        return { granted: 0, error: err.message };
      });
    }

    return {
      id: created._id,
      name: created.name,
      content_json: created.content_json,
      flex_type: created.flex_type,
      content_tags: created.content_tags ?? [],
      flex_tag: created.flex_tag || null,
      callback_detail: created.callback_detail,
      callback_tag: created.callback_tag,
      group_ids: created.group_ids,
      created_by: created.created_by,
      created_at: (created as unknown as FlexMessageRow).created_at,
      grant_all_hooks: grant,
    };
  }

  public async updateFlexMessage(
    id: string,
    dto: UpdateFlexMessageDto,
    user: AuthenticatedUser | undefined,
    requestMeta: AuditRequestMetaLike,
  ): Promise<Record<string, unknown> | FlexFieldError> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid identifier');
    }

    const updates: Record<string, unknown> = { updated_by: user?.userId };

    // Absent means "leave alone"; [] means "clear the slots deliberately".
    if (dto.content_tags !== undefined) {
      const tagsCheck = normalizeContentTags(dto.content_tags);
      if (tagsCheck.error) {
        return { error: tagsCheck.error, field: 'content_tags', status: 400 };
      }
      updates['content_tags'] = tagsCheck.value;
    }

    if (dto.name !== undefined) updates['name'] = dto.name;
    if (dto.content_json !== undefined) {
      updates['content_json'] = dto.content_json;
    }
    if (dto.flex_type !== undefined) {
      updates['flex_type'] = normalizeFlexType(dto.flex_type);
      /**
       * [FEAT-20260829-FLEXMENUTYPE] the sub-type is re-decided against the type
       * this save ENDS with, in the same write. Editing a menu card into a slip
       * card therefore CLEARS the sub-type instead of leaving a value that only
       * means something for menus.
       *
       * ⚠️ Handled inside this branch on purpose: `updateFlexMessage` never reads
       * the stored document, so a request carrying `flex_sub_type` WITHOUT
       * `flex_type` has nothing to validate against. Such a request is ignored
       * rather than trusted — the dashboard always submits the whole form, so
       * this cannot happen from the UI, and an API caller that omits the type
       * gets no silent write instead of a possibly-wrong one.
       */
      updates['flex_sub_type'] = normalizeFlexSubType(
        dto.flex_sub_type,
        updates['flex_type'],
      );
      // [FEAT-20260829-FLEXMENUSLUG] same rule, same write: turning a menu card
      // into another type clears the slug rather than leaving it behind.
      updates['flex_slug'] = normalizeFlexSlug(
        dto.flex_slug,
        updates['flex_type'],
      );
    }
    if (dto.source_role !== undefined) {
      updates['source_role'] = FlexMessagesService.normalizeSourceRole(
        dto.source_role,
      );
    }
    if (dto.source_roles !== undefined) {
      updates['source_roles'] = FlexMessagesService.normalizeSourceRoles(
        dto.source_roles,
      );
    }
    if (dto.callback_detail !== undefined) {
      updates['callback_detail'] = dto.callback_detail;
    }
    /* [FEAT-20260810-CARDTICKET] This service copies field by field, so a field left
       out here is dropped SILENTLY on save — the admin ticks the box, saves, and finds
       it unticked. Same trap the hook whitelist carries a warning about.
       ไม่ใส่ที่นี่ = ติ๊กแล้วหายเงียบ ๆ */
    if (dto.direct_ticket_on_reply !== undefined) {
      updates['direct_ticket_on_reply'] = dto.direct_ticket_on_reply === true;
    }
    if (dto.direct_ticket_text !== undefined) {
      updates['direct_ticket_text'] = dto.direct_ticket_text;
    }
    if (dto.callback_tag !== undefined) {
      updates['callback_tag'] = dto.callback_tag;
    }
    if (dto.group_ids !== undefined) {
      updates['group_ids'] = FlexMessagesService.ensureValidGroupIds(
        dto.group_ids,
      );
    }

    const existing = (await this.flexModel
      .findOne({
        _id: id,
        deleted_at: { $exists: false },
        ...this.scopeFilter(user),
      })
      .lean()) as unknown as FlexMessageRow | null;
    if (!existing) throw new NotFoundException('Flex message not found');

    if (
      dto.name !== undefined &&
      (await this.isFlexNameTaken(dto.name, user, existing._id))
    ) {
      return {
        error: 'ชื่อเทมเพลตนี้ถูกใช้แล้ว กรุณาตั้งชื่ออื่น',
        field: 'name',
        status: 409,
      };
    }

    /* [FIX-20260831-MENUROLESAVE] the save-time rule, applied where the card's
       effective type is finally known. A menu card stores the source set its own
       variable guide advertises; anything else keeps exactly what it asked for.
       This is also the repair path for an older menu card: saving it again gives
       it the roles it should always have had. */
    if (
      normalizeFlexType(updates['flex_type'] ?? existing.flex_type) ===
      FLEX_TYPE_MENU
    ) {
      updates['source_roles'] = [...MENU_SOURCE_ROLES];
    }

    /* [FIX-20260831-MENUSLUGDUP] the same rule on edit, with ONE difference: the
       card being saved is excluded, or renaming anything else on a menu card
       would collide with the slug it already owns. */
    if (
      updates['flex_slug'] !== undefined &&
      (await this.isMenuSlugTaken(
        updates['flex_slug'],
        String(updates['flex_type'] ?? normalizeFlexType(existing.flex_type)),
        existing._id,
      ))
    ) {
      return {
        error: 'Menu Slug นี้ถูกใช้แล้ว (รวมการ์ดที่ถูกลบ) กรุณาตั้งชื่ออื่น',
        field: 'flex_slug',
        status: 409,
      };
    }

    /**
     * Allocate a tag for a card that has just BECOME a tag-bearing type.
     *
     * ⚠️ A card that already has one is never touched: the number has to stay
     * stable for life, because someone has copied it somewhere else and a
     * rename of the card must not invalidate it.
     * ⚠️ Switching AWAY from a tagged type keeps the old tag rather than
     * clearing it — clearing it would mint a new number on the way back while
     * the old one silently stops resolving.
     */
    if (!existing.flex_tag) {
      const nextType =
        updates['flex_type'] !== undefined
          ? (updates['flex_type'] as string)
          : normalizeFlexType(existing.flex_type);
      /* [FEAT-20260831-MENUMAINTAG] the sub-type decides a menu card's series, so
         the backfill has to read the value this update is about to store — or the
         one already on the row when the update does not touch it. Reading only
         the type would mint from whichever series happened to be first. */
      const nextSubType =
        updates['flex_sub_type'] !== undefined
          ? (updates['flex_sub_type'] as string | null)
          : normalizeFlexSubType(existing.flex_sub_type, nextType);
      if (hasFlexTag(nextType, nextSubType)) {
        updates['flex_tag'] = await this.generateFlexTag(nextType, nextSubType);
      }
    }

    // Scope repeated in the write itself — `existing` was already checked, but
    // re-applying it closes the TOCTOU window between the two queries.
    const updated = (await this.flexModel
      .findOneAndUpdate({ _id: id, ...this.scopeFilter(user) }, updates, {
        new: true,
        runValidators: true,
      })
      .lean()) as unknown as FlexMessageRow | null;

    if (!updated) throw new NotFoundException('Flex message not found');

    const changedFields = Object.keys(updates)
      .filter(
        (key) =>
          key !== 'updated_by' &&
          JSON.stringify(existing[key as keyof FlexMessageRow]) !==
            JSON.stringify(updates[key]),
      )
      .map((key) => ({
        field: key,
        from: existing[key as keyof FlexMessageRow],
        to: updates[key],
      }));

    const actor = buildActor(user);
    // No audit entry when nothing actually changed — a log of "changed nothing"
    // is noise that makes the real history harder to read.
    if (changedFields.length > 0) {
      await this.auditLogService
        .createAuditLog({
          ref_id: updated._id,
          group_id: updated.group_ids?.[0] ?? null,
          parent: 'flex_message',
          action: 'update',
          changed_fields: changedFields,
          actor,
          request_meta: requestMeta,
          note: `Updated Flex template: ${updated.name} (by ${actor.display_name || actor.username})`,
        })
        .catch((err: Error) =>
          this.logger.error(`flex audit log update failed: ${err.message}`),
        );
    }

    let grant: FlexGrantResult | null = null;
    if (dto.grant_all_hooks === true) {
      grant = await this.grantFlexToHooks(
        user,
        updated._id,
        updated.flex_type ?? 'slip',
        updated.group_ids ?? [],
      ).catch((err: Error) => {
        this.logger.error(`flex grant-all failed: ${err.message}`);
        return { granted: 0, error: err.message };
      });
    }

    return {
      id: updated._id,
      name: updated.name,
      content_json: updated.content_json,
      flex_type: updated.flex_type || 'slip',
      content_tags: updated.content_tags ?? [],
      flex_tag: updated.flex_tag || null,
      callback_detail: updated.callback_detail,
      callback_tag: updated.callback_tag,
      group_ids: updated.group_ids,
      updated_at: updated.updated_at,
      grant_all_hooks: grant,
    };
  }

  /**
   * ==== [FEAT-20260830-FLEXBULKGROUPS] re-scope many cards in one request ====
   *
   * WHAT
   *   Sets `group_ids` on every listed card to exactly what was sent. Nothing
   *   else on the card is read or written.
   *
   * ⚠️ REPLACE, NOT MERGE. Whatever the operator ticks becomes the whole scope.
   *   "Add" and "replace" look identical until somebody loses access they used
   *   to have, so the dialog warns before confirming and this endpoint behaves
   *   the way the warning says. Same rule, same wording, as
   *   `DynamicTagsService.bulkScope` — the closest sibling in this repo, which
   *   does the same job for dynamic tags.
   *
   * ⚠️ A SEPARATE ENDPOINT, NOT A LOOP OVER `updateFlexMessage`. That method can
   *   change any field, mints flex tags, checks name collisions and may run the
   *   hook grant; sending a batch through it would make all of that reachable
   *   from a screen whose only control is a group picker.
   *
   * WHY AT LEAST ONE GROUP IS REQUIRED
   *   `group_ids: []` is a legal write elsewhere, but here it would strip every
   *   non-superuser's access to the card in one click (`scopeFilter` matches on
   *   group membership), with no screen left to undo it from. The single-card
   *   form can still do it deliberately; the bulk path refuses.
   *   ต้องเลือกอย่างน้อย 1 กลุ่ม — ล้างกลุ่มหมด = การ์ดหลุดมือทุกคนที่ไม่ใช่ superuser
   *
   * WHAT IT DELIBERATELY DOES NOT DO
   *   No hook grant. `updateFlexMessage` only ticks cards onto hooks when the
   *   caller sends `grant_all_hooks: true`; this route has no such field, so it
   *   behaves like an update that omitted it. Cards keep whatever hook ticks
   *   they already had.
   *
   * SCOPE / IDOR
   *   `scopeFilter` goes into BOTH the read and each write, so a card outside
   *   the caller's groups is never loaded and never written — it comes back in
   *   `skipped` rather than as an error, the same refusal to distinguish
   *   "missing" from "forbidden" the single-card routes make.
   *
   * revert: delete this method, the `bulk-groups` route in the controller and
   * `BulkFlexGroupsDto`. No data shape changes — `group_ids` already exists on
   * every row, so nothing needs migrating either way.
   */
  public async bulkUpdateGroups(
    dto: BulkFlexGroupsDto,
    user: AuthenticatedUser | undefined,
    requestMeta: AuditRequestMetaLike,
  ): Promise<BulkFlexGroupsResult> {
    // The DTO types these `unknown[]` (see its header), so the element check is
    // this method's job. Anything that is not a plain id string is refused
    // rather than stringified: `String({})` is '[object Object]', which would
    // reach the same 400 by accident instead of on purpose.
    const rawIds = dto.flex_ids ?? [];
    if (rawIds.some((v) => typeof v !== 'string')) {
      throw new BadRequestException('Invalid flex message id in flex_ids');
    }
    const flexIds = [...new Set((rawIds as string[]).filter(Boolean))];
    if (flexIds.length === 0) {
      throw new BadRequestException('flex_ids is required');
    }
    if (flexIds.some((id) => !mongoose.isValidObjectId(id))) {
      throw new BadRequestException('Invalid flex message id in flex_ids');
    }

    const rawGroups = dto.group_ids ?? [];
    const groupIds = FlexMessagesService.ensureValidGroupIds(rawGroups);
    // ensureValidGroupIds silently drops what it cannot parse. Silence is fine
    // when a form sends a clean list; on a bulk write it would move cards to a
    // SMALLER scope than the operator ticked, so a dropped id is a 400 here.
    if (groupIds.length !== rawGroups.length) {
      throw new BadRequestException('Invalid group_ids');
    }
    if (groupIds.length === 0) {
      throw new BadRequestException('ต้องเลือกอย่างน้อย 1 กลุ่ม');
    }

    const cards = (await this.flexModel
      .find({
        _id: { $in: flexIds.map((id) => new mongoose.Types.ObjectId(id)) },
        deleted_at: { $exists: false },
        ...this.scopeFilter(user),
      })
      .lean()) as unknown as FlexMessageRow[];

    const matchedIds = new Set(cards.map((c) => String(c._id)));
    const skipped = flexIds.filter((id) => !matchedIds.has(id));
    if (cards.length === 0) {
      throw new NotFoundException('Flex message not found');
    }

    const actor = buildActor(user);
    const nextKey = JSON.stringify(
      groupIds
        .map(String)
        .slice()
        .sort((a, b) => a.localeCompare(b)),
    );
    const updated: { id: string; name: string }[] = [];
    let modified = 0;

    for (const card of cards) {
      const before = (card.group_ids ?? []).map((g) => String(g));
      const changed =
        JSON.stringify(before.slice().sort((a, b) => a.localeCompare(b))) !==
        nextKey;

      // The scope is repeated in the write itself. `cards` was already filtered,
      // but re-applying it closes the window between the two queries — the same
      // TOCTOU note updateFlexMessage carries.
      await this.flexModel
        .updateOne(
          { _id: String(card._id), ...this.scopeFilter(user) },
          { $set: { group_ids: groupIds, updated_by: user?.userId } },
        )
        .exec();

      updated.push({ id: String(card._id), name: card.name ?? '' });
      if (!changed) continue;
      modified += 1;

      // No audit entry for a card that already had this scope — re-running a
      // batch would otherwise fill the log with entries recording nothing.
      await this.auditLogService
        .createAuditLog({
          ref_id: card._id,
          group_id: groupIds[0] ?? null,
          parent: 'flex_message',
          action: 'update',
          changed_fields: [
            { field: 'group_ids', from: card.group_ids ?? [], to: groupIds },
          ],
          actor,
          request_meta: requestMeta,
          note: `Bulk group scope update: ${card.name ?? ''} (by ${actor.display_name || actor.username})`,
        })
        .catch((err: Error) =>
          this.logger.error(`flex bulk-groups audit failed: ${err.message}`),
        );
    }

    return {
      success: true,
      matched: cards.length,
      modified,
      group_ids: groupIds.map(String),
      updated,
      skipped,
    };
  }

  public async deleteFlexMessage(
    id: string,
    user: AuthenticatedUser | undefined,
    requestMeta: AuditRequestMetaLike,
  ): Promise<{ message: string; id: unknown }> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid identifier');
    }

    // Soft delete, scoped inside the query — atomic, so there is no window in
    // which another group's card could be removed.
    const deleted = (await this.flexModel
      .findOneAndUpdate(
        {
          _id: id,
          deleted_at: { $exists: false },
          ...this.scopeFilter(user),
        },
        { deleted_at: new Date(), updated_by: user?.userId },
        { new: true },
      )
      .lean()) as unknown as FlexMessageRow | null;

    if (!deleted) throw new NotFoundException('Flex message not found');

    const actor = buildActor(user);
    await this.auditLogService
      .createAuditLog({
        ref_id: deleted._id,
        group_id: deleted.group_ids?.[0] ?? null,
        parent: 'flex_message',
        action: 'delete',
        actor,
        request_meta: requestMeta,
        note: `Deleted Flex template: ${deleted.name} (by ${actor.display_name || actor.username})`,
      })
      .catch((err: Error) =>
        this.logger.error(`flex audit log delete failed: ${err.message}`),
      );

    return { message: 'Flex message deleted successfully', id: deleted._id };
  }
}

export interface AuditRequestMetaLike {
  request_id?: string;
  ip?: string;
  user_agent?: string;
}

/**
 * Actor for the audit trail.
 *
 * Falls back to the literal string `system` when there is no authenticated
 * user, matching legacy — the audit schema requires a user_id, and refusing the
 * write would turn a missing identity into a failed admin action.
 */
function buildActor(user?: AuthenticatedUser | null): {
  user_id: string;
  username: string;
  display_name?: string;
} {
  const userId = user?.userId || 'system';
  return {
    user_id: userId,
    username: user?.username || userId,
    display_name: user?.displayName,
  };
}
