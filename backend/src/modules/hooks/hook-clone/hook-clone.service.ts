import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';

import { SENSITIVE_FIELDS } from '@/infra/crypto';

import { HookAuditLogService } from '../hook-audit-log.service';
import { HookCacheService } from '../hook-cache.service';
import { Hook } from '../schemas/hook.schema';
import { HooksService, type RequestContext } from '../hooks.service';
import type * as W from '../hook-write.helpers';

import { buildClonePatch } from './clone-merge';

/**
 * ==== [FEAT-20260818-CLONEFULL] POST /hook/:id/duplicate ========================
 *
 * เส้น **create-from-clone แยกของตัวเอง** ตามที่ตกลง: ปุ่ม Copy Item จะสร้าง OA ใหม่
 * ผ่านเส้นนี้ แล้วค่าที่ฟอร์มคัดลอกไม่ได้ (creds ที่ถูก mask + ข้อมูลที่ระบบดึงมาเก็บ)
 * ถูกเติมจาก **id ของ OA ต้นทาง** ที่ฝั่ง server ⇒ คีย์ไม่ต้องวิ่งออกไปที่เบราว์เซอร์เลย
 *
 * ## ทำไมเป็นไฟล์/เส้นแยก ไม่ใส่เงื่อนไขใน `createHook`
 * `createHook` เป็นทางเดินของการสร้าง OA ทุกใบและมีเทส/parity ผูกอยู่เต็ม — การแทรก
 * สาขา clone เข้าไปคือความเสี่ยงต่อของที่ไม่เกี่ยวกัน · เส้นนี้จึง **เรียกของเดิมตามปกติ**
 * (การตรวจ ตรวจสิทธิ์ เข้ารหัส ทั้งหมดยังเป็นชุดเดิมเป๊ะ) แล้วค่อยเติมส่วนที่ขาดเป็น
 * `$set` ก้อนเดียวหลังจากนั้น ⇒ ถ้าลบโฟลเดอร์นี้ทิ้ง พฤติกรรมกลับไปเท่าเดิมทั้งหมด
 *
 * ## ไม่แตะงาน creds
 * ไม่แตะ mask/sentinel/`SENSITIVE_FIELDS` · ค่าลับคัดลอก **ตามที่เก็บไว้** (ciphertext →
 * ciphertext) ไม่ถอดรหัส ไม่เข้ารหัสซ้ำ — วิธีเดียวกับ `cloneHookSettings` ที่มีอยู่แล้ว
 *
 * ## สิทธิ์
 * ตรวจด้วยการเรียก `getHookById(sourceId, user)` ของเดิมก่อนคัดลอกทุกครั้ง — เส้นนั้น
 * บังคับ "อยู่ในกลุ่มของ hook นั้น" + "ต้องมี hook.manage" อยู่แล้ว (`hooks.service.ts:562-588`)
 * ⇒ กฎเดียวกับหน้าจอ edit/clone ไม่มีการเขียนกฎสิทธิ์ชุดใหม่ให้เพี้ยนกัน
 *
 * revert: ลบโฟลเดอร์ `hook-clone/` + provider ใน hooks.module.ts + route ใน
 *         hooks.controller.ts (tag เดียวกัน) + ฝั่ง FE ที่เรียก duplicateHook
 */
@Injectable()
export class HookCloneService {
  private readonly logger = new Logger(HookCloneService.name);

  constructor(
    @InjectModel(Hook.name) private readonly hookModel: Model<Hook>,
    private readonly hooks: HooksService,
    private readonly hookCache: HookCacheService,
    private readonly auditLog: HookAuditLogService,
  ) {}

  /**
   * สร้าง OA ใหม่จากต้นทาง แล้วเติมค่าที่ฟอร์มส่งมาไม่ได้
   *
   * @param sourceId  id ของ OA ที่กด Copy Item
   * @param body      payload เดียวกับที่ `POST /hook` รับ (ค่าที่ผู้ใช้กรอกในฟอร์ม)
   */
  async createFromSource(
    sourceId: string,
    body: W.FieldBag,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(sourceId)) {
      throw new BadRequestException('invalid hook id');
    }

    // สิทธิ์ + การมีอยู่จริงของต้นทาง: ใช้กฎของเส้นอ่านเดิม (โยน 404/403 เองตามเดิม)
    await this.hooks.getHookById(sourceId, ctx.user);

    // ค่าที่ต้องคัดลอกต้องเป็น "ตามที่เก็บไว้" จึงอ่านเอกสารดิบ ไม่ใช่ตัวที่ถูก mask
    const source = await this.hookModel
      .findById(sourceId)
      .lean<Record<string, unknown>>()
      .exec();
    if (!source) throw new BadRequestException('source hook not found');

    /**
     * ทางเดินสร้างของเดิม ไม่ดัดแปลงอะไร — `clone_from` ถ้ามีติดมาก็ถูกทิ้งตามเดิม
     * (มันเป็นแค่ป้ายบอกที่มาในเวอร์ชันก่อนหน้า)
     */
    const created = await this.hooks.createHook(body, ctx);
    const createdId = created['_id'];
    if (!createdId) return created;

    const fresh = await this.hookModel
      .findById(createdId)
      .lean<Record<string, unknown>>()
      .exec();
    if (!fresh) return created;

    const report = buildClonePatch(fresh, source, SENSITIVE_FIELDS);
    const patchKeys = Object.keys(report.patch);
    if (patchKeys.length === 0) {
      this.logger.log(
        `[CLONEFULL] ${String(created['alias'])} — ไม่มีอะไรต้องเติมจาก ${String(source['alias'])}`,
      );
      return created;
    }

    await this.hookModel.updateOne({ _id: createdId }, { $set: report.patch });

    /**
     * เขียนทับ cache ด้วยแถวหลังเติมค่า — webhook อ่าน `channel_secret` จาก cache
     * ถ้าไม่ทำ OA ใหม่จะยังตรวจ signature ด้วยแถวที่ยังไม่มี secret จนกว่า TTL หมด
     * alias ไม่เปลี่ยน จึงไม่ต้อง evict คีย์เก่า
     */
    const merged = await this.hookModel
      .findById(createdId)
      .lean<Record<string, unknown>>()
      .exec();
    if (merged) await this.hookCache.cacheHook(merged as never);

    // log ชื่อ field เท่านั้น — ห้ามให้ค่าลับโผล่ใน log
    this.logger.log(
      `[CLONEFULL] ${String(created['alias'])} ← ${String(source['alias'])} · ` +
        `creds สืบทอด ${report.inherited.length} (${report.inherited.join(',') || '-'}) · ` +
        `เติม ${report.copied.length} · คงค่าเดิมตรงบิต ${report.preserved.length}`,
    );

    /* [FIX-20260818-CLONEAIPAIR] ถ้าผู้ใช้สลับ vendor ตอน copy ช่องคีย์ของ OA ใหม่จะ
       ว่างโดยตั้งใจ — บอกไว้ในบรรทัดเดียว ไม่งั้นจะถูกอ่านว่า "คัดลอกไม่ครบ" */
    if (report.skipped.length) {
      this.logger.warn(
        `[CLONEAIPAIR] ${String(created['alias'])} สลับค่าย AI ระหว่าง copy ⇒ ไม่สืบทอด ` +
          `${report.skipped.join(',')} · แอดมินต้องใส่คีย์ของค่ายใหม่เอง ` +
          `(กันคีย์ค่ายเดิมหลุดไปอีกค่าย)`,
      );
    }

    this.auditLog.writeInBackground(
      {
        ref_id: createdId,
        hook_id: createdId,
        group_id: fresh['group'] ?? null,
        parent: 'hook',
        action: 'clone',
        changed_fields: [
          ...report.inherited.map((field) => ({
            field,
            from: null,
            to: '[copied from source]',
          })),
          ...report.copied.map((field) => ({
            field,
            from: null,
            to: '[copied from source]',
          })),
        ],
        /* กฎเดียวกับ buildActor ของเส้นเดิม (hooks.service.ts:955-962) — actor
           เป็น required ใน AuditLogInput จึงต้องมีค่า fallback 'system' */
        actor: {
          user_id: ctx.actorUserId || ctx.user?.userId || 'system',
          username:
            ctx.actorUsername ||
            ctx.user?.username ||
            ctx.actorUserId ||
            ctx.user?.userId ||
            'system',
          display_name: ctx.actorDisplayName || ctx.user?.displayName,
        },
        request_meta: {
          request_id: ctx.requestId,
          ip: ctx.ip,
          user_agent: ctx.userAgent,
        },
        note: `duplicated from ${
          typeof source['alias'] === 'string' ? source['alias'] : sourceId
        }`,
      },
      'audit log clone failed',
    );

    /**
     * ⚠️ คืน `created` ตัวเดิมเท่านั้น — **ห้าม** ผสม `report.patch` เข้าไป เพราะ patch
     * มี ciphertext ของ creds อยู่ และค่านี้จะถูกส่งกลับไปที่เบราว์เซอร์ (จุดที่ทั้ง
     * ระบบตั้งใจกันไว้ตั้งแต่ต้น) · FE ต้องการแค่ _id/alias เพื่อพาไปหน้าถัดไป
     * ถ้าต้องการค่าที่เติมแล้ว ให้เรียก GET /hook/:id ซึ่ง mask ให้เรียบร้อยแล้ว
     */
    return created;
  }
}
