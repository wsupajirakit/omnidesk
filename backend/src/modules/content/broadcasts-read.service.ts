/**
 * [FEAT-20260823-BCASTSVCSPLIT] Reading broadcasts. Writing lives next door.
 * ===========================================================================
 * MOVED, NOT CHANGED — every member below is what it was inside
 * `BroadcastsService`, which has been over the 400-line ratchet since before
 * this work and grew with it. The waiver list may ONLY SHRINK
 * (dev-local §6.1), so a file past the line gets split, never waived.
 *
 * 🔴 THE CUT IS READ vs WRITE, not "whatever reaches the number". Reading
 *    answers "what is there" and touches nothing; the other half creates,
 *    edits, deletes and SENDS to real customers. Two jobs with very different
 *    blast radii were sharing one class, and the line count is what finally
 *    forced the point. แยกตามหน้าที่ ไม่ใช่ตัดให้พอดีตัวเลข.
 *
 * ⚠️ NO BEHAVIOUR CHANGE IS INTENDED. The suite that covered these paths
 *    before the move is the one that must pass after it — anything red is a
 *    mistake in the move, not a discovery.
 *
 * ⚠️ EXTRACTED BY LINE SPAN, not by searching for a marker: `listBroadcasts`
 *    carries no docblock, so a naive "cut back to the previous /**" swallowed
 *    two neighbouring methods on the first attempt. Each span was verified to
 *    contain exactly one member before anything was written.
 *    marker ที่ซ้ำได้ = ตัดกินของข้างเคียง.
 *
 * revert: paste the members back into `BroadcastsService`, drop this provider
 * from `content.module.ts` and the controller.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import mongoose, { type Connection, type Model } from 'mongoose';

import { isSuperUser, type AuthenticatedUser } from '@/common';
import { Hook, getAllowedHookIds, type HookDocument } from '@/modules/hooks';

import { AUDIENCE_SOURCES } from './audience';
import { GUARD_WINDOW_SOURCE_KEYS } from './audience/sources/guard-window.policy';
import {
  ensureCanReadBroadcast,
  ensureHookAccess,
} from './content-oa-access.util';
import {
  STATUS_VALUES,
  sanitizeBroadcastRow,
  type SanitizedBroadcast,
} from './broadcast-payload.util';
import {
  NO_ACTOR_NAMES,
  resolveActorNames,
  type ActorNames,
} from './content-actor-names.util';
import { Broadcast, type BroadcastDocument } from './schemas/broadcast.schema';
/* [FEAT-20260828-JOBSEARCH] ขั้นต่ำของคำค้น มาจากแหล่งเดียวกับหน้าประวัติ
   ⚠️ ห้ามเขียนเลข 4 ซ้ำที่นี่ — สองหน้าต้องเปลี่ยนพร้อมกันเสมอ */
import { MIN_SEARCH_CHARS } from '@/modules/system/webhook-log.service';

@Injectable()
export class BroadcastsReadService {
  constructor(
    @InjectModel(Broadcast.name)
    private readonly broadcastModel: Model<BroadcastDocument>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    /**
     * `users` comes from the CONNECTION, not DI — registering `UserSchema`
     * here closes an import cycle with `@/modules/admin`, measured on 23/08.
     * Same reasoning, same shape as `broadcasts.service.ts`.
     */
    @InjectConnection()
    private readonly connection?: Connection,
  ) {}

  /**
   * ⚠️ MUST NOT THROW. A list that refuses to load because a NAME could not be
   * resolved is a worse answer than one showing ids.
   */
  private get userModel(): Model<Record<string, unknown>> | undefined {
    try {
      return this.connection?.model<Record<string, unknown>>('User');
    } catch {
      return undefined;
    }
  }

  public sanitizeBroadcast(
    broadcast: BroadcastDocument | null,
    names: ActorNames = NO_ACTOR_NAMES,
  ): SanitizedBroadcast | null {
    return sanitizeBroadcastRow(broadcast, names);
  }

  private parseSort(sort?: string): Record<string, 1 | -1> {
    if (!sort) return { created_at: -1 };
    const [field, direction] = String(sort).split(':');
    if (!field) return { created_at: -1 };
    return { [field]: direction === 'asc' ? 1 : -1 };
  }

  public async listBroadcasts(
    user: AuthenticatedUser,
    query: Record<string, string | undefined>,
  ): Promise<{
    data: Array<SanitizedBroadcast | null>;
    meta: { total: number; page: number; limit: number };
  }> {
    const page = Math.max(Number(query['page']) || 1, 1);
    const limit = Math.min(Math.max(Number(query['limit']) || 25, 1), 200);
    const filters: Record<string, unknown> = { deleted_at: { $exists: false } };

    if (!isSuperUser(user)) {
      const assignGroupIds = Array.isArray(user.groups)
        ? user.groups.filter((id) => mongoose.isValidObjectId(id))
        : [];
      if (assignGroupIds.length === 0) {
        throw new ForbiddenException('group access is required');
      }
      /**
       * [FEAT-20260825-MULTIGROUP] อ่านสองคีย์ ไม่ใช่คีย์เดียว
       *
       * 🔴 นี่คือบรรทัดที่ทำให้แถวเก่าไม่หาย · แคมเปญที่เขียนก่อน 25/08 มีแต่
       *    `assign_group.id` ส่วนของใหม่มี `assign_group_ids` ⇒ ถ้ากรองคีย์เดียว
       *    ฝั่งใดฝั่งหนึ่งจะหายไปจากหน้าจอ **โดยไม่มี error** และไม่มีใครรู้
       *    ⚠️ `assign_group_ids` เป็นตัวหลัก ส่วนคีย์เดิมอยู่เพื่อแถวเก่าเท่านั้น
       *
       * ⚠️ `$or` ต้องอยู่ใน `$and` ร่วมกับตัวกรองอื่น ๆ ที่อาจถูกใส่ทีหลัง —
       *    วางเป็น `filters['$or']` ตรง ๆ ปลอดภัยตราบใดที่ไม่มีใครใส่ `$or`
       *    ตัวที่สอง (ตรวจแล้ว 25/08: ไม่มี) ถ้าวันหนึ่งมี ต้องย้ายไป `$and`
       */
      filters['$or'] = [
        { 'assign_group.id': { $in: assignGroupIds } },
        { assign_group_ids: { $in: assignGroupIds } },
      ];
    }

    if (query['status'] && STATUS_VALUES.has(query['status'])) {
      filters['status'] = query['status'];
    }

    if (query['hook_id']) {
      if (!mongoose.isValidObjectId(query['hook_id'])) {
        throw new BadRequestException('Invalid hook identifier');
      }
      await ensureHookAccess(user, query['hook_id'], this.hookModel);
      filters['hook_ids'] = query['hook_id'];
    } else if (!isSuperUser(user)) {
      const allowedHookIds = await getAllowedHookIds(user, this.hookModel);
      if (Array.isArray(allowedHookIds)) {
        filters['hook_ids'] = { $in: allowedHookIds };
      }
    }

    if (
      query['target_mode'] &&
      (query['target_mode'] === 'all' || query['target_mode'] === 'group')
    ) {
      filters['target.mode'] = query['target_mode'];
    }
    if (query['group_id'] && mongoose.isValidObjectId(query['group_id'])) {
      filters['target.group_ids'] = query['group_id'];
    }

    /**
     * [FEAT-20260828-JOBSEARCH] ค้นแคมเปญด้วย **ชื่อ หรือ id ของงาน**
     *
     * เจ้าของ 28/08: *"หน้าหลักด้วย search job ด้วย id ได้ (ทั้งประวัติและ job
     * search job id ได้)"*
     *
     * 🔴 ใช้ `$and` **ห้ามใช้ `filters['$or']`** — บล็อกขอบเขตกลุ่มด้านบนจอง
     *    `$or` ไปแล้วสำหรับผู้ใช้ที่ไม่ใช่ superuser · เขียนทับเมื่อไหร่ ขอบเขต
     *    สิทธิ์จะหายไปเงียบ ๆ และผู้ใช้จะเห็นแคมเปญของกลุ่มอื่น
     *    ⇒ นี่คือสิ่งที่คอมเมนต์ของบล็อกนั้นเตือนไว้เองว่า "ถ้าวันหนึ่งมี `$or`
     *      ตัวที่สอง ต้องย้ายไป `$and`" · วันนั้นคือวันนี้
     *
     * 🔴 `_id` เป็น ObjectId ⇒ เทียบตรงตัวเมื่อเป็น hex24 เท่านั้น
     *    `$regex` กับคอลัมน์ ObjectId แมตช์ศูนย์แถวเสมอ — บทเรียนเดียวกับ
     *    `[FIX-20260828-LOGSEARCHID]` ในหน้าประวัติ
     * ⚠️ `new ObjectId()` โยนเมื่อรูปไม่ใช่ hex24 ⇒ ต้องเช็ครูปก่อน ไม่งั้น
     *    การพิมพ์ค้นตามปกติจะทำให้ทั้งคำขอ 500 แทนที่จะแค่หาไม่เจอ
     * ⚠️ หนีอักขระ regex ทุกตัว — คำค้นมาจากผู้ใช้ · `a(b` ปล่อยดิบ Mongo โยนทั้งคำขอ
     */
    /* ขั้นต่ำ 4 ตัวอักษร — ตัวเลขเดียวกับหน้าประวัติ (`MIN_SEARCH_CHARS`)
       สองหน้านี้ผู้ใช้คนเดียวกันสลับไปมา · กติกาต่างกันเมื่อไหร่คือความประหลาดใจ
       และคำสั้นก็แทบไม่กรองอะไรแต่ยังบังคับสแกนทั้งชุด */
    const needle = (query['search'] ?? '').trim();
    if (needle.length >= MIN_SEARCH_CHARS) {
      const safe = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const byName = { name: { $regex: safe, $options: 'i' } };
      const searchOr: Record<string, unknown>[] = [byName];
      if (
        mongoose.isValidObjectId(needle) &&
        /^[0-9a-fA-F]{24}$/.test(needle)
      ) {
        searchOr.push({ _id: new mongoose.Types.ObjectId(needle) });
      }
      const existing = filters['$and'];
      filters['$and'] = [
        ...(Array.isArray(existing) ? existing : []),
        { $or: searchOr },
      ];
    }

    const sortOrder = this.parseSort(query['sort']);
    const [total, rows] = await Promise.all([
      this.broadcastModel.countDocuments(filters),
      this.broadcastModel
        .find(filters)
        .sort(sortOrder)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    /* ONE lookup for the whole page — resolving per row would be an N+1 on
       `users` every time the list loads. ต่อหน้า ไม่ใช่ต่อแถว. */
    const names = await resolveActorNames(
      this.userModel,
      rows as unknown as Array<Record<string, unknown>>,
    );

    return {
      data: rows.map((r) => this.sanitizeBroadcast(r, names)),
      meta: { total, page, limit },
    };
  }

  /**
   * [FEAT-20260823-BCASTSOURCES] What the admin may filter recipients by.
   *
   * Read straight off `AUDIENCE_SOURCES` — the same table `buildAudienceFilter`
   * consults — so a condition added there appears on the screen without a
   * deploy of the dashboard, and cannot appear on the screen without existing
   * in the filter. เพิ่มเงื่อนไขที่ทะเบียนเดียว ได้ทั้งสองฝั่ง.
   *
   * ⚠️ `path` is deliberately NOT exposed. It is the Mongo column, and a form
   *    that knows it invites a caller to send one — which is the arbitrary-path
   *    query the registry exists to prevent (§0c.3). The `key` is the contract.
   *    ห้ามส่ง path ออกไป ไม่งั้นจะมีคนยิง path เองแล้วทะเบียนก็ไร้ความหมาย.
   */
  public listAudienceSources(): {
    data: Array<{
      key: string;
      label_th: string;
      label_en: string;
      type: string;
      ops: readonly string[];
      requires_hook_scope: boolean;
      indexed: boolean;
      /**
       * [FEAT-20260823-BCASTAUDFE] Retired, but still referenced by live jobs.
       *
       * 🔴 ADDED because the registry's own rule — "set `deprecated` instead of
       * deleting an entry that live jobs still reference" — did nothing at the
       * only place it matters. The flag was stored and never sent, so the form
       * would keep offering a retired field as a fresh choice and the
       * deprecation existed on the server alone.
       * ตั้งธงไว้แล้วไม่ส่งออกไป = เลิกใช้แต่ไม่มีใครรู้.
       */
      deprecated?: boolean;
    }>;
  } {
    return {
      data: Object.values(AUDIENCE_SOURCES).map((s) => ({
        key: s.key,
        label_th: s.label_th,
        label_en: s.label_en,
        type: s.type,
        ops: s.ops,
        requires_hook_scope: s.scope_by_hook,
        indexed: s.indexed,
        /* Absent when it is not deprecated — the field only ever appears to
           say "stop offering this", never to say "this one is fine". */
        ...('deprecated' in s && s.deprecated ? { deprecated: true } : {}),
        /* [FEAT-2708-GUARDWINDOW] which sources the per-job freshness window
           governs — the policy file owns the set, FE only ever reads this flag
           (never its own list: one owner, no seam to drift). Absent = not
           governed, same absent-means-no shape as `deprecated` above. */
        ...(GUARD_WINDOW_SOURCE_KEYS.includes(s.key)
          ? { guard_window: true }
          : {}),
        /* [FEAT-2708-GUARDWINDOW] which sources the per-job freshness window
           governs — the policy file owns the set, FE only ever reads this flag
           (never its own list: one owner, no seam to drift). Absent = not
           governed, same absent-means-no shape as `deprecated` above. */
      })),
    };
  }

  public async getBroadcastById(
    id: string,
    /**
     * [FIX-20260823-BCASTOASCOPE] Optional so the signature stays compatible
     * with callers that have no user in hand — but the CONTROLLER always
     * passes one, and without it there is no scoping to apply. A default of
     * `undefined` here means "no user known", not "superuser".
     */
    user?: AuthenticatedUser,
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

    /* 🔴 THE LIST NARROWS BY OA AND THIS DID NOT. An operator scoped to one OA
       saw only their own jobs and could open anybody else's by pasting the id.
       Same rule as the list: readable when ANY hook is reachable, so a job
       that appears in the list never 403s on open. */
    if (user) {
      await ensureCanReadBroadcast(user, broadcast['hook_ids'], this.hookModel);
    }

    /* One row, so one lookup of at most two ids. */
    const names = await resolveActorNames(this.userModel, [
      broadcast as unknown as Record<string, unknown>,
    ]);
    const sanitized = this.sanitizeBroadcast(broadcast, names);
    if (!sanitized) throw new NotFoundException('Broadcast not found');
    return sanitized;
  }
}
