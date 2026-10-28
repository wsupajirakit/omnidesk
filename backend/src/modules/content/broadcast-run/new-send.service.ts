/**
 * [FEAT-20260822-BCASTNEWSEND] `BroadcastNewSendPort`, satisfied — the wire
 * between the live sender's branch and the new pipeline.
 * ===========================================================================
 * OWNS NO RULES: it assembles what `runBroadcast` needs, calls it, and turns
 * the report into the two shapes the old sender's callers know. Every ceiling,
 * chunk size, retry key and status is asked of the module that owns it
 * (`SEND_MATRIX`, `planRun`, `summarizeRun`, `claim.ts`). ไม่ใช่คนตั้งกฎ.
 *
 * 🔴 `webhook_logs` IS A CONTRACT TERM. The admin's history tab filters on
 *    `channel:'line_api'` + `action_type:'send_broadcast'` (`Broadcasts.tsx:90-99`,
 *    quoted by `new-send.port.ts`) and goes BLANK WITH NO ERROR if a path stops
 *    writing them. One row per hook, the same fixed fields
 *    `broadcasts.service.ts#logBroadcast` writes, never awaited — as before.
 *
 * 🔴 THE CELL COMES FROM THE JOB'S `send_kind`, since 23/08. Before the column
 *    existed the only defensible choice was `broadcast:plain`, because that is
 *    what the live sender does: POST `/message/broadcast` with NO recipient
 *    list ⇒ `broadcast`, one card for everybody ⇒ `plain`.
 *
 *    That is still what a job gets when it names `'broadcast'`, and a job that
 *    names nothing never reaches this service at all — `usesNewSendPath`
 *    answers false for absent, so `broadcasts.service.ts` keeps it on the old
 *    sender. A job asking for `'multicast'` gets `multicast:plain`: named
 *    recipients, so an audience filter can narrow it.
 *
 *    ⚠️ `card_type` STAYS `plain`. `personal` needs one request per recipient
 *       and there is still no column that asks for it — inventing one here is
 *       the guess `new-path.switch.ts` refused to make.
 *       ยังไม่มีคอลัมน์ card_type ⇒ ห้ามเดา.
 *
 * ⚠️ TWO KNOWN DIFFERENCES FROM THE OLD SENDER: (1) the claim only takes a
 *    `scheduled` job (`CLAIMABLE_FROM`) while `sendBroadcastNow` accepts any
 *    status, so a `draft` job comes back `not-claimed` — `claim.ts`'s rule,
 *    pinned by a spec so nobody flips the switch unaware; (2) an OA with zero
 *    `chat_rooms` rows is skipped by `planRun` as `empty`, where
 *    `/message/broadcast` would still have fanned out to LINE's friend list.
 *
 * ⚠️ WAS "NOT WIRED" — CORRECTED 31/08. That line said `content.module.ts`
 *    neither provides this class nor registers the models it injects, so the
 *    port stayed `undefined` and the old sender ran. All three parts are false
 *    today: the module provides it (`content.module.ts:150`
 *    `{ provide: BroadcastNewSendPort, useClass: BroadcastNewSendService }`),
 *    registers the models, and `BROADCAST_NEW_PATH_ENABLED` is `true`
 *    (`new-path.switch.ts:40`). THIS PATH IS LIVE.
 *    คอมเมนต์ที่เคยจริงแล้วไม่ได้ตามแก้ อันตรายกว่าไม่เขียนเลย — คนอ่านจะประเมิน
 *    ความเสี่ยงจากเส้นที่คิดว่าไม่ทำงาน ทั้งที่มันวิ่งอยู่จริง.
 *
 * revert: delete this file and its line in `index.ts`.
 */
import { randomUUID } from 'node:crypto';

import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { CryptoService } from '@/infra/crypto';
import { LinePushDispatcher } from '@/infra/line';
import { FlexMessage, Hook } from '@/modules/hooks';
import {
  TranslationDictCacheService,
  WebhookLogWriter,
} from '@/modules/system';
/* [FEAT-20260903-BCASTSRFRESH] the EXISTING site-rules fetch pipe — the one the
   Refresh button and a customer's inbound message both walk. */
import { CustomToolService } from '@/modules/external';

/* [FEAT-20260903-BCASTSRFRESH] one fetch per OA, before anything is rendered */
import { refreshOaSiteRules } from '../broadcast-send';
import {
  buildAudienceFilter,
  /* [FEAT-20260824-BCASTTAGPRE] deletable as a folder — see its header */
  keysetSafeFilter,
  resolveAudiencePrefilter,
} from '../audience';
import {
  audienceFor,
  cellFor,
  endpointFor,
  hookIdsOf,
  idOf,
  outcomesFrom,
  payloadSummaryOf,
  refuse,
  textOf,
  who,
  type HookOutcome,
} from './new-send.helpers';
import { flexIdOf, resolveSavedCard } from './saved-card';
/* [FEAT-20260824-BCASTTRANSCRIPT] deletable as a folder — see its header */
import {
  writeCampaignTranscript,
  transcriptContentFrom,
} from '../broadcast-transcript';
/* [FEAT-20260825-BCASTSKIPASSIST] "ข้ามคนที่แอดมินกำลังคุยอยู่" — ทุกการตัดสินใจ
   อยู่ในโฟลเดอร์นั้น ที่นี่มีแค่การอ่านฐานข้อมูลตามรูปที่มันวางให้ */
import {
  shouldSkipAssisted,
  planAssistedLookup,
  assistedIdsFrom,
} from '../audience/skip-assist';
import {
  clearNoticeForReached,
  // [FEAT-20260825-BCASTDIRECTTICKET] เปิดเคสให้คนที่ได้รับ multicast (ถ้าติ๊กไว้)
  openDirectTicketsForReached,
  // [FEAT-20260825-MCASTABANDON] ติดธง follow-up ให้คนที่ได้รับ (ถ้าไม่ได้ติ๊กเปิดเคส)
  stampAbandonForReached,
} from '../broadcast-follow-up';
/* [FIX-20260824-BCASTREPEATRELEASE] the rule decides whether a job retires */
import { isRepeatRule, type BroadcastSchedule } from '../broadcast-schedule';
import {
  InlineChunkSink,
  MongoHookTokenReader,
  OA_VAR_COLUMNS,
  PagedRecipientVarSource,
  PersonalCardMessageBuilder,
  PlainCardMessageBuilder,
  buildOaVarMap,
  readFlexCardBody,
  toTranslateFn,
  type OaVarRow,
  manualTrigger,
  /* [FEAT-20260907-BCASTUNUSEDRULES] the run says out loud when its own pipe
     cannot use the conditions the job carries — see the policy file. */
  logsUnusedRules,
  type Clock,
  type SavedCard,
} from '../broadcast-send';
import { Broadcast } from '../schemas/broadcast.schema';
import { BroadcastHistory } from '../schemas/broadcast-history.schema';

import { buildRunPorts } from './mongo-ports.factory';
import { runBroadcast } from './run-broadcast';
import {
  BroadcastNewSendPort,
  type LegacySendResult,
  type NewSendOutcome,
} from './new-send.port';

/** See the header. Fixed, because no column selects a cell yet. */
/**
 * 🔴 STRING TOKENS FOR THESE TWO ONLY — a cycle, not laziness.
 * `chat/chat.module.ts:8` imports `@/modules/content`, so importing the chat
 * barrel from inside `content/` closes the loop and `chat.module` reads
 * `ImageStorage.name` off a half-initialised barrel at boot. The value is the
 * Mongoose model name (the class name), pinned by a spec that DOES import chat
 * — a spec is outside the cycle. โมดูล chat อ้าง content อยู่แล้ว ⇒ อ้างกลับไม่ได้.
 */
const MEMBER_MODEL = 'Member';
const CHAT_ROOM_MODEL = 'ChatRoom';
/* [FEAT-20260824-BCASTTRANSCRIPT] same string-token reason as the two above:
   importing the chat barrel from inside `content/` closes a module cycle. */
const CHAT_MESSAGE_MODEL = 'ChatMessage';
/* [FEAT-20260825-BCASTDIRECTTICKET] เหตุผลเดียวกับสามตัวข้างบนเป๊ะ:
   `tickets.module.ts` import `@/modules/content` อยู่ ⇒ import barrel ของ tickets
   กลับมาจากในนี้คือปิดวงจร · ค่าคือชื่อ Mongoose model (ชื่อคลาส) ที่
   `tickets.module.ts` ลงทะเบียนไว้ด้วย `forFeature` บน connection เดียวกัน */
const TICKET_MODEL = 'Ticket';
const ASSIGN_HISTORY_MODEL = 'AssignHistory';
/** The only clock in the folder, and it is a port. */
const CLOCK: Clock = { now: () => Date.now() };
/**
 * A plain card has no per-recipient tag, so there is nothing to substitute.
 * ⚠️ A tag written into one renders as `N/A` rather than riding out literally
 * as `{{...}}` — `substituteCard`'s rule, not one made here.
 */
const NO_VARS: Readonly<Record<string, string>> = {};

/**
 * [FIX-20260824-JOBIDHEX] id จาก Mongo → hex string · `''` เมื่อบอกไม่ได้
 *
 * ⚠️ ห้ามใช้ `String(x)` กับค่า `unknown` — object ธรรมดากลายเป็น
 *    `[object Object]` โดยไม่มีอะไรฟ้อง แล้วไปนอนอยู่ใน metadata ของแถวแชท
 */
function hexOf(id: unknown): string {
  if (typeof id === 'string') return id;
  if (id instanceof Types.ObjectId) return id.toHexString();
  return '';
}

@Injectable()
export class BroadcastNewSendService extends BroadcastNewSendPort {
  private readonly logger = new Logger(BroadcastNewSendService.name);

  constructor(
    /* Typed as the loose model these queries actually touch — the same choice
       `RunPortModels` documents, so nothing has to be asserted to fit. */
    @InjectModel(Broadcast.name)
    private readonly broadcastModel: Model<Record<string, unknown>>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<Record<string, unknown>>,
    /**
     * [FEAT-20260824-BCASTFLEXID] The card library this job points into.
     *
     * Injected rather than asked of the connection, because `ContentModule`
     * registers this model itself (`content.module.ts:80`) — there is no cycle
     * to dodge here, and DI failing loudly at boot beats a lookup that returns
     * `undefined` at send time.
     */
    @InjectModel(FlexMessage.name)
    private readonly flexModel: Model<Record<string, unknown>>,
    /**
     * 🔴 `members` AND `chat_rooms` COME FROM THE CONNECTION, NOT FROM DI.
     *
     * Registering them here would need `MemberSchema`/`ChatRoomSchema`, which
     * live behind `@/modules/chat` — and `chat.module.ts:8` already imports
     * `@/modules/content`. Importing back is a module cycle whose failure mode
     * is not a clear error but an `undefined` schema at boot, and the eslint
     * rule forbids reaching past a barrel to dodge it.
     *
     * The connection already holds every model any module registered, so this
     * asks it at CALL time — long after every module has booted. Resolving in
     * the constructor would make boot order decide whether the app starts.
     * ขอโมเดลตอนใช้ ไม่ใช่ตอน boot — ลำดับ boot จะได้ไม่กลายเป็นเงื่อนไขว่าแอปจะขึ้นไหม.
     */
    @InjectConnection()
    private readonly connection: Connection,
    @InjectModel(BroadcastHistory.name)
    private readonly historyModel: Model<Record<string, unknown>>,
    /* [FEAT-20260827-WLOGONEDOOR] was `@InjectModel(WebhookLog)` — this service
     * only writes the `send_broadcast` row. ContentModule already imports
     * SystemModule (content.module.ts:112), which exports this door. */
    private readonly wlog: WebhookLogWriter,
    private readonly crypto: CryptoService,
    /** The WRAPPER, never `LinePushService` — see `inline.sink.ts`'s header. */
    private readonly dispatcher: LinePushDispatcher,
    /**
     * [FEAT-20260823-BCASTOAVARS] The dictionary `site_rules.*` and
     * `profile.*` format their values through.
     *
     * `SystemModule` already exports it and `content.module.ts` already
     * imports that module — checked, not assumed — so this needs no new module
     * wiring. `buildBroadcastVars` takes the bound method, which is the shape
     * `TranslateFn` describes.
     */
    private readonly translate: TranslationDictCacheService,
    /**
     * [FEAT-20260903-BCASTSRFRESH] The pipe that fetches site rules — THE
     * EXISTING ONE, not a second copy.
     *
     * This is the same `getCombinedData` the panel's Refresh button walks
     * (`members.service.ts:785-790`) and the same one a customer's inbound
     * message walks. Owner, 03/09: *"ใช้ท่อเดิม"*. So the cache rule, the
     * single-flight, the WebhookLog row and the write of
     * `raw_site_rules_data` all keep their one owner, and this file gains no
     * knowledge of how a site-rules request is built.
     *
     * `ContentModule` imports `ExternalModule`, which exports this service —
     * and `external/` imports nothing from `content/`, so no cycle is closed
     * (checked with grep, not assumed).
     *
     * `@Optional()`: every unit spec constructs this service positionally, and
     * a required parameter would break each of them at compile time. Absent
     * ⇒ no OA is ever refreshed and every run reads the stored column exactly
     * as it did before today. ไม่มีตัวนี้ = พฤติกรรมเดิมเป๊ะ.
     */
    @Optional()
    private readonly customTools?: CustomToolService,
  ) {
    super();
  }

  /**
   * A model another module registered.
   *
   * ⚠️ Throws if nothing registered it — which is the RIGHT failure: a send
   * that cannot read `members` must stop loudly here, not walk on and report a
   * campaign that reached nobody. `send()` catches it and every hook comes back
   * as an error with the reason. อ่านตารางไม่ได้ = หยุดเสียงดัง ไม่ใช่ส่งไม่ถึงใครเงียบ ๆ.
   */
  private modelOf(name: string): Model<Record<string, unknown>> {
    return this.connection.model<Record<string, unknown>>(name);
  }

  /**
   * 🔴 NEVER THROWS. `sendBroadcastNow` awaits this and then writes the job's
   * status; a rejection there leaves the row saying `sending` with nobody
   * coming back for it. Every failure is an answer instead.
   */
  async send(
    broadcast: Record<string, unknown>,
    actor: { readonly id?: unknown; readonly name?: string },
  ): Promise<NewSendOutcome> {
    /* ⚠️ THE FIELD READS ARE INSIDE THE TRY: a lean document can carry getters,
       and a read that throws above it would be a rejection escaping a method
       whose whole contract is that it never rejects. Declared out here only so
       the catch and the log block still see what was read. */
    let rawHooks: unknown[] = [];
    let card: SavedCard | null = null;
    /* Read OUTSIDE the try: the webhook-log write below needs the endpoint even
       when the run itself threw, and a job whose kind cannot be read is exactly
       the job that took the old sender — so the fallback cell is right there
       too. อ่านนอก try เพราะ log ข้างล่างต้องใช้ ถึงจะพังก็ต้องรู้ว่ายิงไปทางไหน. */
    const cell = cellFor(broadcast['send_kind'], broadcast['card_type']);

    let outcomes: HookOutcome[];
    try {
      rawHooks = Array.isArray(broadcast['hook_ids'])
        ? broadcast['hook_ids']
        : [];
      /* [FEAT-20260824-BCASTFLEXID] The card comes from the library when the
         job names one. Inside the try on purpose: a lookup that throws is a
         failed send with a reason, not a rejection escaping this method. */
      card = await resolveSavedCard(broadcast['message'], (id) =>
        readFlexCardBody(this.flexModel, id),
      );
      if (card === null && flexIdOf(broadcast['message']) !== undefined) {
        /* 🔴 The id pointed at nothing. Refusing here rather than letting the
           builder produce an empty card: an admin who replaced a card expects
           the new one or an error — never silence.
           ชี้การ์ดที่หายไป = ไม่ส่ง ต้องบอกว่าทำไม. */
        throw new Error(
          'the flex card this broadcast points at no longer exists',
        );
      }
      outcomes = await this.run(broadcast, actor, rawHooks, card);
    } catch (e) {
      const why = e instanceof Error ? e.message : 'the new send path failed';
      this.logger.error(
        `new send failed: ${why} — ${who(broadcast['_id'], actor, broadcast['name'])}`,
      );
      outcomes = refuse(rawHooks, why);
    }

    /* Guarded: writing the history rows must never be the thing that fails a
       send that already happened. */
    try {
      await this.writeHookLogs(
        outcomes,
        endpointFor(cell),
        payloadSummaryOf(broadcast['_id'], card, cell.sendKind),
      );
    } catch (e) {
      this.logger.error(
        `webhook logs failed: ${e instanceof Error ? e.message : '?'} — ` +
          who(broadcast['_id'], actor, broadcast['name']),
      );
    }

    const results: LegacySendResult[] = outcomes.map((o) => ({
      hook_id: o.hookId,
      status: o.ok ? 'success' : 'error',
      ...(o.error ? { error: o.error } : {}),
    }));

    /* legacy `dispatchBroadcast`: an empty hook list is NOT all-success. */
    return {
      results,
      status:
        results.length > 0 && outcomes.every((o) => o.ok) ? 'sent' : 'failed',
    };
  }

  /** Assemble, run, translate. Everything that can refuse, refuses here. */
  private async run(
    broadcast: Record<string, unknown>,
    actor: { readonly id?: unknown; readonly name?: string },
    rawHooks: readonly unknown[],
    card: SavedCard | null,
  ): Promise<HookOutcome[]> {
    if (card === null) {
      return refuse(rawHooks, 'this broadcast has no message to send');
    }
    const cell = cellFor(broadcast['send_kind'], broadcast['card_type']);
    const hookIds = hookIdsOf(rawHooks);
    if (hookIds === null) {
      return refuse(rawHooks, 'a hook id on this broadcast cannot be read');
    }
    const audience = audienceFor(broadcast['target']);
    if (audience === null) {
      return refuse(
        rawHooks,
        'this broadcast targets groups and no group audience rule exists — ' +
          'refusing rather than reaching a wider list than intended',
      );
    }

    /**
     * [FEAT-20260907-BCASTUNUSEDRULES] SAY IT — the run is about to drop its own
     * audience conditions.
     *
     * 🔴 THE RUN IS NOT STOPPED. Owner decision 07/09: refusing would stop
     *    campaigns that are sending today. What was missing was not a gate, it
     *    was a RECORD — every such run has always answered status "success",
     *    and the only witness that told them apart was the LINE push counter.
     *
     * ⚠️ `warn`, not `log`. The line reports that the message reached everybody
     *    when the admin asked for a subset; at `log` level it would sit in the
     *    same stream as routine progress and be read by nobody.
     *
     * ⚠️ Placed AFTER `audienceFor` and BEFORE the prefilter, so it reports the
     *    rules the ADMIN set rather than the rewritten set the prefilter hands
     *    on. It also means a job refused above for a different reason never
     *    reaches this line — a refusal is not a wide send.
     */
    if (logsUnusedRules(cell, audience)) {
      this.logger.warn(
        `[BCASTUNUSEDRULES] ${String(audience.rules.length)} audience condition(s) ` +
          `are set but this send uses /message/broadcast, which carries no ` +
          `recipient list ⇒ LINE delivers to EVERY follower of ` +
          `${String(hookIds.length)} OA(s). The stored 'targeted' count ` +
          `describes the conditions, not the reach — ` +
          `${who(broadcast['_id'], actor, broadcast['name'])}`,
      );
    }
    /**
     * [FEAT-20260824-BCASTTAGPRE] Rules answered by another collection become
     * member ids HERE, before anything builds a filter. `audience/prefilter/`
     * owns every decision; these four lines are the whole wiring, and deleting
     * them plus that folder returns this file to what it was.
     *
     * 🔴 `pre.audience` — NOT `audience` — IS WHAT GOES ON, both to the builder
     *    below and to `runBroadcast`, which builds the filter a SECOND time
     *    (`run-broadcast.ts:195`) to cost the per-OA count. Two different rule
     *    sets would cost one audience and send to another.
     *    ⚠️ No tag rule ⇒ the SAME object back and no extra query, ever.
     */
    const pre = await resolveAudiencePrefilter(audience, {
      read: async (lookup) =>
        await this.modelOf(lookup.model)
          .find(lookup.filter)
          .select(lookup.projection)
          .lean()
          .exec(),
      /* The ceiling that already exists, not a new one (`run-plan.ts:163`). */
      maxMembers: cell.maxRecipientsPerOa,
    });
    if (!pre.ok) return refuse(rawHooks, pre.reason);

    /**
     * [FEAT-20260825-BCASTSKIPASSIST] ติ๊ก "ข้ามคนที่แอดมินกำลังคุยอยู่" ⇒ ถามห้อง
     *
     * 🔴 ต้องอยู่ **ก่อน** `buildAudienceFilter` และผลต้องติดไปกับตัว audience
     *    เพราะ object ตัวนี้ถูกเอาไปสร้างตัวกรองอีกครั้งใน `runBroadcast`
     *    (เพื่อคิดจำนวนผู้รับต่อ OA) ⇒ ถ้าติดไว้ที่อื่น จะกลายเป็น "นับได้อย่าง
     *    ส่งจริงอีกอย่าง" ซึ่งเป็นความพังที่เงียบที่สุดของระบบนี้
     * 🔴 อ่านพลาด = **ปฏิเสธ ไม่ใช่ส่งต่อ** · กฎเดียวกับทั้งระบบเลือกผู้รับ:
     *    เงื่อนไขที่หายไปทำให้รายชื่อ**กว้างกว่า**ที่สั่ง ซึ่งแย่กว่าไม่ได้ส่ง
     *    (`prefilter.types.ts` — "ข้ามเงื่อนไข = ยิงกว้างกว่าที่สั่ง")
     * ⚠️ ทุกการตัดสินใจอยู่ใน `audience/skip-assist/` — ที่นี่มีแค่การอ่าน
     */
    let sendAudience = pre.audience;
    if (shouldSkipAssisted(broadcast)) {
      const lookup = planAssistedLookup(hookIds.map((h) => String(h)));
      if (lookup !== null) {
        let rows: readonly unknown[];
        try {
          rows = await this.modelOf(lookup.model)
            .find(lookup.filter)
            .select(lookup.projection)
            .lean()
            .exec();
        } catch (e) {
          return refuse(
            rawHooks,
            'could not read which chats an admin is handling, and this ' +
              'campaign asked to skip them — refusing rather than sending to ' +
              `a wider list than intended: ${
                e instanceof Error ? e.message : 'unknown error'
              }`,
          );
        }
        const skip = assistedIdsFrom(rows, lookup.field);
        if (skip.length > 0) {
          sendAudience = { ...pre.audience, skip_line_user_ids: skip };
        }
        /* 🔴 บอกเสมอ แม้ข้าม 0 คน — เจ้าของสั่งว่า *"ต้องรู้ว่า skip หรือไม่"*
           ถ้า log เฉพาะตอนมีคนถูกข้าม "ไม่มีบรรทัด" จะแปลได้สองอย่าง คือ
           ไม่ได้ติ๊ก กับ ติ๊กแล้วแต่ไม่มีใครเข้าข่าย ซึ่งต่างกันมากตอนไล่ปัญหา
           ⇒ มีบรรทัด = ฟีเจอร์ทำงานจริงในรอบนี้ · ตัวเลขบอกว่ากี่คน */
        this.logger.log(
          `[BCASTSKIPASSIST] ติ๊กไว้ ⇒ ข้าม ${skip.length} คนที่แอดมินกำลังดูแลอยู่ ` +
            `(OA ${lookup.filter['hook_id'] ? hookIds.length : 0} ตัว)`,
        );
      }
    }

    /* [FEAT-2708-GUARDWINDOW] the job's freshness window rides the audience
       object for the same reason `skip_line_user_ids` does: the filter is
       built twice per round (pager here, per-OA count in `run-broadcast.ts`)
       and both must see the SAME reference instant — created once, right
       here, per round. A repeat job gets each round's own start time, which
       is the owner's "N ชม. ย้อนจากเวลาเริ่มรอบส่ง". Absent column ⇒ nothing
       is attached and the query is the old one, byte for byte. Validation
       lives in the policy (fail closed inside buildAudienceFilter). */
    const guardHours = broadcast['guard_window_hours'];
    if (guardHours !== undefined && guardHours !== null) {
      sendAudience = {
        ...sendAudience,
        guard_window: { hours: guardHours, reference: new Date() },
      };
    }

    /* Built HERE as well as inside `runBroadcast`, because the pager is
       constructed with it: one filter, two readers, never two filters. */
    const built = buildAudienceFilter(sendAudience);
    if (!built.ok) return refuse(rawHooks, built.reason);
    /* 🔴 NOT COSMETIC — see `keyset-safe-filter.ts`. A top-level `_id` (only a
       pre-resolved rule makes one) is ERASED by the pager's cursor from page 2
       on, and the campaign walks the whole collection. Identity for every
       filter without `_id`, i.e. every campaign that exists today. */
    const audienceFilter = keysetSafeFilter(built.filter);

    const runId = randomUUID();
    const jobId = broadcast['_id'];
    const decrypt = (value: string): string =>
      this.crypto.safeDecrypt(value) ?? '';

    /**
     * [FEAT-20260823-BCASTOAVARS] The values this job's OAs can fill in.
     *
     * 🔴 READ HERE, BEFORE THE JOB IS CLAIMED. The builder renders in its
     * constructor so an unrenderable card fails before anything is claimed;
     * reading these rows later would put a database round-trip inside the run
     * and move that failure with it.
     *
     * ⚠️ ONE `$in`, ONLY the columns `OA_VAR_COLUMNS` names. A job has a
     *    handful of OAs, so this is one small read — not per chunk, not per
     *    recipient.
     *
     * A read that throws costs the VALUES, not the campaign: the card still
     * renders with `N/A` where the OA's values would have gone, which is what
     * every broadcast did before this existed. ล้มตรงนี้ = ไม่มีค่า ไม่ใช่ไม่ส่ง.
     */
    let oaVars: Record<string, Readonly<Record<string, string>>> = {};
    /* Kept beyond the block below: a PERSONAL card needs the OA's own row and
       site rules per recipient, and re-reading them per page would undo the
       point of reading them once. เก็บแถวไว้ใช้ต่อ ไม่อ่านซ้ำ. */
    let hookRows: OaVarRow[] = [];
    /**
     * [FEAT-20260903-BCASTSRFRESH] Filled by the refresh below. Both stay
     * `undefined` when nothing was measured — and `undefined` means "as
     * before" to every reader downstream, never "measured, and the answer was
     * none". ไม่ได้วัด กับ วัดแล้วไม่มี ต้องแยกกันให้ออก.
     */
    let blockedByOa: boolean[] | undefined;
    let siteRulesAgeDaysByHook: Record<string, number> | undefined;
    try {
      const rows = (await this.hookModel
        .find({ _id: { $in: hookIds } })
        .select(OA_VAR_COLUMNS)
        .lean()
        .exec()) as unknown as OaVarRow[];

      /**
       * [FEAT-20260903-BCASTSRFRESH] Site rules, made current BEFORE the card
       * is rendered from them.
       *
       * Owner, 03/09: the send round should carry fresh site rules — fetch when
       * there are none stored, and when what is stored is older than ten
       * minutes. This is where that happens, once per OA, on the existing
       * fetch pipe. See `adapters/site-rules-refresh.reader.ts` for the cost
       * argument and `checks/site-rules-freshness.ts` for the rule itself
       * (including which older instruction it supersedes, and when).
       */
      const refreshed = await refreshOaSiteRules(rows, card, {
        fetchForHook: async (hookId) => {
          /* No `CustomToolService` ⇒ no fetch, and the stored blob is used.
             The unit specs construct this service without it on purpose. */
          if (!this.customTools) return;
          const hook = await this.hookModel.findById(hookId).lean().exec();
          if (!hook) return;
          /**
           * ⚠️ ONE CAST, AT THE SEAM, AND IT IS ABOUT TYPES NOT ABOUT FACTS.
           *
           * `hookModel` here is deliberately `Model<Record<string, unknown>>`
           * (see the constructor: the loose model these queries actually
           * touch), so its `_id` is `unknown` while `getCombinedData` wants a
           * hook-shaped row. The ROW is a real `hooks` document either way —
           * the same collection `members.service.ts:783` reads for the same
           * call — so this narrows a type, it does not assert a fact about
           * the data. Nothing downstream reads a field this file invented.
           */
          const hookDoc = hook as unknown as Parameters<
            CustomToolService['getCombinedData']
          >[1];
          /* Empty user id is correct here: site rules are per HOOK, and the
             identity only shapes per-member endpoints, which this call is not
             here for — the same reasoning `members.service.ts:783-790` states
             for the Refresh button, on the same call. `logSource` matters, or
             every row this writes is stamped `webhook_prefetch` and an
             operator cannot tell a campaign from a customer's message. */
          await this.customTools.getCombinedData('', hookDoc, {
            logSource: 'broadcast_site_rules_refresh',
          });
        },
        /* No cast: the loose model already returns `Record<string, unknown>`
           rows, which is exactly what the port asks for. An `as` here would be
           a cast that changes nothing and hides the day the shapes diverge. */
        rereadSiteRules: async (ids) =>
          await this.hookModel
            .find({ _id: { $in: [...ids] } })
            .select({
              _id: 1,
              raw_site_rules_data: 1,
              site_rules_updated_at: 1,
            })
            .lean()
            .exec(),
        now: () => new Date(),
      });

      hookRows = [...refreshed.rows];
      oaVars = {
        ...buildOaVarMap(
          hookRows,
          toTranslateFn(this.translate.translate.bind(this.translate)),
        ),
      };

      /**
       * 🔴 ALIGNED BY HOOK ID, NOT BY POSITION. `find({ _id: { $in } })` makes
       * NO promise about order, and `blockedByOa` is read by INDEX against
       * `hookIds` — so trusting the row order would block the wrong OA, which
       * is a campaign silently not reaching one channel while another it never
       * judged goes out. A hook with no row at all is not blocked: that is a
       * different failure the send path reports with its own error.
       * `$in` ไม่รับประกันลำดับ — ต้องจับคู่ด้วย id เท่านั้น.
       */
      const blockedById = new Map<string, boolean>();
      refreshed.rows.forEach((row, i) => {
        blockedById.set(String(row._id), refreshed.blocked[i] === true);
      });
      blockedByOa = hookIds.map((id) => blockedById.get(String(id)) === true);
      siteRulesAgeDaysByHook = Object.fromEntries(refreshed.ageDaysByHook);

      if (refreshed.fetched.length > 0) {
        this.logger.log(
          `[BCASTSRFRESH] site rules refetched for ${String(refreshed.fetched.length)} OA(s) ` +
            `before sending — ${who(jobId, actor, broadcast['name'])}`,
        );
      }
      const blockedCount = blockedByOa.filter(Boolean).length;
      if (blockedCount > 0) {
        this.logger.warn(
          `[BCASTSRFRESH] ${String(blockedCount)} OA(s) skipped: the card fills ` +
            `{{site_rules.*}} and no site rules could be obtained — ` +
            `${who(jobId, actor, broadcast['name'])}`,
        );
      }
    } catch (e) {
      const why = e instanceof Error ? e.message : 'unknown error';
      this.logger.warn(
        `OA variables unavailable (${why}) — the card will render N/A where ` +
          `they would have gone — ${who(jobId, actor, broadcast['name'])}`,
      );
    }

    /* ⚠️ Its OWN token reader, not the one `buildRunPorts` hands back: the sink
       must exist BEFORE the ports are built. Same class, same two seams — and
       it is the SINK that holds a token, never the runner. */
    const tokens = new MongoHookTokenReader({
      findHook: async (hookId) => {
        const row = await this.hookModel
          .findById(hookId)
          .select({ access_token: 1, line_key: 1 })
          .lean()
          .exec();
        return row === null
          ? null
          : { access_token: row['access_token'], line_key: row['line_key'] };
      },
      safeDecrypt: decrypt,
    });

    /**
     * [FEAT-20260823-BCASTCARDTYPE] One source per OA, refilled page by page.
     *
     * 🔴 BUILT ONLY FOR A PERSONAL CARD. A plain run creates none of this and
     *    reads nothing extra — the whole point of the `cardType` branch.
     *
     * The map is keyed by OA because `hook_*` / `site_rules.*` differ per OA
     * and a run may touch several. เก็บทีละ OA เพราะค่าไม่เหมือนกัน.
     */
    const personalSources = new Map<string, PagedRecipientVarSource>();
    const translateFn = toTranslateFn(
      this.translate.translate.bind(this.translate),
    );
    if (cell.cardType === 'personal') {
      const memberModel = this.modelOf(MEMBER_MODEL);
      for (const row of hookRows) {
        personalSources.set(
          String(row._id),
          new PagedRecipientVarSource({
            reader: {
              /* ONE `$in` per page. `line_user_id` is the real column
                 (`chat/schemas/member.schema.ts:27`), read not remembered. */
              findMembersByLineIds: async (ids, columns) =>
                await memberModel
                  .find({ line_user_id: { $in: [...ids] } })
                  .select(columns)
                  .lean()
                  .exec(),
            },
            translate: translateFn,
            hook: row,
            storedSiteRules: row['raw_site_rules_data'],
          }),
        );
      }
    }

    /**
     * The builder reads whichever OA the sink is currently sending to. The
     * sink hands `hookId` to `messagesFor`, and `PersonalCardMessageBuilder`
     * passes it straight through to this lookup.
     */
    const personalVars = {
      varsFor: (lineUserId: string, hookId?: string) =>
        hookId === undefined
          ? null
          : (personalSources.get(hookId)?.varsFor(lineUserId) ?? null),
    };

    /**
     * [FEAT-20260824-BCASTTRANSCRIPT] Who the run actually reached, per OA.
     *
     * Filled by the sink DURING the send — an array push per chunk, no I/O on
     * the hot path — and read once afterwards to copy the campaign into those
     * customers' chats. Declared out here so the database work happens OUTSIDE
     * the send loop. เก็บระหว่างส่ง เขียนทีเดียวตอนจบ.
     */
    const reachedByHook = new Map<string, string[]>();
    /**
     * [FIX-20260828-TRANSCRIPTVARS] ตัวสร้างข้อความถูกยกออกมาเป็นตัวแปร
     *
     * 🔴 เดิมถูกสร้าง **inline** อยู่ในวงเล็บของ `InlineChunkSink` ⇒ ไม่มีใครถือมันไว้
     *    พอถึงตอนเขียนสำเนาเข้าห้องแชท จึงไม่มีทางถามว่า "OA นี้ได้ข้อความหน้าตายังไง"
     *    แล้วโค้ดก็ไปอ่าน `card.text` ซึ่งเป็น **การ์ดต้นฉบับที่ยังไม่แทนค่า**
     *    ⇒ ลูกค้าใน LINE ได้ข้อความที่แทนค่าแล้ว แต่ห้องแชทเก็บ `_x` ดิบไว้
     * ⚠️ ตัวเดียวกันเป๊ะ ไม่ได้สร้างเพิ่ม — แค่ถือไว้ก่อนส่งเข้า sink
     *    ⇒ เส้นส่งได้ instance เดิม ค่าเดิม ลำดับเดิม ไม่มีอะไรเปลี่ยน
     */
    const messageBuilder =
      cell.cardType === 'personal'
        ? new PersonalCardMessageBuilder(
            card,
            personalVars,
            broadcast['title_detail'],
          )
        : new PlainCardMessageBuilder(
            card,
            NO_VARS,
            broadcast['title_detail'],
            oaVars,
          );

    const delivered = {
      delivered: (hookId: string | undefined, ids: readonly string[]) => {
        const key = String(hookId ?? '');
        const bucket = reachedByHook.get(key);
        if (bucket) bucket.push(...ids);
        else reachedByHook.set(key, [...ids]);
      },
    };

    const ports = buildRunPorts(
      {
        broadcastModel: this.broadcastModel,
        hookModel: this.hookModel,
        memberModel: this.modelOf(MEMBER_MODEL),
        chatRoomModel: this.modelOf(CHAT_ROOM_MODEL),
        historyModel: this.historyModel,
        safeDecrypt: decrypt,
        // `members._id` is an ObjectId; a string cursor never moves. (pager)
        toCursor: (id) => new Types.ObjectId(id),
      },
      {
        sink: new InlineChunkSink(
          this.dispatcher,
          tokens,
          /* [FEAT-20260823-BCASTTITLE] `title_detail` comes off the JOB, not
             off the card — `savedCardOf` reads only the four message fields —
             so it is passed alongside. Invalid or absent falls back to
             `line messages` inside the builder, and the reason comes back on
             the result so an admin can be told. */
          messageBuilder,
          cell,
          /* [FEAT-20260824-BCASTTRANSCRIPT] Remember who each chunk reached, so
               the campaign can be copied into those customers' chats after the
               run. An array push per chunk — no I/O on the send loop. */
          delivered,
        ),
        clock: CLOCK,
        /* [FEAT-20260823-BCASTCARDTYPE] Only a personal card gets a prefetch —
           a plain run passes `undefined` and no extra query is ever made. */
        ...(cell.cardType === 'personal'
          ? {
              prefetchRecipients: async (
                hookId: string,
                ids: readonly string[],
              ) => {
                await personalSources.get(hookId)?.prefetch(ids);
              },
            }
          : {}),
        audienceFilter,
        jobId,
        // The RAW value: `countRunsOfUser` matches it against a stored id.
        userId: actor.id,
      },
    );

    /**
     * [FIX-20260828-HISTALIAS] ชื่อ OA ของแถวประวัติ — สายที่ประกาศไว้แต่ไม่เคยต่อ
     *
     * 🔴 อาการที่เจ้าของแจ้ง 28/08: หน้าตารางประวัติรอบส่ง คอลัมน์ ALIAS **ว่าง**
     *    เฉพาะบางงาน · ต้นเหตุ: `history-row.ts:84` อ่านชื่อจาก
     *    `input.hookAliases?.[hookId]` และ **ไม่มีใครส่งค่านี้เข้ามาเลย** ⇒
     *    `aliasFor` คืน undefined เสมอ ⇒ `hook_alias` ถูกละไว้ทั้งแถว
     *    (ตัวเขียนใส่แบบมีเงื่อนไข: ไม่มีชื่อ = ไม่เขียน field) แล้ว
     *    `history-read.ts:136` อ่านไม่เจอจึงตอบ `''` ให้หน้าจอ
     *    ⇒ งานที่ยิงด้วย **sender ใหม่** ALIAS ว่างทุกแถว ส่วนงานเก่าที่ยิงด้วย
     *      `broadcast-legacy-send.util.ts:151` (เขียน `hook_alias` ตรง ๆ) มีชื่อ
     *      — จึงเห็นเป็น "บางงานหาย บางงานมี" ตามภาพที่ส่งมา
     *    ⚠️ รูปแบบเดียวกับ `repeating` ที่บล็อกข้างล่างบันทึกไว้: ประกาศครบ อ่านครบ
     *       ขาดแค่คนต่อ — ของแบบนี้เทสไม่จับ เพราะไม่มีใครพัง มีแต่ "ไม่มีค่า"
     *
     * 🔴 ไม่ได้อ่านชื่อจาก `broadcast` — อ่านจาก `hooks` แถวจริงเสมอ
     *    ชื่อที่ผู้ใช้เห็นในตารางต้องเป็นชื่อ OA ตอนที่รอบนั้นเกิดขึ้น ไม่ใช่ค่าที่
     *    ใครสักคนก๊อปติดมากับ campaign
     * ⚠️ คีย์ของแมปต้องเป็น **สตริงเดียวกับ `hookIds`** ที่ส่งเข้า `runBroadcast`
     *    (`aliasFor` ค้นด้วย `oa.hookId` ซึ่งมาจากรายการเดียวกันนี้) — คีย์เป็น
     *    ObjectId เมื่อไหร่ ค้นไม่เจอและกลับไปว่างเงียบ ๆ เหมือนเดิม
     *    (กับดัก ObjectId ตัวเดียวกับ [FIX-20260828-ALIASOBJECTID] ด้านล่าง)
     * ⚠️ อ่านไม่ได้ = ไม่มีชื่อ ไม่ใช่ throw · หนึ่ง query ต่อรอบ ไม่ใช่ต่อ OA
     * revert: ลบสองบรรทัดนี้ + `hookAliases` ที่ส่งเข้า `runBroadcast` — ALIAS ว่างเหมือนเดิม
     */
    const hookAliases = await this.readHookAliases(hookIds);

    const report = await runBroadcast(
      {
        jobId,
        ...(Object.keys(hookAliases).length > 0 ? { hookAliases } : {}),
        /* ⚠️ The PROCESS holding the claim, not the admin — the release filters
           on it, so two runs must never share one. The run id makes it unique
           per run, stricter than per process, and costs nothing. */
        ownerId: `bcast-${process.pid}-${runId}`,
        trigger: manualTrigger(runId, idOf(actor.id) ?? undefined, actor.name),
        cell,
        hookIds,
        /* The PRE-RESOLVED rules — see the block at the pre-step above. */
        /* [FEAT-20260825-BCASTSKIPASSIST] `sendAudience` ไม่ใช่ `pre.audience` —
           ตัวนี้คือตัวที่ถือรายชื่อ "ข้าม" อยู่ · ส่งตัวเก่ามาที่นี่เมื่อไหร่
           จำนวนผู้รับต่อ OA จะถูกคิดจากรายชื่อที่กว้างกว่าที่ส่งจริง */
        audience: sendAudience,
        /* [FEAT-20260903-BCASTSRFRESH] OAs the pre-run refresh ruled out, by
           the same index as `hookIds`. Absent ⇒ nothing is blocked, which is
           what every run did before today. */
        ...(blockedByOa ? { blockedByOa } : {}),
        /* [FEAT-20260903-BCASTSRAGE] the producer this column never had. */
        ...(siteRulesAgeDaysByHook &&
        Object.keys(siteRulesAgeDaysByHook).length > 0
          ? { siteRulesAgeDaysByHook }
          : {}),
        broadcastName: textOf(broadcast['name']),
        /**
         * [FIX-20260824-BCASTREPEATRELEASE] 🔴 THE LAST LINK, NEVER CONNECTED.
         *
         * `BroadcastRunInput.repeating` has been declared since the run ports
         * were written (`run-ports.ts:146`) and NOTHING ever set it — so
         * `releaseStatusFor` always saw `repeating: false` and retired a
         * successful repeat as `sent`. The due-scan filters on
         * `status: 'scheduled'`, so from that moment the job was invisible:
         * `next_run_at` could be armed perfectly and still never be read.
         * Measured 24/08 — round 3 armed `next_run_at = 15:00` and sat at
         * `status: sent`. ประกาศไว้แต่ไม่มีใครต่อ — รูปแบบเดียวกับ next_run_at เป๊ะ.
         *
         * ⚠️ It asks the RULE, not the run: a job repeats because its schedule
         * says so, never because a round happened to succeed. `isRepeatRule`
         * reads `=== 'repeat'`, so a job with no schedule — every campaign that
         * predates this — answers `false` and still retires as `sent`, exactly
         * as it does today. ไม่มี schedule = จบเหมือนเดิม ไม่กระทบใคร.
         */
        /**
         * [FEAT-20260824-RUNSNAPSHOT] What this campaign was set to, frozen.
         *
         * Owner, 24/08: *"ประวัติต้องบอกว่า board หรือ multi พร้อมบอก job detail
         * ที่รัน เงื่อนไขทั้งหมด ว่าตอนนั้น job ตั้งอะไรไว้"*.
         *
         * 🔴 TAKEN FROM THE DOCUMENT ALREADY IN HAND, before the send starts —
         *    no extra query, and no chance of catching an edit made while the
         *    round was still running.
         *
         * ⚠️ `send_kind` and `card_type` are deliberately NOT copied: they have
         *    their own columns on the history row. Two answers to one question
         *    is a trap — the day they disagree nobody knows which is true.
         *    มีคอลัมน์ของตัวเองแล้ว ห้ามเก็บซ้ำ.
         */
        settingsSnapshot: {
          target: broadcast['target'],
          schedule: broadcast['schedule'],
          message_flex_id: flexIdOf(broadcast['message']),
          hook_ids: hookIds,
        },
        repeating: isRepeatRule(
          broadcast['schedule'] as BroadcastSchedule | null | undefined,
        ),
      },
      ports,
    );

    /**
     * [FEAT-20260824-BCASTTRANSCRIPT] Copy the campaign into the customers' chats.
     *
     * 🔴 AFTER THE RUN, NEVER INSIDE IT. `reachedByHook` was filled by an array
     *    push per chunk; every database round trip happens here, once, so the
     *    send loop is untouched. เก็บระหว่างส่ง เขียนทีเดียวตอนจบ.
     *
     * 🔴 ONE `$in` PER OA, and only for OAs that actually received something.
     *    The rooms are looked up rather than carried through the send, because
     *    widening the pager's port to hand back room ids would change a contract
     *    the chunking and resume logic depend on — a permanent cost for a
     *    feature that must stay deletable.
     *    ไม่ขยาย port ของ pager เพราะจะกลายเป็นหนี้ถาวรของฟีเจอร์ที่ต้องถอดได้.
     *
     * 🔴 MULTICAST ONLY. A `/message/broadcast` send has no recipient list at
     *    all, so `reachedByHook` is empty for it and this loop does nothing —
     *    the pipe for that day exists in `campaign-tag.ts`, unused on purpose.
     *
     * ⚠️ GUARDED AND NEVER AWAITED INTO THE RESULT. The messages are already on
     *    people's phones; a failed copy must not turn a successful campaign into
     *    a failed one. It is logged, and the send stands.
     */
    if (reachedByHook.size > 0) {
      try {
        const chatRooms = this.modelOf(CHAT_ROOM_MODEL);
        const chatMessages = this.modelOf(CHAT_MESSAGE_MODEL);
        for (const [hookId, lineIds] of reachedByHook) {
          if (lineIds.length === 0) continue;
          /* [FIX-20260831-PERSONALCOPY] try PER OA. One try used to wrap the
             whole loop, so a thrown `chat_rooms.find()` on OA #1 silently cost
             every LATER OA its copy too. One OA's bad read now costs that OA
             alone; the outer catch still guards everything around the loop. */
          try {
            /* `line_user_id` in the select is [FIX-20260831-PERSONALCOPY]: the
             per-person copy below is keyed by it. Plain mode ignores it. */
            const rooms = (await chatRooms
              .find({ hook_id: hookId, line_user_id: { $in: lineIds } })
              .select({ _id: 1, hook_id: 1, line_user_id: 1 })
              .lean()
              .exec()) as unknown as Array<{
              _id: unknown;
              hook_id: unknown;
              line_user_id?: unknown;
            }>;
            /**
             * [FIX-20260828-TRANSCRIPTVARS] สำเนาต้องเป็น **ข้อความที่ส่งจริง**
             *
             * 🔴 เจ้าของแจ้ง 28/08: multicast ที่ใช้แท็ก profile/site (`_x`) ปลายทาง
             *    ใน LINE ได้ข้อความที่แทนค่าแล้วถูกต้อง แต่ห้องแชทเก็บ **ตัวต้นฉบับ**
             *    ที่ยังมีแท็กดิบ · ต้นเหตุ: บล็อกนี้อ่าน `card` (การ์ดที่เซฟไว้) ส่วน
             *    ตัวส่งอ่านจาก builder ที่แทนค่าต่อ OA ไว้แล้ว — สองที่อ่านคนละแหล่ง
             * ⇒ ถามการ์ดของ OA นี้จาก builder ตัวเดียวกับที่ใช้ส่งจริง
             *
             * [FIX-20260831-PERSONALCOPY] โหมด `personal` แทนค่า **ต่อคน** จึงไม่มี
             * คำตอบเดียวสำหรับทั้ง OA — รอบแรก (28/08) จึงปล่อยให้ตกกลับไปใช้การ์ด
             * ดิบทั้ง OA โดยอ้างว่า "ไม่มีแคมเปญไหนใช้โหมดนี้" ซึ่ง**หมดอายุแล้ว**:
             * 30/08 งาน personal รันจริงบน stg และห้องแชทเก็บ `{{profile.*}}` ดิบ
             * ⇒ ตอนนี้ builder เก็บผลรายคนไว้ตอน render (`sentPayloadFor`) และ
             *   target แต่ละห้องถือสำเนาของตัวเอง — ห้องของใคร ค่าของคนนั้น
             * ⚠️ คนที่ builder ไม่มีคำตอบ (chunk ล้ม/ถูกปฏิเสธ) ⇒ ห้องนั้นตกกลับไป
             *   ใช้การ์ดเดิม ไม่ใช่เขียนว่าง — ข้อความที่ยังไม่แทนค่า ยังอ่าน
             *   รู้เรื่องกว่าห้องแชทที่ว่างเปล่า
             */
            const isPersonal =
              messageBuilder instanceof PersonalCardMessageBuilder;
            const sentPayload =
              messageBuilder instanceof PlainCardMessageBuilder
                ? messageBuilder.resultFor(String(hookId))?.messages?.[0]
                : undefined;
            const copy = transcriptContentFrom(
              sentPayload,
              card,
              textOf(broadcast['name']),
            );

            await writeCampaignTranscript(chatMessages, {
              kind: 'multicast',
              /* [FIX-20260824-JOBIDHEX] `jobId` เป็น `unknown` จาก Mongo ⇒ `String()`
               ตรง ๆ ได้ `[object Object]` เงียบ ๆ ทันทีที่มันไม่ใช่ ObjectId
               (แถวจริงตอนนี้ถูกอยู่ แต่ type ไม่ได้การันตี) `hexOf` คืน `''`
               เมื่อบอกไม่ได้ แล้ว `campaignTag()` จะตัดคีย์ทิ้งให้
               ⇒ ไม่มี job_id ดีกว่ามี job_id ขยะในประวัติแชทที่ลบไม่ได้ */
              jobId: hexOf(jobId),
              jobName: textOf(broadcast['name']),
              runId,
              /* ⚠️ ชนิดยังมาจากการ์ดที่เซฟไว้ ไม่ใช่จาก payload — ชนิดไม่มีทางเปลี่ยน
               ระหว่างแทนค่า และ `chat_messages.message_type` เป็นคำศัพท์ของฝั่งแชท
               (`text`/`image`/`flex`) ไม่ใช่ของ LINE */
              messageType: String(card.type ?? 'text'),
              /* 🔴 A STRING, ALWAYS — the chat view calls `.includes()` on it and
               an object crashes the whole conversation view. A flex row carries
               a label here and the card in `flexJson` below, which is exactly
               what every real flex row in `chat_messages` looks like.
               content ต้องเป็น string เสมอ · การ์ดไปอยู่ metadata.flex_json. */
              content: copy.content,
              ...(copy.flexJson !== undefined
                ? { flexJson: copy.flexJson }
                : {}),
              targets: rooms.map((r) => {
                const base = { roomId: r._id, hookId: r.hook_id ?? hookId };
                if (!isPersonal) return base;
                /* [FIX-20260831-PERSONALCOPY] this room's OWN card — looked up by
                 the recipient the room belongs to, from the very render that
                 was sent. No hit ⇒ the blob fallback above (the saved card). */
                const sent = messageBuilder.sentPayloadFor(
                  String(r.line_user_id ?? ''),
                  String(hookId),
                );
                if (sent === undefined) return base;
                const own = transcriptContentFrom(
                  sent,
                  card,
                  textOf(broadcast['name']),
                );
                return {
                  ...base,
                  content: own.content,
                  ...(own.flexJson !== undefined
                    ? { flexJson: own.flexJson }
                    : {}),
                };
              }),
            });
          } catch (oaErr) {
            this.logger.warn(
              `broadcast transcript copy failed for hook ${String(hookId)} (other OAs continue): ${
                oaErr instanceof Error ? oaErr.message : String(oaErr)
              }`,
            );
          }
        }
      } catch (e) {
        this.logger.warn(
          `broadcast transcript copy failed (the send itself is unaffected): ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }

      /**
       * [FEAT-20260824-BCASTCLEARNOTICE] เราบอกเขาแล้วว่าแบงค์ปกติ ⇒ ลบป้าย
       * "เคยแจ้งว่าแบงค์มีปัญหา" ของคนที่ได้รับจริง
       *
       * เจ้าของ 24/08: *"ถ้ามันติดค่า notice มาเพราะแบงค์มีปัญหาใหม่ไง …
       * เราจะยิงช่วยที่แบงค์ปกติไง … เพราะมันเคลียร์ค่านะถูกแล้ว"*
       *
       * 🔴 บล็อกของตัวเอง แยก try จาก transcript ข้างบน — สองอย่างนี้ล้มเหลว
       *    อิสระจากกัน สำเนาแชทเขียนไม่ได้ ไม่ควรทำให้ป้ายค้าง และกลับกัน
       * 🔴 ใช้ `reachedByHook` ตัวเดียวกับ transcript ⇒ คนที่ยิงไม่ผ่านยังไม่รู้ว่า
       *    แบงค์ปกติแล้ว ป้ายของเขาต้องอยู่ต่อ ยิงไม่ถึง = ยังไม่ได้บอก
       * ⚠️ ไม่โยนออกไปข้างนอก — ข้อความอยู่บนมือถือลูกค้าแล้ว
       *    ดูเหตุผลเต็มที่ `broadcast-follow-up/clear-notice-on-multicast.ts`
       */
      try {
        const reachedIds = [...reachedByHook.values()].flat();
        const cleared = await clearNoticeForReached(
          this.modelOf(MEMBER_MODEL),
          { lineUserIds: reachedIds },
        );
        if (cleared.failed) {
          this.logger.warn(
            'broadcast notice-stamp clear failed for at least one key (the send itself is unaffected)',
          );
        }
      } catch (e) {
        this.logger.warn(
          `broadcast notice-stamp clear failed (the send itself is unaffected): ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }

      /**
       * [FEAT-20260825-BCASTDIRECTTICKET] ติ๊กไว้ ⇒ เปิดเคสรอให้คนที่ได้รับจริง
       *
       * 🔴 บล็อกของตัวเอง แยก try จากสองอย่างข้างบน — สำเนาแชท ป้าย notice และ
       *    เคส ล้มเหลวอิสระจากกัน อันหนึ่งพังต้องไม่ลากอีกสองอันลงไปด้วย
       * 🔴 ใช้ `reachedByHook` ตัวเดียวกับอีกสองอัน ⇒ คนที่ยิงไม่ผ่านไม่ถูกเปิดเคส
       *    เปิดเคสเรื่องที่ลูกค้ายังไม่เคยเห็น = แอดมินไปคุยแล้วลูกค้างง
       * ⚠️ ไม่โยนออกไป — ข้อความอยู่บนมือถือลูกค้าแล้ว เปิดเคสพลาดต้องไม่ทำให้
       *    แคมเปญที่สำเร็จกลายเป็นล้มเหลว
       * ⚠️ `skipped` = ลูกค้ามีเคสเปิดอยู่แล้ว ซึ่งเป็น**ผลลัพธ์ปกติ** ไม่ใช่ error
       *    (ตัวกันเคสซ้ำของประตูกลางทำงานถูกต้อง) จึงไม่ warn
       * เหตุผลเต็ม + วิธีเปลี่ยนใจทีหลัง:
       * `broadcast-follow-up/open-direct-ticket-on-multicast.ts`
       */
      try {
        const ticketed = await openDirectTicketsForReached(
          broadcast,
          reachedByHook,
          {
            ticketModel: this.modelOf(TICKET_MODEL),
            chatRoomModel: this.modelOf(CHAT_ROOM_MODEL),
            chatMessageModel: this.modelOf(CHAT_MESSAGE_MODEL),
            assignHistoryModel: this.modelOf(ASSIGN_HISTORY_MODEL),
            warn: (m: string) => this.logger.warn(m),
          },
        );
        if (ticketed.opened || ticketed.skipped || ticketed.failed) {
          this.logger.log(
            `[BCASTDIRECTTICKET] เปิดเคส ${ticketed.opened} · ข้าม(มีเคสอยู่แล้ว) ${ticketed.skipped} · พลาด ${ticketed.failed}`,
          );
        }
      } catch (e) {
        this.logger.warn(
          `broadcast direct-ticket open failed (the send itself is unaffected): ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }

      /**
       * [FEAT-20260825-MCASTABANDON] A campaign that asks for details arms the
       * follow-up gate for the people it reached — but only when it is not
       * opening cases itself.
       *
       * 🔴 The flag it writes makes each customer's NEXT inbound message open a
       *    case and end the flow, whatever that message is. The reasoning, the
       *    consequence, and every knob for changing it live in
       *    `broadcast-follow-up/stamp-abandon-on-multicast.ts`. Read that file
       *    before editing this block.
       * 🔴 Its own try, separate from the three above — transcript, notice
       *    clearing, case opening and this all fail independently.
       * 🔴 Same `reachedByHook` as the others: arming somebody the send never
       *    reached would open a case about a message they never saw.
       * ⚠️ Not thrown outward — the messages are already delivered.
       */
      try {
        const armed = await stampAbandonForReached(
          this.modelOf(MEMBER_MODEL),
          { lineUserIds: [...reachedByHook.values()].flat() },
          {
            usedKeys: (
              (broadcast['target'] as { rules?: Array<{ key?: unknown }> })
                ?.rules ?? []
            ).map((r) => String(r?.key ?? '')),
            directTicket: broadcast['is_direct_ticket'] === true,
          },
          (m: string) => this.logger.warn(m),
        );
        if (armed.stamped > 0 || armed.failed) {
          this.logger.log(
            `[MCASTABANDON] armed ${armed.stamped} member(s)${armed.failed ? ' (at least one write failed)' : ''}`,
          );
        }
      } catch (e) {
        this.logger.warn(
          `broadcast abandon-stamp failed (the send itself is unaffected): ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    return outcomesFrom(hookIds, report);
  }

  /** ONE ROW PER HOOK. See the header — this is the contract, not a detail. */
  private async writeHookLogs(
    outcomes: readonly HookOutcome[],
    endpoint: string,
    payloadSummary: Record<string, unknown>,
  ): Promise<void> {
    for (const o of outcomes) {
      /* ⚠️ GUARDED PER ROW, not once around the loop: a writer that throws on
         hook 1 must not cost hook 2 its row, or one bad write reads back as
         "the other OAs were never sent to". พังทีละแถว ไม่ใช่ทั้งชุด. */
      try {
        await this.writeOneLog(o, endpoint, payloadSummary);
      } catch (e) {
        this.logger.error(
          `broadcast webhook log row failed: ${e instanceof Error ? e.message : '?'}`,
        );
      }
    }
  }

  private async writeOneLog(
    o: HookOutcome,
    endpoint: string,
    payloadSummary: Record<string, unknown>,
  ): Promise<void> {
    const meta = await this.readHookMeta(o.hookId);
    this.logBroadcast(endpoint, {
      hook_id: o.hookId,
      hook_alias: meta.alias,
      group_id: meta.group,
      /* [FIX-20260828-SKIPSTATUS] "ถูกข้าม" ไม่ใช่ "พัง"
         เจ้าของ 28/08: *"skip ไม่ควร error ควร status = skip"*
         ⚠️ เขียนค่านี้ได้เพราะ `webhook-log.schema.ts` ยอมรับแล้ว — ค่าที่ไม่อยู่ใน
            enum จะทำให้ Mongoose ปฏิเสธทั้ง document และแถวหายเงียบ (ดู
            `[FIX-20260815-SUPPRESSEDENUM]`)
         ⚠️ `results[].status` และสถานะรวมของงาน **ไม่ถูกแตะ** — ดู `HookOutcome.skipped` */
      status: o.skipped ? 'skipped' : o.ok ? 'success' : 'error',
      /* ⚠️ NO `http_status`: the run reports per-OA counters, not per-request
         HTTP codes, and an invented number in an audit row is worse than an
         absent one (the old sender leaves it unset on a transport failure too).
         ไม่รู้ = ไม่เขียน ห้ามเดาเลข. */
      payload_summary: payloadSummary,
      response_summary: o.response,
      ...(o.error ? { error_message: o.error } : {}),
    });
  }

  /**
   * [FIX-20260828-HISTALIAS] ชื่อ OA ของทุกตัวในรอบนี้ คีย์ด้วย id รูปสตริง
   *
   * หนึ่ง query ต่อรอบ (`$in`) ไม่ใช่ต่อ OA — ตารางประวัติเขียนทีละแถวก็จริง
   * แต่ชื่อทั้งชุดรู้ได้ตั้งแต่ก่อนเริ่มยิง
   * ⚠️ OA ที่หาแถวไม่เจอ = ไม่มีคีย์ ⇒ `aliasFor` คืน undefined ⇒ แถวนั้นไม่มี
   *    `hook_alias` เหมือนพฤติกรรมเดิมทุกประการ (ไม่เขียนสตริงว่างลงไป —
   *    "ไม่รู้ชื่อ" กับ "ชื่อว่าง" ต้องแยกออกจากกันได้ในแถวที่อ่านย้อนหลัง)
   */
  private async readHookAliases(
    hookIds: readonly string[],
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (hookIds.length === 0) return out;
    try {
      const rows = await this.hookModel
        /* ⚠️ ส่งสตริงให้ mongoose cast เอง — แบบเดียวกับ `findById(id)` ใน
           `readHookMeta` · สร้าง `new Types.ObjectId(id)` เองจะ **โยน** ทันที
           ถ้ามี id สักตัวที่ไม่ใช่ hex24 แล้ว catch ข้างล่างจะกลืนทั้งชุด
           ⇒ OA ที่ปกติอยู่แล้วพลอยไม่มีชื่อไปด้วย เพราะเพื่อนร่วมรอบเสียตัวเดียว */
        .find({ _id: { $in: [...hookIds] } })
        .select({ alias: 1 })
        .lean()
        .exec();
      for (const row of rows) {
        const id = idOf(row?.['_id']);
        const alias = textOf(row?.['alias']);
        if (id !== null && alias !== undefined) out[id] = alias;
      }
    } catch {
      /* อ่านไม่ได้ = ไม่มีชื่อ · รอบส่งต้องไม่ล้มเพราะชื่อที่ใช้แค่แสดงผล */
    }
    return out;
  }

  /** Alias + group for the row. Unreadable ⇒ an unnamed row, never a throw. */
  private async readHookMeta(
    hookId: unknown,
  ): Promise<{ alias?: string; group: unknown }> {
    /* [FIX-20260828-ALIASOBJECTID] `idOf`, not a bare `typeof === 'string'`.
     *
     * THE BUG: `broadcast.schema.ts:95` types `hook_ids` as `Types.ObjectId[]`,
     * and the REFUSED path hands those ids straight through (`refuse(rawHooks,…)`
     * at :283, :323, :328) without the stringify the send path happens to do.
     * The old guard saw an ObjectId, decided it was "not a string", and returned
     * WITHOUT an alias — so a refused run wrote a webhook_logs row with no
     * `hook_alias`, and the history table (`Broadcasts.tsx:932` reads the field
     * directly) showed a BLANK OA column for that row while every delivered row
     * beside it showed a name. Seen on stg 28/08.
     *
     * `idOf` is the helper this file already imports (:70) and already trusts
     * for exactly this: ObjectId → hex, string → itself, populated doc → its
     * `_id`, anything else → null. Reusing it keeps ONE answer to "what is an
     * id here" instead of a second opinion that can drift.
     * ⚠️ กับดัก ObjectId ตัวเดิมกับ `ensureAssignGroupAccess` (แก้ไป 27/08) — ครั้งที่สองแล้ว
     * revert: put the `typeof` guard back; the alias goes blank again. */
    const id = idOf(hookId);
    if (id === null) return { group: null };
    try {
      const row = await this.hookModel
        .findById(id)
        .select({ alias: 1, group: 1 })
        .lean()
        .exec();
      return { alias: textOf(row?.['alias']), group: row?.['group'] ?? null };
    } catch {
      return { group: null };
    }
  }

  /** The fixed fields, as `broadcasts.service.ts#logBroadcast` writes them —
   *  `channel` + `action_type` are the tab's filter. Not awaited, deliberately. */
  private logBroadcast(endpoint: string, doc: Record<string, unknown>): void {
    void this.wlog
      .persist({
        channel: 'line_api',
        action_type: 'send_broadcast',
        method: 'POST',
        endpoint,
        ...doc,
      })
      .catch((err: Error) =>
        this.logger.error(
          `broadcast webhook log create failed: ${err.message}`,
        ),
      );
  }
}
