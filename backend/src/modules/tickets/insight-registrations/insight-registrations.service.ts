import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type PipelineStage } from 'mongoose';

import type { AuthenticatedUser } from '@/common';

import { Member, type MemberDocument } from '@/modules/chat';
import { getAllowedHookIds } from '@/modules/hooks';
import { Hook, type HookDocument } from '@/modules/hooks';

import type { RegistrationInsightsQueryDto } from '../dto';
import { parseBangkokDate } from '../insight-reports.service';

/**
 * ==== [FEAT-20260820-REGINSIGHT] registration counts for the insight page ====
 *
 * Feeds the "Register data / ข้อมูลการสมัครสมาชิก" card: two horizontal bars,
 * `member` (self-registered) and `admin` (registered by an operator), counted
 * from members.link_registered_by / link_registered_at (written by
 * customer-link's stampLinkRegistration — the ONLY writer).
 *
 * Owner rules baked in, in the owner's words:
 *  · "นับแค่จำนวน อย่าคิวรี่ member มา" — COUNT ONLY. One aggregate, grouped
 *    counts out; no member document ever leaves the database.
 *  · "system ไม่นับ ช่างมัน ปล่อยเลย" (2026-08-20) — the legacy 'system' value
 *    (pre-rename spelling of 'member') is EXCLUDED, not folded. Widening the
 *    $in below changes what the bars mean; the spec goes red on purpose.
 *  · "filter oa ตามแท็บที่เลือก" — members carry NO hook_id (verified: 0/850),
 *    so OA scoping joins chat_rooms (user_id ↔ member._id). ⚠️ LIVE SHAPE:
 *    chat_rooms.user_id AND chat_rooms.hook_id are ObjectId (verified against
 *    the real dev DB 2026-08-20; a String(_id) join finds NOTHING) — hence the
 *    direct $eq and the ObjectId cast below. Do not "simplify" to strings.
 *
 * Known data reality (not a bug): the stamp fields only exist on members who
 * registered after the stamping feature shipped — 0 rows carried them at the
 * time of building, so the card starts at zero and grows.
 *
 * Placement: own file per the role-folder precedent (create-by-admin/,
 * translate/) — insight-reports.service.ts is already 785 lines and must not
 * grow. No cache wrap on purpose: this is a two-number count over a ~6.9 MB
 * collection; ScopedQueryCacheService would cost more plumbing than the query.
 * No new index either — a members scan is cheap at today's size; an index on
 * link_registered_at is a schema change that needs its own owner approval.
 *
 * 📖 THIS CARD IS ONE OF FOUR PLACES FOLLOW-UP STATE IS VISIBLE, and the only
 * one that answers a question about TOTALS. What the other three answer, and
 * why they disagree with each other without any of them being wrong, is written
 * up in `docs/follow-up-status-spec.md`. The law on the `follow_up` keys this
 * file reads is `src/modules/chat/config/member-config.registry.ts`.
 *
 * revert: delete this folder, the dto, the controller route, the module
 *         provider line and the barrel exports — no data is touched.
 */

/**
 * DESTINATION 3 of 7. The values themselves are declared in
 * `src/modules/customer-link/registration-stamp.helper.ts` — this list says
 * which of them the bars COUNT, which is a different question and an owner
 * decision every time. A value that exists but is not listed here is silently
 * excluded from every total, and no test elsewhere notices.
 *
 * ⚠️ THIS REPORT MUST KNOW `semi_admin`, AND TODAY IT DOES NOT COUNT IT.
 * Owner order 2026-08-21: *"insight report ต้องรู้จัก เผื่อคิวรี่อนาคต"*. The
 * value is reserved in `REGISTERED_BY` and NOTHING WRITES IT YET, so leaving it
 * out of the list below changes no number today — but the day something starts
 * writing it, those registrations vanish from every total with no error, which
 * is exactly the failure this destination is prone to. That is why it is named
 * here and pinned in `z-test/unit/insight-registrations.spec.ts` rather than
 * left to be noticed: the pin fails the moment the list changes, so counting it
 * becomes a decision somebody made instead of one nobody saw.
 *
 * TO START COUNTING IT — three edits, all in this file:
 *   1. add `'semi_admin'` to `COUNTED_SOURCES`
 *   2. add a key to `RegistrationCounts` and map the group in the loop below
 *      (an unmapped group is dropped and `total` would under-count it)
 *   3. `total` is `admin + member` today — decide whether it joins that sum,
 *      and tell the FE, which renders exactly two bars from `data.{member,admin}`
 * ⚠️ A wider `$in` alone is NOT enough: the group would be fetched and thrown
 * away. All three, or none.
 *
 * The two values the bars mean. 'system' is legacy-and-ignored by owner order.
 */
const COUNTED_SOURCES = ['admin', 'member'] as const;

export interface RegistrationCounts {
  admin: number;
  member: number;
  /**
   * [FEAT-20260821-REGBOTASSIST] an admin finished it, but the BOT had already
   * chased this customer — `config.follow_up.line.request_reg_at` is stamped.
   *
   * ⭐ [DOC-20260825-REGSTATUS] THIS USE OF THE STAMP IS CORRECT — DO NOT
   * "FIX" IT TO READ `raw_profile_data`. The rule written in
   * `chat/config/member-config.registry.ts` says a `follow_up` stamp must never
   * answer "has this customer registered?". This bucket asks a DIFFERENT
   * question: "was this customer ever chased by the bot?" — which is exactly
   * what a RECORD is for, and the only key that can answer it, because nothing
   * clears it. Registration status here comes from `link_registered_by`, a
   * separate column; the stamp only splits an already-registered population in
   * two. Swapping in a profile check would make every row read
   * `admin_bot_assisted` (they all have a profile — they registered) and the
   * card would silently report that the bot assisted 100% of registrations.
   *
   * Owner, 21/08: *"สมัครโดยแอดมิน เปลี่ยนเงื่อนไข 'admin' และ request_reg_at ต้องไม่มีค่า
   * /// label ใหม่ สมัครโดย Bot ช่วย Admin = 'admin' + request_reg_at มีค่า"*
   *
   * ⚠️ THE `admin` BUCKET IS NOW NARROWER THAN IT WAS. Anyone comparing this
   * card against a number taken before 21/08 is comparing two different
   * questions: `admin` used to mean "an admin did it", it now means "an admin
   * did it and nobody had chased them". The sum of the two is the old figure.
   *
   * ── TWO WAYS A MEMBER ROW CAN CHANGE UNDER THIS CARD, AND ONLY ONE MOVES IT
   * Worth stating because both are documented failure modes elsewhere in the
   * system, and exactly one of them reaches this report.
   *
   * ① AN ADMIN WIPES THE PROFILE — this card does not notice, and that is
   *    correct. The developer-only remove button (`chat/members.service.ts` →
   *    `clearRawProfile`) `$unset`s `raw_profile_data` and stamps
   *    `raw_profile_cleared_at`; it does NOT touch `link_registered_by` or
   *    `link_registered_at`. So a wiped member keeps their bar.
   *    ⭐ THIS IS THE HOLE THAT BITES EVERY "has no profile" CHECK IN THE
   *    CODEBASE — a customer who really did register reads as unregistered
   *    afterwards, and a chase-them campaign reaches them again
   *    ([DOC-20260825-REGSTATUS] PART 2 in the registry). This report is immune
   *    for one reason only: it never asks about the profile. It asks about
   *    `link_registered_by`, a column that records WHO REGISTERED THEM, and a
   *    wipe is not an unregistration. ⇒ Do not "improve" this card by adding a
   *    profile check; that would import a bug it does not currently have.
   *
   * ② THE CUSTOMER UNLINKS — the row LEAVES this card entirely, and that is
   *    also correct, but it means something specific: `customer-link.service.ts`
   *    `$unset`s `link_registered_by` and `link_registered_at` along with the
   *    profile, so the `$in` at the top of the pipeline stops matching.
   *    ⇒ THESE BARS COUNT LINKS THAT EXIST TODAY, NOT REGISTRATIONS THAT EVER
   *      HAPPENED. A month-on-month comparison drifts downwards as people
   *      unlink, with nothing in the numbers to say so.
   *    ⚠️ The split itself survives that: `request_reg_at` is a RECORD and is
   *      deliberately kept through an unlink, so a member who unlinks and
   *      registers again lands back in `admin_bot_assisted` rather than in
   *      `admin` — the bot really did chase them once, and the key is the only
   *      thing left that remembers it.
   */
  admin_bot_assisted: number;
  total: number;
}

@Injectable()
export class InsightRegistrationsService {
  constructor(
    @InjectModel(Member.name)
    private readonly memberModel: Model<MemberDocument>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
  ) {}

  async getRegistrationCounts(
    queryDto: RegistrationInsightsQueryDto,
    auth?: AuthenticatedUser | null,
  ): Promise<Record<string, unknown>> {
    const allowedHookIds = await getAllowedHookIds(auth, this.hookModel);

    // Same fail-closed short-circuit as getTicketInsights: no OA scope ⇒
    // answer "no access", never a global number a scoped operator shouldn't see.
    if (allowedHookIds !== null && allowedHookIds.length === 0) {
      return { success: true, data: null, scope: 'no_oa_access' };
    }

    let scope: string[] | null = allowedHookIds;
    if (queryDto.line_oa_hook_id) {
      if (
        allowedHookIds !== null &&
        !allowedHookIds.includes(queryDto.line_oa_hook_id)
      ) {
        throw new ForbiddenException('insufficient OA access');
      }
      scope = [queryDto.line_oa_hook_id];
    }

    // Garbage hook id ⇒ zero matches by definition; answer zeros without
    // spending a query (and without a 500 the FE would surface as a broken card).
    const scopeObjectIds =
      scope === null
        ? null
        : scope
            .filter((id) => Types.ObjectId.isValid(id))
            .map((id) => new Types.ObjectId(id));
    if (scopeObjectIds !== null && scopeObjectIds.length === 0) {
      return this.answer({
        admin: 0,
        member: 0,
        admin_bot_assisted: 0,
        total: 0,
      });
    }

    const match: Record<string, unknown> = {
      link_registered_by: { $in: [...COUNTED_SOURCES] },
    };
    const gte = parseBangkokDate(queryDto.from, queryDto.start_time, false);
    const lte = parseBangkokDate(queryDto.to, queryDto.end_time, true);
    if (gte || lte) {
      match['link_registered_at'] = {
        ...(gte ? { $gte: gte } : {}),
        ...(lte ? { $lte: lte } : {}),
      };
    }

    const pipeline: PipelineStage[] = [{ $match: match }];
    if (scopeObjectIds !== null) {
      pipeline.push(
        {
          $lookup: {
            from: 'chat_rooms',
            let: { memberId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$user_id', '$$memberId'] },
                  hook_id: { $in: scopeObjectIds },
                },
              },
              { $limit: 1 },
              { $project: { _id: 1 } },
            ],
            as: 'oa_rooms',
          },
        },
        { $match: { 'oa_rooms.0': { $exists: true } } },
      );
    }
    /* [FEAT-20260821-REGBOTASSIST] the `admin` rows split in TWO, and the split
       happens HERE — in `$group`, not in `$match`.
       =====================================================================
       WHY NOT `$match`: splitting there means two aggregations over the same
       collection, and `total` then has to be stitched together from two
       results — which is exactly where a row gets counted twice or lost. The
       `$in` above stays `['admin','member']`, so every row that counted before
       still counts; only the LABEL it lands under is decided here.

       WHY `request_reg_at` IS THE RIGHT SIGNAL: it is stamped once, when the
       bot opened a case to chase this customer (scenario A), and NOTHING ever
       clears it — see the CONSUMERS table in `chat/config/member-config.registry.ts`.
       So "was this customer ever chased" is answerable long after they
       registered, which is the whole reason that key exists.
       `follow-up.keys.ts:40-43` says it is for COUNTING, never for a decision —
       and counting is exactly what this is.

       ⚠️ "NO VALUE" MEANS MISSING **OR** NULL. Measured on 21/08 the field is
       only ever `date` or absent — but the `config` bag deliberately has no
       schema default and nothing stops a null being written one day. A rule
       that only checked for `missing` would, that day, file a customer nobody
       ever chased under "the bot helped". ไม่มีคีย์ กับ เป็น null ต้องนับเหมือนกัน.

       revert: put back `_id: '$link_registered_by'` and drop the
       `admin_bot_assisted` key from `RegistrationCounts` and the loop below. */
    pipeline.push({
      $group: {
        _id: {
          $cond: [
            { $ne: ['$link_registered_by', 'admin'] },
            '$link_registered_by',
            {
              $cond: [
                {
                  $in: [
                    { $type: '$config.follow_up.line.request_reg_at' },
                    ['missing', 'null'],
                  ],
                },
                'admin',
                'admin_bot_assisted',
              ],
            },
          ],
        },
        count: { $sum: 1 },
      },
    });

    const groups = (await this.memberModel
      .aggregate(pipeline)
      .exec()) as Array<{
      _id: string;
      count: number;
    }>;

    const counts: RegistrationCounts = {
      admin: 0,
      member: 0,
      admin_bot_assisted: 0,
      total: 0,
    };
    for (const group of groups) {
      if (group._id === 'admin') counts.admin = group.count;
      if (group._id === 'member') counts.member = group.count;
      // [FEAT-20260821-REGBOTASSIST] a group that is fetched but not mapped is
      // dropped, so this line is what stops the split from LOSING rows rather
      // than relabelling them.
      if (group._id === 'admin_bot_assisted') {
        counts.admin_bot_assisted = group.count;
      }
      // anything else ('system', future values) is deliberately dropped here
    }
    /* All three are successful registrations, so all three are in the total —
       the card prints "รวมทั้งหมด" under the three rows, and a total that left
       one out would read as an arithmetic bug to whoever is looking at it.
       Owner confirmed 21/08. */
    counts.total = counts.admin + counts.member + counts.admin_bot_assisted;
    return this.answer(counts);
  }

  private answer(counts: RegistrationCounts): Record<string, unknown> {
    return { success: true, data: { ...counts } };
  }
}
