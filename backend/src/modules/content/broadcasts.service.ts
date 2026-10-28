import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';

/* [FEAT-20260822-BCASTSWITCH] The migration seam and its switch. Relative on
   purpose: `content/index.ts` re-exports this service, so importing the barrel
   from inside it is a cycle. คนละเรื่องกับกฎห้าม deep import — นี่คือโฟลเดอร์ตัวเอง. */
import { NO_ACTOR_NAMES, type ActorNames } from './content-actor-names.util';
import {
  usesNewSendPath,
  BroadcastNewSendPort,
} from './broadcast-run/new-path.switch.helper';
/* [FEAT-20260907-BCASTUNUSEDRULES] The save-time half of the rule.
   🔴 `cellFor`/`audienceFor` are the RUNTIME's own resolvers, imported rather
      than re-implemented: a save-time rule that decides "broadcast" differently
      from the sender would refuse jobs that send fine, or pass jobs that do not.
      One resolver, one answer — two would be two standards.
   ⚠️ BOTH ARE FILE IMPORTS, NOT BARREL IMPORTS, and that is required rather than
      stylistic: `new-path.switch.helper.ts:4-7` records that this service must
      never pull `broadcast-run/index.ts`, because `content/index.ts` re-exports
      this service and the pair is a cycle. The same caution is applied to
      `broadcast-send` — one file, one rule, nothing else dragged in.
      Never the barrel: it leads back to this very file. */
import { audienceFor, cellFor } from './broadcast-run/new-send.helpers';
import {
  carriesUnusedRules,
  refusesUnusedRulesAtSave,
  UNUSED_RULES_SAVE_MESSAGE,
} from './broadcast-send/audience-on-broadcast.policy';

import type { AuthenticatedUser } from '@/common';
import { CryptoService } from '@/infra/crypto';
import { AuditLogService, type AuditRequestMetaInput } from '@/modules/audit';
import {
  buildActor,
  Group,
  type GroupDocument,
  FlexMessage,
  type FlexMessageDocument,
  Hook,
  type HookDocument,
} from '@/modules/hooks';
import { WebhookLogWriter } from '@/modules/system';
import {
  ensureValidMessage,
  ensureSendableCombination,
  ensureValidCardType,
  ensureValidSchedule,
  ensureValidDescription,
  ensureValidGuardWindow,
  ensureValidSendKind,
  ensureValidTitleDetail,
  normalizeTarget,
} from './content-broadcast-auto-reply.util';
import {
  ensureAssignGroupAccess,
  ensureCanWriteBroadcast,
  ensureValidHookIds,
  expandGroupsIntoHookIds,
  getAllowedHookIds,
  /* [FEAT-20260825-MULTIGROUP] ไม่ใช้ resolveAssignGroup ตัวเดิมแล้ว — ลิสต์เป็นทางหลัก
     ตัวเดิมยังอยู่ใน util เพราะ resolveAssignGroups เรียกใช้ภายใน */
  resolveAssignGroups,
  ensureAssignGroupsAccess,
} from './content-oa-access.util';
import {
  STATUS_VALUES,
  sanitizeBroadcastRow,
  type SanitizedBroadcast,
} from './broadcast-payload.util';
import { dispatchBroadcast } from './broadcast-legacy-send.util';
/* [FIX-20260831-BCASTPROFILEGATE] the plain-vs-personal content gate. Direct
   folder import, not the content barrel — this service is re-exported by that
   barrel, so importing it back is a cycle. */
import { checkProfileMatch } from './broadcast-var';
/* [FEAT-20260824-BCASTTIMEDOOR] every admin-supplied time goes through one door */
import {
  computeNextRun,
  armNextRunOnUpdate,
  isRepeatRule,
} from './broadcast-schedule';
import { parseAdminTime } from './broadcast-time';
import type { CreateBroadcastDto, UpdateBroadcastDto } from './dto';
import { Broadcast, type BroadcastDocument } from './schemas/broadcast.schema';

@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);

  constructor(
    @InjectModel(Broadcast.name)
    private readonly broadcastModel: Model<BroadcastDocument>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    @InjectModel(Group.name)
    private readonly groupModel: Model<GroupDocument>,
    // [FIX-20260808-BROADCASTSEND] send flow deps, mirroring the in-repo LINE
    // outbound precedent (external/hook-outbound.service.ts:224-231): the crypto
    // service decrypts the per-hook token, and the webhook_log model records one
    // row per hook send. legacy dispatchBroadcast uses safeDecrypt + webhookLogService.
    /* [FEAT-20260827-WLOGONEDOOR] was `@InjectModel(WebhookLog)`. The model was
     * injected here only to be handed to the legacy sender, which now takes the
     * door instead. This service never touches webhook_logs itself. */
    private readonly wlog: WebhookLogWriter,
    private readonly crypto: CryptoService,
    // [FEAT-20260808-AUDITSITE] audit_logs writer, matching legacy
    // broadcastController.js:6 (auditLogService). Fire-and-forget below.
    private readonly auditLogService: AuditLogService,
    /**
     * [FEAT-20260822-BCASTSWITCH] The new pipeline, when one is provided.
     *
     * ⚠️ ONE LOCK, NOT TWO — corrected 23/08 after an audit read this comment
     * against the module.
     *
     * It used to say "nothing provides this today, so TWO separate things must
     * be true". `content.module.ts` binds
     * `{ provide: BroadcastNewSendPort, useClass: BroadcastNewSendService }`,
     * so the port IS provided and the ONLY thing standing between a campaign
     * and the new path is `BROADCAST_NEW_PATH_ENABLED`.
     *
     * The comment was written when it was true and never revisited when the
     * provider landed — which is worse than no comment, because the next reader
     * budgets their care against a second lock that does not exist.
     * คอมเมนต์ที่เคยจริงแล้วไม่ได้ตามแก้ อันตรายกว่าไม่เขียนเลย.
     *
     * `@Optional()` still earns its place: a caller constructing this service
     * without the module (every unit spec does) gets `undefined` and the old
     * sender, instead of a DI error.
     */ @Optional()
    private readonly newSendPort?: BroadcastNewSendPort,
    /**
     * [FIX-20260831-BCASTPROFILEGATE] the flex library, read AT SAVE TIME.
     *
     * create/update never held a `flex_id` card's body before — only the
     * reference was stored, and the body was first read at send time
     * (`resolveSavedCard`). The profile-match gate below needs that body when
     * the job binds a library card, so this is the one place the service
     * touches the flex collection: a single lean findById per save.
     *
     * `@Optional()` for the same reason as `newSendPort` above: every unit
     * spec builds this service positionally, and a new REQUIRED parameter
     * would break each of them at compile time. Nest always provides it in
     * the module (`content.module.ts` registers the schema); when absent the
     * gate simply judges what the request carries inline.
     */
    @Optional()
    @InjectModel(FlexMessage.name)
    private readonly flexModel?: Model<FlexMessageDocument>,
  ) {}

  /**
   * Thin by design: the shaping is a pure function
   * (`sanitizeBroadcastRow`), and this method stays because it is part of the
   * service's contract and several callers hold a service, not a module.
   */
  public sanitizeBroadcast(
    broadcast: BroadcastDocument | null,
    names: ActorNames = NO_ACTOR_NAMES,
  ): SanitizedBroadcast | null {
    return sanitizeBroadcastRow(broadcast, names);
  }

  private async ensureAllowedHookIds(
    user: AuthenticatedUser | null | undefined,
    hookIds: unknown[],
  ): Promise<void> {
    const allowedHookIds = await getAllowedHookIds(user, this.hookModel);
    if (allowedHookIds === null) return;
    const idsStr = (hookIds || []).map((id) => String(id));
    const invalid = idsStr.filter((id) => !allowedHookIds.includes(id));
    if (invalid.length > 0) {
      throw new ForbiddenException('insufficient OA access');
    }
  }

  /**
   * [FIX-20260831-BCASTPROFILEGATE] a plain job must not carry a per-person card.
   *
   * The failure this closes is SILENT and reaches customers: ticking plain on a
   * card that reads `{{member.*}}`/`{{profile.*}}` renders once per OA, the
   * per-person tags are pre-filled with 'N/A' (build-broadcast-vars), the tags
   * therefore never even appear in `unknownTags` — and every recipient gets a
   * card of N/A values with no error anywhere. Measured on stg 30/08 the other
   * way round too (a personal job DID run), so both sides of the tick are real.
   *
   * `checkProfileMatch` (broadcast-var/checks/needs-per-recipient.ts) existed
   * for exactly this and had ZERO callers — this is the wiring it was written
   * for. Policy lives here (the caller), as its header demands:
   *   refuse   → 400 naming the tags (the admin still has the form open)
   *   wasteful → log only — a personal tick on a tag-free card sends fine,
   *              it just costs one request per person for nothing
   *
   * The body judged follows `resolveSavedCard`'s precedence: the `flex_id`
   * library card first (one lean findById), the inline message second. A
   * dangling id is NOT this gate's failure — the send path reports that with
   * its own error, so a fetch miss falls back to the inline shape.
   *
   * ⚠️ A card edited in the library AFTER the job is saved can still drift
   * past this gate — a save-time check cannot see the future. The run-time
   * gate is a separate decision (recorded in be_todo101) because it changes
   * how existing mismatched jobs fail.
   */
  private async ensureProfileTagsMatchCardType(
    message: unknown,
    cardType: string | null,
  ): Promise<void> {
    const msg = (message ?? {}) as Record<string, unknown>;
    let body: unknown = msg;
    const flexId = typeof msg['flex_id'] === 'string' ? msg['flex_id'] : '';
    if (flexId && this.flexModel) {
      try {
        const doc = (await this.flexModel
          .findById(flexId)
          .select({ content_json: 1 })
          .lean()
          .exec()) as { content_json?: unknown } | null;
        if (doc && doc.content_json !== undefined) body = doc.content_json;
      } catch {
        /* the send path owns dangling-id errors; the gate judges what it has */
      }
    }
    const verdict = checkProfileMatch(body, cardType === 'personal');
    if (verdict.kind === 'refuse') {
      throw new BadRequestException(
        'this card fills per-person values (' +
          verdict.tags.join(', ') +
          ") — a plain send would show 'N/A' to every recipient. " +
          "Set card_type 'personal' or remove the tags.",
      );
    }
    if (verdict.kind === 'wasteful') {
      this.logger.log(
        '[BCASTPROFILEGATE] personal tick on a card with no per-person tags — allowed, but this costs one request per recipient for nothing',
      );
    }
  }

  public async createBroadcast(
    user: AuthenticatedUser,
    dto: CreateBroadcastDto,
    requestMeta?: AuditRequestMetaInput,
  ): Promise<
    SanitizedBroadcast | { data: SanitizedBroadcast | null; results: unknown[] }
  > {
    const name = typeof dto.name === 'string' ? dto.name.trim() : '';
    if (!name) throw new BadRequestException('name is required');

    const hook_ids = await ensureValidHookIds(dto.hook_ids, this.hookModel);
    await this.ensureAllowedHookIds(user, hook_ids);
    /**
     * [FEAT-20260825-MULTIGROUP] หลายกลุ่มเว็บใน job เดียว
     *
     * 🔴 `assign_group_ids` คือตัวหลัก · `assign_group` เขียนคู่ไว้เป็น **กลุ่มแรก**
     *    เพื่อให้ตัวกรองการมองเห็นเดิมและแถวเก่ายังทำงาน — ไม่ใช่เพื่อให้ใครมาอ่าน
     *    ⇒ โค้ดใหม่ที่อยากรู้ว่า job นี้อยู่กลุ่มไหน ต้องอ่านลิสต์ ห้ามอ่านตัวเดิม
     * 🔴 เช็คสิทธิ์ **ทุกกลุ่ม** ไม่ใช่แค่ตัวแรก ไม่งั้นแอบผูกกลุ่มที่ไม่มีสิทธิ์ไว้ตัวที่ 2 ได้
     */
    const assign_groups = await resolveAssignGroups(
      dto.assign_group_ids ?? dto.assign_group,
      this.groupModel,
    );
    ensureAssignGroupsAccess(user, assign_groups);
    const assign_group = assign_groups[0] ?? { id: undefined, name: '' };
    const target = await normalizeTarget(dto.target, this.groupModel);
    /**
     * [FEAT-20260824-BCASTMULTIOA] Groups become OAs here, while an admin is
     * still in the room to be checked against.
     *
     * 🔴 THE RE-CHECK BELOW IS THE POINT. Expansion can only ADD OAs, and every
     *    added one has to be inside this admin's scope — the standing rule that
     *    a job may only name OAs its author could reach. Skipping it would let a
     *    group act as a way around `ensureAllowedHookIds`.
     *    ขยายแล้วต้องตรวจสิทธิ์ซ้ำ ไม่งั้นกลุ่มกลายเป็นทางลัดข้ามสิทธิ์.
     *
     * ⚠️ No cap is applied here on purpose. `maxHooks` belongs to the send
     *    matrix (`broadcast-run/`), and importing it into this file would close a
     *    cycle with the module that imports this service. The run path already
     *    caps and REPORTS the truncation, which is where an admin can act on it.
     *    เพดานอยู่ที่ตอนส่ง ไม่ดึงเข้ามาที่นี่ เพราะจะเกิด cycle.
     */
    const oa = await expandGroupsIntoHookIds(hook_ids, target, this.hookModel);
    if (oa.addedFromGroups > 0) {
      await this.ensureAllowedHookIds(user, oa.hookIds);
    }
    const message = ensureValidMessage(dto.message);

    const status = dto.status || 'draft';
    if (!STATUS_VALUES.has(status)) {
      throw new BadRequestException('Invalid status');
    }

    /* [FEAT-20260824-BCASTTIMEDOOR] `parseAdminTime` owns the reading AND the
       "is it valid" answer, so the four places that used to each write their own
       `new Date` + `isNaN` pair cannot disagree. ดู docs/TIME-RULE.md */
    /* [FEAT-20260825-ATTIME] Read BEFORE the required-date check below, which
       asks it whether this job is a repeat. */
    const schedule = ensureValidSchedule(dto.schedule);
    const scheduled_at = parseAdminTime(dto.scheduled_at, 'scheduled_at');
    /**
     * [FEAT-20260825-ATTIME] A REPEAT rule supplies its own clock, so the
     * one-off date is not required for it.
     *
     * เจ้าของ 25/08: *"ถ้าทำซ้ำไม่จำเป็นต้องระบุวันที่หลัก (มีไว้ทำไมงง)
     * ถ้าตั้งแบบไม่ซ้ำค่อยระบุวันที่เวลา"*.
     *
     * 🔴 THE ONE-OFF PATH IS UNCHANGED. `mode: 'once'`, a missing schedule and a
     *    legacy row all still demand `scheduled_at` — only an explicit repeat
     *    rule is exempt, because `computeNextRun` derives every firing from
     *    `at_time_min` + `days_of_week` and never reads this field.
     *    ยกเว้นเฉพาะ repeat จริง ๆ ทางเดิมไม่ถูกแตะ.
     */
    if (status === 'scheduled' && !scheduled_at && !isRepeatRule(schedule)) {
      throw new BadRequestException(
        'scheduled_at is required for scheduled status',
      );
    }

    let sent_at = parseAdminTime(dto.sent_at, 'sent_at');
    if (status === 'sent' && !sent_at) {
      sent_at = new Date();
    }

    /* Refused here, not at send time: the admin still has the form open.
       `null` = "no custom title", which is the normal case, not an error. */
    const title_detail = ensureValidTitleDetail(dto.title_detail);
    const send_kind = ensureValidSendKind(dto.send_kind);
    // [FEAT-2708-GUARDWINDOW] null = no guard — absent on the row, not stored
    const guard_window_hours = ensureValidGuardWindow(dto.guard_window_hours);
    const card_type = ensureValidCardType(dto.card_type);
    /* Required here and nowhere else — see `ensureValidDescription`. */
    const description = ensureValidDescription(dto.description, {
      required: true,
    });
    ensureSendableCombination(send_kind, card_type);
    /* [FEAT-20260907-BCASTUNUSEDRULES] A NEW job may not be born unsendable-as-
       asked. There is no stored row behind a create, so there is nothing to
       protect and every reason to refuse: the admin is still looking at the
       form. A new job must not be born in this state. */
    if (
      refusesUnusedRulesAtSave(
        carriesUnusedRules(cellFor(send_kind, card_type), audienceFor(target)),
        undefined,
      )
    ) {
      throw new BadRequestException(UNUSED_RULES_SAVE_MESSAGE);
    }
    // [FIX-20260831-BCASTPROFILEGATE] after the pair check: the pair decides
    // whether the job CAN send at all; this decides whether the card's content
    // agrees with the tick. Both belong to save time — the admin is still here.
    await this.ensureProfileTagsMatchCardType(message, card_type);

    const broadcast = await this.broadcastModel.create({
      name,
      /* [FEAT-20260824-BCASTMULTIOA] the resolved union: OAs picked by hand plus
         the OAs of any chosen group, deduped. `target.group_ids` stays stored
         beside it so the form can still show what was chosen. */
      hook_ids: oa.hookIds,
      assign_group,
      /* [FEAT-20260825-MULTIGROUP] ตัวหลัก — ดูบล็อกด้านบน */
      assign_group_ids: assign_groups.map((g) => g.id),
      target,
      message,
      status,
      scheduled_at,
      sent_at,
      /* Spread, not `title_detail: null` — a brand-new row with no custom
         title carries NO SUCH FIELD rather than a null in every document.
         Reads treat absent and null identically (`?? null` in sanitize), so
         the cheaper shape wins. UPDATE still writes an explicit `null`: there
         a stored value has to be actively overwritten to be cleared. */
      ...(title_detail === null ? {} : { title_detail }),
      /* Absent, not null: a new job that made no choice must look exactly like
         every job that predates the column. ไม่เลือก = ไม่มีคีย์นี้เลย. */
      ...(send_kind === null ? {} : { send_kind }),
      ...(guard_window_hours === null ? {} : { guard_window_hours }),
      ...(card_type === null ? {} : { card_type }),
      ...(description === null ? {} : { description }),
      /* [FEAT-20260825-BCASTDIRECTTICKET] Absent unless ticked, like every
         optional column above it: a job that did not ask for this must look
         exactly like every job that predates the field, so nothing that reads
         `broadcasts` has to learn a third state.
         ⚠️ Spread, NOT `is_direct_ticket: dto.is_direct_ticket` — that would
         write `undefined`, and this object is the one that decides what Mongo
         actually receives (the note below records the day a missing line here
         made a whole feature inert). ไม่ติ๊ก = ไม่มีคีย์นี้เลย. */
      ...(dto.is_direct_ticket === true ? { is_direct_ticket: true } : {}),
      /* [FEAT-20260825-BCASTSKIPASSIST] กติกาเดียวกับบรรทัดบนทุกข้อ —
         ไม่ติ๊ก = ไม่มีคีย์นี้เลย ⇒ งานใหม่หน้าตาเหมือนงานที่มีมาก่อนคอลัมน์นี้ */
      ...(dto.skip_assist === true ? { skip_assist: true } : {}),
      /* [FEAT-20260824-BCASTREPEAT] The repeat rule, absent when not asked for.
         🔴 THIS OBJECT IS BUILT FIELD BY FIELD, so a rule not named here never
         reaches Mongo — the drop shape that made the audience conditions inert
         for a whole day (`rules` measured as never stored, 23/08).
         Spread rather than `schedule: undefined`: a job that sets no cadence
         must carry no such key, so it looks exactly like every campaign that
         predates the feature and `isRepeating()` answers `false` for it.
         ไม่ตั้งรอบ = ไม่มีคีย์ ⇒ เหมือนงานเก่าเป๊ะ. */
      ...(schedule === undefined ? {} : { schedule }),
      /**
       * [FEAT-20260824-BCASTREPEAT] The FIRST round, armed.
       *
       * 🔴 THE SCAN FINDS NOTHING WITHOUT THIS. `dueScanQuery` filters on
       *    `{ status: 'scheduled', next_run_at: { $lte: now } }`
       *    (`broadcast-schedule/due-query.ts:147`), and until today no code
       *    anywhere wrote `next_run_at` — so a campaign could be saved as
       *    `scheduled`, with a time, and the scheduler would never see it. The
       *    two columns answer different questions and both are needed:
       *    `scheduled_at` = what the admin ASKED for, `next_run_at` = the
       *    cursor the scan reads. The first round is simply the intent.
       *    ตั้งเวลาไว้แต่ไม่มี next_run_at ⇒ scan มองไม่เห็นเลย.
       *
       * ⚠️ NEW SAVES ONLY. Rows already sitting in Mongo as `scheduled` with no
       *    cursor are left exactly as they are — they behave as they do today
       *    (they do not fire) until someone edits them, which re-arms them
       *    through the UPDATE path. No migration, nothing rewritten underneath
       *    anybody. แถวเก่าไม่ถูกแตะ ต้องแก้ผ่านฟอร์มก่อนจึงจะติดอาวุธ.
       */
      /**
       * [FEAT-20260825-ATTIME] โหมดซ้ำไม่มี `scheduled_at` ⇒ ต้องคำนวณรอบแรกเอง
       *
       * 🔴 บั๊กที่เจอตอนยิงเทสของจริง 25/08: พอเลิกบังคับ `scheduled_at` สำหรับ
       *    โหมดซ้ำ (ตามที่เจ้าของสั่ง) แถวใหม่จะไม่มีทั้ง `scheduled_at` และ
       *    `next_run_at` ⇒ `dueScanQuery` มองไม่เห็นเลย ⇒ **job ที่ตั้งไว้ไม่มีวันยิง
       *    และไม่มี error อะไรทั้งสิ้น** · unit test เขียวหมด เพราะไม่มีเทสไหน
       *    ถามว่า "แล้วมันจะถูก scan เจอไหม"
       *    ⇒ รอบแรกมาจาก `computeNextRun` ของกฎเอง ซึ่งเป็นตัวเดียวกับที่ใช้
       *      คำนวณรอบถัด ๆ ไป — ไม่มีสูตรที่สอง
       *
       * ⚠️ `?? undefined` ไม่ใช่ `?? null` — กฎที่คำนวณรอบแรกไม่ได้ (เช่นเลย
       *    `max_runs` ไปแล้ว) ต้อง **ไม่มีคีย์** ไม่ใช่มีคีย์ที่เป็น null
       *    absent = ไม่มีรอบถัดไป · null = เคยมีแล้วถูกล้าง สองอย่างนี้คนละเรื่อง
       */
      ...(status === 'scheduled' && scheduled_at
        ? { next_run_at: scheduled_at }
        : status === 'scheduled' && isRepeatRule(schedule)
          ? (() => {
              const first = computeNextRun(schedule, new Date(), 0);
              return first ? { next_run_at: first } : {};
            })()
          : {}),
      created_by: user.userId,
      updated_by: user.userId,
    });

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'broadcast', action:'create', ref_id, actor, request_meta, note} —
    // additive only, no schema change. Mirrors broadcastController.js:467-478.
    // Fire-and-forget so an audit failure never fails the create.
    void this.auditLogService
      .createAuditLog({
        ref_id: broadcast._id,
        parent: 'broadcast',
        action: 'create',
        actor: buildActor(user),
        request_meta: requestMeta,
        note: dto.audit_note,
      })
      .catch(() => undefined);

    const sanitized = this.sanitizeBroadcast(broadcast);
    if (!sanitized) throw new BadRequestException('Failed to build broadcast');

    if (status === 'sent') {
      return { data: sanitized, results: [] };
    }

    return sanitized;
  }

  public async updateBroadcast(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateBroadcastDto,
    requestMeta?: AuditRequestMetaInput,
  ): Promise<SanitizedBroadcast> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid broadcast identifier');
    }
    const broadcast = await this.broadcastModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .lean();
    if (!broadcast) {
      throw new NotFoundException('Broadcast not found');
    }

    /* 🔴 [FIX-20260823-BCASTOASCOPE] THE JOB'S OWN OAs, not just the request's.
       `broadcast.manage` says the account may manage broadcasts; it says
       nothing about WHICH OAs. Only `listBroadcasts` narrowed by OA, so an
       operator scoped to one OA could act on anybody else's job by pasting the
       id — the list looked like a boundary and was only a filter.
       Every hook must be reachable here: acting on a job that also spans an OA
       you cannot see means acting on that OA's followers.
       เห็นเฉพาะของตัวเอง แต่รู้ id แล้วแก้/ลบ/ยิงของคนอื่นได้. */
    await ensureCanWriteBroadcast(user, broadcast['hook_ids'], this.hookModel);

    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = typeof dto.name === 'string' ? dto.name.trim() : '';
      if (!name) throw new BadRequestException('name is required');
      updates['name'] = name;
    }

    if (dto.hook_ids !== undefined) {
      const hook_ids = await ensureValidHookIds(dto.hook_ids, this.hookModel);
      await this.ensureAllowedHookIds(user, hook_ids);
      updates['hook_ids'] = hook_ids;
    }

    /**
     * [FEAT-20260825-MULTIGROUP] อัปเดตกลุ่มเว็บ — ลิสต์เป็นตัวหลัก
     *
     * ⚠️ `!== undefined` ทั้งสองคีย์ เพราะ **ไม่ส่งมา = ไม่แตะ** ส่วนส่ง `[]` มา
     *    = ตั้งใจล้าง ⇒ absent ≠ [] และตัวอัปเดตต้องแยกสองอย่างนี้ออก
     * ⚠️ เขียน `assign_group` คู่เสมอ ไม่งั้นตัวกรองการมองเห็นของแถวนี้จะว่าง
     *    แล้ว job หายจากหน้าจอคนที่ไม่ใช่ superadmin
     */
    const groupsSent =
      dto.assign_group_ids !== undefined
        ? dto.assign_group_ids
        : dto.assign_group;
    if (groupsSent !== undefined) {
      const assign_groups = await resolveAssignGroups(
        groupsSent,
        this.groupModel,
      );
      ensureAssignGroupsAccess(user, assign_groups);
      updates['assign_group_ids'] = assign_groups.map((g) => g.id);
      updates['assign_group'] = assign_groups[0] ?? { id: undefined, name: '' };
    }

    if (dto.target !== undefined) {
      updates['target'] = await normalizeTarget(dto.target, this.groupModel);
    }

    if (dto.message !== undefined) {
      updates['message'] = ensureValidMessage(dto.message);
    }

    if (dto.status !== undefined) {
      if (!STATUS_VALUES.has(dto.status)) {
        throw new BadRequestException('Invalid status');
      }
      updates['status'] = dto.status;
    }

    if (dto.scheduled_at !== undefined) {
      /* `null` = a deliberate clear, and it must stay expressible — see the
         `next_run_at` note below. ส่ง null = ล้างเวลา ไม่ใช่ไม่ได้ส่งมา. */
      const scheduled_at =
        parseAdminTime(dto.scheduled_at, 'scheduled_at') ?? null;
      updates['scheduled_at'] = scheduled_at;
      /**
       * [FEAT-20260824-BCASTREPEAT] Re-arm the cursor with the intent.
       *
       * 🔴 THE TWO MUST MOVE TOGETHER. `scheduled_at` is what the admin sees;
       *    `next_run_at` is what the scan reads (`due-query.ts:147`). Editing
       *    the time and leaving the cursor behind means the campaign fires at
       *    the OLD time and the form shows the new one — a job that lies about
       *    itself. Clearing the time must clear the cursor for the same reason:
       *    a `null` intent with a live cursor is a send nobody asked for.
       *    แก้เวลาแล้วไม่ขยับ cursor = ยิงตามเวลาเก่า แต่หน้าจอโชว์เวลาใหม่.
       *
       * ⚠️ This is also the ONLY way an old row gets armed: rows written before
       *    today have no cursor, and saving the form once gives them one.
       */
      updates['next_run_at'] = scheduled_at;
    }

    /**
     * [FEAT-20260825-ATTIME] แก้กฎซ้ำผ่านฟอร์ม ⇒ ต้องติดอาวุธรอบแรกให้ด้วย
     *
     * 🔴 โหมดซ้ำไม่มี `scheduled_at` ⇒ บล็อกข้างบนไม่ทำงานเลย ⇒ ถ้าไม่มีตรงนี้
     *    การเปลี่ยน "ทำซ้ำ ตอนกี่โมง" จะไม่ขยับ cursor และ job จะยังยิงเวลาเดิม
     *    (หรือไม่ยิงเลยถ้ายังไม่เคยมี cursor) โดยหน้าจอโชว์เวลาใหม่ — job ที่โกหกตัวเอง
     *
     * ⚠️ คำนวณจากกฎ **หลังอัปเดต** ไม่ใช่ก่อน — คนแก้เวลาคาดหวังเวลาใหม่
     * ⚠️ ไม่แตะเมื่อ request ไม่ได้ส่ง `schedule` มา (absent = ไม่แตะ)
     */

    /* `undefined` = the field was not in the request ⇒ leave the stored value
       alone. Anything else is a deliberate set, INCLUDING `null`/`''` which
       clear it. Folding those two cases together would make the box
       impossible to empty once filled. ไม่ส่งมา = ไม่แตะ · ส่งค่าว่าง = ล้างค่า. */
    if (dto.title_detail !== undefined) {
      updates['title_detail'] = ensureValidTitleDetail(dto.title_detail);
    }

    /* `undefined` = not in the request ⇒ leave it alone. `null`/`''` = a
       deliberate clear, which puts the job back on the old sender. */
    if (dto.send_kind !== undefined) {
      updates['send_kind'] = ensureValidSendKind(dto.send_kind);
    }
    // [FEAT-2708-GUARDWINDOW] undefined = untouched · null = clear the guard
    if (dto.guard_window_hours !== undefined) {
      updates['guard_window_hours'] = ensureValidGuardWindow(
        dto.guard_window_hours,
      );
    }

    if (dto.card_type !== undefined) {
      updates['card_type'] = ensureValidCardType(dto.card_type);
    }

    /* [FEAT-20260824-BCASTREPEAT] `undefined` = not in the request ⇒ the stored
       cadence stands. `null` = a deliberate clear, and it must be WRITABLE:
       without this branch an admin could turn a one-off campaign into a daily
       one and never turn it back off.
       ⚠️ `ensureValidSchedule(null)` answers `undefined`, so the assignment
       below stores `undefined` — which Mongoose drops rather than unsetting a
       stored value. `null` is written explicitly for the clear, the same shape
       `title_detail` uses two branches up: on CREATE absent stays absent, on
       UPDATE a stored value has to be actively overwritten to be cleared.
       ส่ง null = ล้างรอบซ้ำ ต้องเขียน null จริง ไม่ใช่ undefined. */
    if (dto.schedule !== undefined) {
      updates['schedule'] = ensureValidSchedule(dto.schedule) ?? null;
    }

    /* [FIX-20260826-ARMONSTATUS] 🔴 ต้องอยู่ **หลัง** จุดที่เซ็ต `updates['schedule']` เสมอ
       (รอบแรกผมวางไว้ก่อนหน้า ⇒ อ่านได้ `undefined` ตลอด · เซฟแล้ว cursor ไม่ขึ้น
       ยืนยันจาก stg 26/08: `updated_at` ขยับ แต่ `next_run_at` ยังว่าง)
       เดิมบล็อกนี้เป็น `if (updates['schedule'] !== undefined)`
       คือติดอาวุธก็ต่อเมื่อ **request นี้ส่ง `schedule` มา** ⇒ เปลี่ยนสถานะ
       draft → scheduled โดยไม่แตะกฎซ้ำ = ไม่ติดอาวุธ และเงียบสนิท
       ⚠️ วัดจาก prod 26/08: 3 งาน `scheduled` + `mode:'repeat'` + `at_time_min` มีค่า
          แต่ `next_run_at` ว่าง ⇒ `dueScanQuery` มองไม่เห็นตลอดกาล · ทั้ง 3 ตัว
          "เคยถูกแก้หลังสร้าง" ตรงกับเคสนี้เป๊ะ
       ⇒ ย้ายการตัดสินไป `armNextRunOnUpdate` ซึ่งคิดจาก **สถานะปลายทาง**
         และมีเทสของตัวเองที่ `z-test/unit/broadcast-arm-on-status.spec.ts` */
    const armed = armNextRunOnUpdate({
      statusAfter: (updates['status'] ?? broadcast.status) as string,
      scheduleAfter: updates['schedule'] ?? broadcast.schedule,
      storedNextRunAt: broadcast.next_run_at,
      scheduleTouched: updates['schedule'] !== undefined,
      /* 🔴 `instanceof Date` ไม่ใช่ "มีคีย์ไหม" — ฟอร์มส่ง `scheduled_at: null`
         มา **ทุกครั้ง** ที่เซฟงานซ้ำ (BroadcastFormModal.tsx:676) ⇒ เส้นข้างบน
         เขียน `next_run_at = null` เสมอ · ถ้าถือว่านั่นคือ "ตั้งแล้ว" arm จะถอย
         และงานซ้ำไม่มีวันติดอาวุธ (เจอจริงบน stg 26/08 — เซฟแล้ว at_time_min
         ขยับแต่ cursor ยังว่าง) · Date จริงเท่านั้นที่ชนะ arm ได้ */
      alreadySetThisRequest: updates['next_run_at'] instanceof Date,
    });
    if (armed !== undefined) updates['next_run_at'] = armed;

    /* 🔴 ONLY WHEN SENT. An edit of a campaign that predates the column must
       not be blocked by it — renaming a 2025 broadcast cannot require writing
       its rationale first. But a description SENT as blank is still refused:
       that is someone clearing it, not someone leaving it alone.
       ไม่ส่งมา = ไม่แตะ · ส่งมาว่าง = ปฏิเสธ. */
    if (dto.description !== undefined) {
      updates['description'] = ensureValidDescription(dto.description, {
        required: true,
      });
    }

    /* [FEAT-20260825-BCASTDIRECTTICKET] ไม่ส่งมา = ไม่แตะ (กติกาเดียวกับข้างบน)
       ⚠️ ส่ง `false` มา **ต้องเขียน false จริง** ไม่ใช่ข้าม — นี่คือแอดมินติ๊กออก
          ถ้าข้ามไป ช่องที่เคยติ๊กไว้จะปลดไม่ได้เลยตลอดชีวิตของงานใบนั้น
          ⇒ เทียบกับ `undefined` ไม่ใช่กับความจริง/เท็จ */
    if (dto.is_direct_ticket !== undefined) {
      updates['is_direct_ticket'] = dto.is_direct_ticket === true;
    }

    /* [FEAT-20260825-BCASTSKIPASSIST] เหตุผลเดียวกับบรรทัดบนเป๊ะ ๆ:
       ส่ง `false` มา = แอดมินติ๊กออก ต้องเขียน false จริง ไม่ใช่ข้าม */
    if (dto.skip_assist !== undefined) {
      updates['skip_assist'] = dto.skip_assist === true;
    }

    /* 🔴 CHECKED AGAINST THE ROW, NOT JUST THE REQUEST. An update naming only
       `card_type: 'personal'` on a job already stored as `send_kind:
       'broadcast'` would build the impossible pair one field at a time.
       ต้องเทียบกับค่าที่เก็บไว้ ไม่ใช่แค่ค่าที่ส่งมา. */
    /* 🔴 `in`, NOT `??`. A deliberate CLEAR writes `null` into `updates`, and
       `null ?? stored` falls through to the stored value — so clearing the
       card type on a broadcast job would still be judged against the value the
       admin just removed, and refused. The question is "was this field in the
       request", which only `in` answers.
       ล้างค่า = null ซึ่ง ?? มองว่า "ไม่ได้ส่งมา" ⇒ ต้องใช้ in. */
    const pending = (field: 'send_kind' | 'card_type'): string | null =>
      field in updates
        ? ((updates[field] as string | null) ?? null)
        : (broadcast[field] ?? null);

    ensureSendableCombination(pending('send_kind'), pending('card_type'));
    /**
     * [FEAT-20260907-BCASTUNUSEDRULES] Refuse the MOVE into the state, never the
     * state itself.
     *
     * 🔴 WHY BOTH SIDES ARE COMPUTED. A blanket "the result is bad ⇒ refuse"
     *    would make every job ALREADY in this state impossible to edit: the
     *    dashboard's `buildPayload` is `{ ...formData }`, so `target` rides on
     *    EVERY save — renaming such a job would hand its stored rules straight
     *    back and be rejected. Judging the request against the ROW AS IT WAS is
     *    what separates "somebody just did this" from "somebody is editing
     *    something that was already like that".
     *    Already affected stays editable; making it so anew is refused.
     *
     * ⚠️ `in`, not `??` — the same reason `pending()` above documents: a
     *    deliberate clear writes into `updates`, and `??` would read that as
     *    "not sent" and judge against the value the admin just removed.
     */
    const targetAfter =
      'target' in updates ? updates['target'] : broadcast.target;
    if (
      refusesUnusedRulesAtSave(
        carriesUnusedRules(
          cellFor(pending('send_kind'), pending('card_type')),
          audienceFor(targetAfter),
        ),
        carriesUnusedRules(
          cellFor(broadcast['send_kind'], broadcast['card_type']),
          audienceFor(broadcast['target']),
        ),
      )
    ) {
      throw new BadRequestException(UNUSED_RULES_SAVE_MESSAGE);
    }
    /* [FIX-20260831-BCASTPROFILEGATE] judged ONLY when the request touches the
       message or the tick. A rename-only update of an old mismatched job must
       keep working — the same asymmetry `description` uses (required on create,
       optional on update): history must stay editable. The values judged are
       the row AS IT WILL BE, same as the pair check above. */
    if ('message' in updates || 'card_type' in updates) {
      await this.ensureProfileTagsMatchCardType(
        'message' in updates ? updates['message'] : broadcast['message'],
        pending('card_type'),
      );
    }

    if (dto.sent_at !== undefined) {
      const sent_at = parseAdminTime(dto.sent_at, 'sent_at') ?? null;
      if (sent_at && Number.isNaN(sent_at.getTime())) {
        throw new BadRequestException('sent_at is invalid');
      }
      updates['sent_at'] = sent_at;
    }

    /**
     * [FEAT-20260825-ATTIME] Same exemption as create — see the note there.
     *
     * ⚠️ THE RULE IS ASKED OF THE ROW AS IT WILL BE, not as it was: an update
     *    that turns a one-off into a repeat carries the new rule in
     *    `updates['schedule']`, while one that only renames the job carries
     *    nothing and must fall back to what is already stored. Reading only one
     *    of the two makes the check answer for a row that never existed.
     *    ต้องถามจากสภาพหลังอัปเดต ไม่ใช่ก่อน.
     */
    const scheduleAfterUpdate =
      updates['schedule'] !== undefined
        ? updates['schedule']
        : broadcast.schedule;

    if (
      updates['status'] === 'scheduled' &&
      updates['scheduled_at'] === undefined &&
      !broadcast.scheduled_at &&
      !isRepeatRule(scheduleAfterUpdate)
    ) {
      throw new BadRequestException(
        'scheduled_at is required for scheduled status',
      );
    }

    if (
      updates['status'] === 'sent' &&
      updates['sent_at'] === undefined &&
      !broadcast.sent_at
    ) {
      updates['sent_at'] = new Date();
    }

    updates['updated_by'] = user.userId;

    const updated = await this.broadcastModel
      .findByIdAndUpdate(broadcast._id, updates, {
        new: true,
        runValidators: true,
      })
      .lean();

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'broadcast', action:('send'|'cancel'|'update'), changed_fields (only
    //  when action==='update'), actor, request_meta, note} — additive only, no
    // schema change. Mirrors broadcastController.js:585-608. Fire-and-forget.
    const changedFields = Object.keys(updates).map((field) => ({
      field,
      from: (broadcast as unknown as Record<string, unknown>)[field],
      to: (updated as unknown as Record<string, unknown> | null)?.[field],
    }));
    const auditAction =
      updates['status'] === 'sent'
        ? 'send'
        : updates['status'] === 'cancelled'
          ? 'cancel'
          : 'update';
    void this.auditLogService
      .createAuditLog({
        ref_id: updated?._id ?? broadcast._id,
        parent: 'broadcast',
        action: auditAction,
        changed_fields: auditAction === 'update' ? changedFields : undefined,
        actor: buildActor(user),
        request_meta: requestMeta,
        note: dto.audit_note,
      })
      .catch(() => undefined);

    const sanitized = this.sanitizeBroadcast(updated);
    if (!sanitized) throw new BadRequestException('Failed to update broadcast');
    return sanitized;
  }

  public async deleteBroadcast(
    user: AuthenticatedUser,
    id: string,
    requestMeta?: AuditRequestMetaInput,
  ): Promise<{ message: string; id: unknown }> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid broadcast identifier');
    }
    const broadcast = await this.broadcastModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .lean();
    if (!broadcast) {
      throw new NotFoundException('Broadcast not found');
    }

    /* 🔴 [FIX-20260823-BCASTOASCOPE] THE JOB'S OWN OAs, not just the request's.
       `broadcast.manage` says the account may manage broadcasts; it says
       nothing about WHICH OAs. Only `listBroadcasts` narrowed by OA, so an
       operator scoped to one OA could act on anybody else's job by pasting the
       id — the list looked like a boundary and was only a filter.
       Every hook must be reachable here: acting on a job that also spans an OA
       you cannot see means acting on that OA's followers.
       เห็นเฉพาะของตัวเอง แต่รู้ id แล้วแก้/ลบ/ยิงของคนอื่นได้. */
    await ensureCanWriteBroadcast(user, broadcast['hook_ids'], this.hookModel);

    const updated = await this.broadcastModel
      .findByIdAndUpdate(
        broadcast._id,
        { deleted_at: new Date(), updated_by: user.userId },
        { new: true },
      )
      .lean();

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'broadcast', action:'delete', actor, request_meta, note} —
    // additive only, no schema change. Mirrors broadcastController.js:629-640.
    // Fire-and-forget.
    void this.auditLogService
      .createAuditLog({
        ref_id: updated?._id ?? broadcast._id,
        parent: 'broadcast',
        action: 'delete',
        actor: buildActor(user),
        request_meta: requestMeta,
      })
      .catch(() => undefined);

    return {
      message: 'Broadcast deleted successfully',
      id: updated?._id || broadcast._id,
    };
  }

  public async sendBroadcastNow(
    user: AuthenticatedUser,
    id: string,
    requestMeta?: AuditRequestMetaInput,
  ): Promise<{ data: SanitizedBroadcast | null; results: unknown[] }> {
    // [FIX-20260808-BROADCASTSEND] Validation + group-access guard are UNCHANGED
    // from the previous stub (legacy sendBroadcastNow ~650-667). Only the body
    // below — previously `return { data: sanitized, results: [] }` — is now the
    // real per-hook send, ported from legacy dispatchBroadcast (~213-326).
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid broadcast identifier');
    }
    const broadcast = await this.broadcastModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .lean();
    if (!broadcast) {
      throw new NotFoundException('Broadcast not found');
    }

    /* 🔴 [FIX-20260823-BCASTOASCOPE] THE JOB'S OWN OAs, not just the request's.
       `broadcast.manage` says the account may manage broadcasts; it says
       nothing about WHICH OAs. Only `listBroadcasts` narrowed by OA, so an
       operator scoped to one OA could act on anybody else's job by pasting the
       id — the list looked like a boundary and was only a filter.
       Every hook must be reachable here: acting on a job that also spans an OA
       you cannot see means acting on that OA's followers.
       เห็นเฉพาะของตัวเอง แต่รู้ id แล้วแก้/ลบ/ยิงของคนอื่นได้. */
    await ensureCanWriteBroadcast(user, broadcast['hook_ids'], this.hookModel);
    ensureAssignGroupAccess(user, broadcast.assign_group?.id);

    /**
     * [FEAT-20260822-BCASTSWITCH] The migration branch (แผน §PH.31).
     *
     * ⚠️ EVERYTHING ABOVE THIS LINE IS UNCHANGED — id validation, the lookup,
     *    the soft-delete filter and the assign-group guard all still run first,
     *    for both paths. A new sender that skipped the access guard would be a
     *    security hole wearing a feature's clothes.
     *
     * The old sender stays in place and stays the default. Reverting the
     * migration is flipping `BROADCAST_NEW_PATH_ENABLED` back to `false`, not
     * a deploy. ถอยกลับ = สลับค่าคงที่ ไม่ใช่ deploy ใหม่.
     */
    /* [FEAT-20260823-BCASTSENDKIND] The job decides, not the module. A campaign
       with no `send_kind` — which is every campaign that existed before 23/08 —
       takes the branch below, exactly as it always has.
       งานที่ไม่ได้ตั้ง send_kind = ท่อเดิม ไม่ว่าธงจะเปิดหรือไม่. */
    if (usesNewSendPath(broadcast['send_kind']) && this.newSendPort) {
      const outcome = await this.newSendPort.send(
        broadcast as unknown as Record<string, unknown>,
        // ⚠️ `userId` / `displayName`, not `id` / `name`. tsc caught the guess —
        // the same class of mistake dev-local §4 records for DB columns, and
        // the same fix: open the type, do not remember it.
        { id: user.userId, name: user.displayName },
      );
      const updated = await this.broadcastModel
        .findByIdAndUpdate(
          broadcast._id,
          { status: outcome.status, sent_at: new Date() },
          { new: true },
        )
        .exec();
      return {
        data: this.sanitizeBroadcast(updated),
        results: outcome.results,
      };
    }

    /* The legacy sender moved out on 23/08 — same code, dependencies passed
       instead of read off `this`, so the module and controller were untouched. */
    const { updated, results } = await dispatchBroadcast(
      {
        hookModel: this.hookModel,
        wlog: this.wlog,
        crypto: this.crypto,
        broadcastModel: this.broadcastModel as never,
        logger: this.logger,
        auditLogService: this.auditLogService,
        buildActor,
      },
      broadcast,
      user,
      requestMeta,
    );
    return { data: this.sanitizeBroadcast(updated as never), results };
  }
}
