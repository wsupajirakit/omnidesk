/**
 * [FEAT-20260823-BCASTPREVIEW] What this campaign will actually send.
 * ===========================================================================
 * 🔴 IT CANNOT SEND. Not "does not" — cannot. `runBroadcast` claims the job,
 *    writes a history row and releases the claim on EVERY call; there is no
 *    argument that turns that off, which is why this does not go near it. The
 *    only pieces reused are the ones that BUILD a card. Nothing here holds a
 *    token, and nothing here can reach the dispatcher.
 *    พรีวิวไม่ได้ใช้ท่อส่งเลย ⇒ ส่งหลุดไม่ได้.
 *
 * 🔴 IT MIRRORS THE SENDER THAT IS ACTUALLY RUNNING. `usesNewSendPath()` is
 *    the same question `broadcasts.service.ts` asks before it sends, so the
 *    preview cannot claim one thing while the send does another. Today that
 *    flag is `false`, which means the honest preview shows the LEGACY shape:
 *    raw `{{braces}}` and the hard-coded `altText`. That is ugly, and it is
 *    the point — an admin can see, before sending, that the campaign needs the
 *    flag flipped. A prettier preview would be a lie the admin acts on.
 *    ถ้าพรีวิวสวยกว่าของจริง แอดมินจะเชื่อแล้วยิงออกไป.
 *
 * ⚠️ ONE CARD PER OA, because `hook_*` and `site_rules.*` differ per OA and a
 *    single rendered card cannot represent two of them. `member.*` /
 *    `profile.*` are `N/A` on every one: a broadcast is ONE request that LINE
 *    fans out, so there is nowhere to put a per-person value. The tags that
 *    could not be filled come back in `unknownTags`, which is the only place
 *    an admin is ever told. ค่าเฉพาะคนต้องไป multicast.
 *
 * revert: delete this file, its provider line in `content.module.ts` and the
 * `@Post(':id/preview')` handler. Nothing else refers to it.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { type Model } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { FlexMessage, Hook } from '@/modules/hooks';
import { TranslationDictCacheService } from '@/modules/system';

import {
  SEND_MATRIX,
  OA_VAR_COLUMNS,
  PlainCardMessageBuilder,
  buildOaVarMap,
  readFlexCardBody,
  toTranslateFn,
  type OaVarRow,
} from '../broadcast-send';
/* The legacy builder now lives beside the other payload shapes, not inside the
   service — same function, one import hop shorter, and no cycle back into a
   provider this file must not depend on. */
import { buildLineMessage } from '../broadcast-payload.util';
import { ensureCanReadBroadcast } from '../content-oa-access.util';
/**
 * [FEAT-20260824-BCASTFLEXID] The SCHEMA type, not the DTO.
 *
 * This reads a job back OUT of Mongo, so the honest type is the stored one —
 * where `flex_id` is an ObjectId. The DTO describes what an admin POSTS, and
 * there `flex_id` is a string. The two stopped being interchangeable the moment
 * the field existed, and tsc said so. อ่านของที่เก็บไว้ ⇒ ใช้ type ของ schema.
 */
import type { BroadcastMessage } from '../schemas/broadcast.schema';
import { Broadcast } from '../schemas/broadcast.schema';

import { usesNewSendPath } from './new-path.switch';
import { flexIdOf, resolveSavedCard } from './saved-card';

/**
 * The cell a job's `send_kind` selects — the SAME mapping `new-send.service.ts`
 * uses, kept as one line here rather than exported from a service this file
 * must not depend on. Its only use is reading `maxHooks`.
 */
const cellFor = (sendKind: unknown) =>
  sendKind === 'multicast'
    ? SEND_MATRIX['multicast:plain']
    : SEND_MATRIX['broadcast:plain'];

/** One OA's card, exactly as that OA's followers would receive it. */
export interface PreviewCard {
  readonly hook_id: string;
  readonly hook_name: string;
  /** The LINE message object — hand it straight to a renderer. */
  readonly message: Record<string, unknown>;
  /**
   * Tags that could not be filled and rendered `N/A`.
   *
   * The ONLY channel an admin has for this. They are collected on every send
   * too and nothing displays them there. ที่เดียวที่แอดมินจะรู้ว่า tag ไหนเติมไม่ได้.
   */
  readonly unknownTags: readonly string[];
}

export interface BroadcastPreview {
  /**
   * Which sender this reflects. `legacy` means variables are NOT substituted
   * and `title_detail` is ignored — read it before trusting what you see.
   */
  readonly mirrors: 'new' | 'legacy';
  readonly cards: readonly PreviewCard[];
  /**
   * The job names MORE OAs than one run may reach, so this preview shows the
   * first `maxHooks` of them.
   *
   * Present only when it happened. A silent cap would read as "these are all
   * your OAs", and the send would then refuse the job for a reason the preview
   * never hinted at. ตัดแล้วต้องบอก.
   */
  readonly truncatedToHooks?: number;
}

@Injectable()
export class BroadcastPreviewService {
  constructor(
    @InjectModel(Broadcast.name)
    private readonly broadcastModel: Model<Record<string, unknown>>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<Record<string, unknown>>,
    /**
     * [FEAT-20260824-BCASTFLEXID] The preview resolves the card id the SAME way
     * the sender does, or it shows an admin a card that is not the one that
     * will ship — the exact failure this file's header warns about ("a preview
     * that disagrees with the sender is worse than no preview, because an admin
     * acts on it"). พรีวิวต้องดึงการ์ดจากที่เดียวกับตัวส่ง.
     */
    @InjectModel(FlexMessage.name)
    private readonly flexModel: Model<Record<string, unknown>>,
    private readonly translate: TranslationDictCacheService,
  ) {}

  /**
   * @param sendsNew Which sender to mirror. Defaults — at CALL time — to the
   * same answer `broadcasts.service.ts` gets before it sends, so production
   * passes nothing and cannot drift from the sender.
   *
   * It is a parameter rather than a hidden module read because
   * `usesNewSendPath` already takes this override (`new-path.switch.ts:42`)
   * for the day a per-job `send_kind` decides it. Threading it here means the
   * preview follows that decision the moment it lands, instead of needing a
   * second edit — and it lets both branches be tested without mocking a module
   * the layering rule says not to reach into.
   * ค่าเริ่มต้นอ่านตอนเรียก ⇒ ไม่มีทางต่างจากตัวส่ง.
   */
  async previewBroadcast(
    id: string,
    /* Ordered `(id, user, options)`: the caller identity belongs beside the
       thing being identified, and the flag override is a test/future seam. */
    user?: AuthenticatedUser,
    sendsNew?: boolean,
  ): Promise<BroadcastPreview> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid broadcast identifier');
    }
    const job = await this.broadcastModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .lean()
      .exec();
    if (!job) throw new NotFoundException('Broadcast not found');

    /**
     * [FIX-20260824-BCASTPREVIEWKIND] 🔴 THE JOB'S OWN `send_kind` DECIDES.
     *
     * This used to default to `usesNewSendPath()` with NO ARGUMENT, which asks
     * only the module-wide flag — and that function returns `false` unless it is
     * handed a `send_kind` it recognises. So EVERY preview mirrored the legacy
     * sender, including jobs explicitly saved as `multicast`. The legacy branch
     * then renders from `message.flex_json`, which a job carrying a `flex_id`
     * does not have, so the admin was shown an EMPTY card for a campaign that
     * sends a real one. Measured 24/08 through a real preview call.
     *
     * The parameter's docblock above already called this "a test/future seam …
     * for the day a per-job `send_kind` decides it" — that day arrived on 23/08
     * when `send_kind` landed, and this default was never revisited.
     * พรีวิวถาม flag เฉย ๆ ไม่ได้ถามว่า job ใบนี้ใช้ท่อไหน ⇒ โชว์การ์ดว่างให้แอดมินดู.
     *
     * An explicit argument still wins, so both branches stay testable.
     */
    const mirrorsNew = sendsNew ?? usesNewSendPath(job['send_kind']);

    /* 🔴 A PREVIEW RENDERS REAL CUSTOMER-FACING CONTENT for a specific OA —
       the card, its values, the notification line. Reading it about an OA the
       caller cannot reach discloses exactly what the campaign would say.
       พรีวิวคือเนื้อหาจริงของ OA นั้น ต้องกั้นเท่ากับตัวงาน. */
    if (user) {
      await ensureCanReadBroadcast(
        user,
        job['hook_ids'],
        this.hookModel as never,
      );
    }

    /* [FEAT-20260824-BCASTFLEXID] Same resolution as the sender: the id wins,
       the job's own copy is the pre-feature fallback. */
    const card = await resolveSavedCard(job['message'], (id) =>
      readFlexCardBody(this.flexModel, id),
    );
    if (card === null && flexIdOf(job['message']) !== undefined) {
      /* 🔴 SAY WHICH FAILURE IT IS. "no message to preview" would send an admin
         looking at the campaign when the card is what went missing.
         การ์ดหาย ต้องบอกว่าการ์ดหาย ไม่ใช่บอกว่างานไม่มีข้อความ. */
      throw new BadRequestException(
        'the flex card this broadcast points at no longer exists',
      );
    }
    if (card === null) {
      throw new BadRequestException('this broadcast has no message to preview');
    }

    const hookIds = Array.isArray(job['hook_ids']) ? job['hook_ids'] : [];

    /**
     * 🔴 BOUNDED BY THE SAME CEILING THE SEND USES.
     *
     * `maxHooks` is enforced at RUN time (`run-plan.ts:192`) and NOWHERE at
     * save time — `ensureValidHookIds` only checks the ids exist. So a job can
     * carry a hundred OAs, and an unbounded preview would render a hundred
     * cards that the send would then refuse outright: the heaviest possible
     * answer to a question whose real answer is "this job cannot run".
     * พรีวิวต้องไม่ทำงานหนักกว่าตอนส่งจริง.
     *
     * ⚠️ AND IT SAYS SO — `truncated` rides back rather than the list quietly
     *    being short. A cap nobody is told about reads as "these are all your
     *    OAs". ตัดแล้วต้องบอก ไม่ใช่เงียบ.
     */
    const ceiling = cellFor(job['send_kind']).maxHooks;
    const truncated = hookIds.length > ceiling;

    const rows = (await this.hookModel
      .find({ _id: { $in: hookIds.slice(0, ceiling) } })
      .select({ ...OA_VAR_COLUMNS, line_oa_name: 1 })
      .lean()
      .exec()) as unknown as Array<OaVarRow & { line_oa_name?: unknown }>;

    /**
     * 🔴 THE LEGACY BRANCH RENDERS THROUGH THE LEGACY BUILDER.
     *
     * ⚠️ FIXED THE MOMENT IT WAS WRITTEN: the first draft reported
     *    `mirrors: 'legacy'` and then rendered with the NEW builder anyway —
     *    a preview showing substituted values while the running sender ships
     *    raw braces. A label saying "legacy" does not make a new-path render
     *    honest; only calling the legacy builder does.
     *    ติดป้ายว่า legacy ไม่พอ ต้องเรียกตัวเก่าจริง ๆ.
     *
     * Legacy takes no per-OA anything — one message object for the whole job —
     * so every OA is shown the same card, which is exactly what they get.
     */
    if (!mirrorsNew) {
      const message = buildLineMessage(
        job['message'] as BroadcastMessage | undefined,
      );
      return {
        ...(truncated ? { truncatedToHooks: ceiling } : {}),
        mirrors: 'legacy',
        cards: rows.map((row) => ({
          hook_id: String(row._id),
          hook_name: nameOf(row),
          message,
          /* Legacy substitutes nothing, so there is no such thing as a tag it
             "could not fill" — every tag ships as written, and the braces are
             visible in the card above. Reporting a list here would imply a
             substitution step that does not exist. */
          unknownTags: [],
        })),
      };
    }

    const oaVars = buildOaVarMap(
      rows,
      toTranslateFn(this.translate.translate.bind(this.translate)),
    );

    /* The SAME builder the sink uses, given the SAME map — so what comes back
       is not "like" what would be sent, it is the same bytes. */
    const builder = new PlainCardMessageBuilder(
      card,
      {},
      job['title_detail'],
      oaVars,
    );

    const cards: PreviewCard[] = [];
    for (const row of rows) {
      const hookId = String(row._id);
      const built = builder.messagesFor(undefined, hookId);
      const message = built.messages[0];
      if (message === undefined) continue;
      cards.push({
        hook_id: hookId,
        hook_name: nameOf(row),
        message,
        unknownTags: built.unknownTags,
      });
    }

    return {
      ...(truncated ? { truncatedToHooks: ceiling } : {}),
      mirrors: 'new',
      cards,
    };
  }
}

/** `line_oa_name` is what the dashboard shows an OA as; fall back to the id. */
function nameOf(row: { line_oa_name?: unknown; _id: unknown }): string {
  return typeof row.line_oa_name === 'string' && row.line_oa_name !== ''
    ? row.line_oa_name
    : String(row._id);
}
