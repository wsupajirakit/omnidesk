/**
 * [FEAT-20261016-TOOLMINT] The Custom Tools page's mint buttons — server side.
 * ===========================================================================
 * Owner 16/10/2026 (loan site): one button per company (demo · Acme · Globex).
 *   · env complete ⇒ `mint()` creates the tool HERE, through `CustomToolsService.create` — the
 *     same door as the create form, so the password is encrypted, the config validated and
 *     the audit row written exactly as for a hand-made tool. Then the template's tags are made
 *     sure to exist (`ToolTagBindService` — inserts only; no OA uses the new tool yet).
 *   · env incomplete ⇒ the screen fills the create form from `catalog()` (skeleton, no
 *     credentials) and the admin saves through the ordinary route. `mint()` refuses.
 *
 * 🔴 THE PASSWORD NEVER LEAVES THE SERVER. `catalog()` is `toolMintWire` (key names + base URL
 *    only). `toolMintCredentials` is called in one place — below — and its password goes
 *    straight into `create`, which encrypts before the row is written and never returns it.
 * 🔴 NEVER OVERWRITES. A tool with the company's name already exists — even soft-deleted, whose
 *    name the unique index still holds — ⇒ refused with a message saying which. An admin's
 *    edits to a minted tool are never replaced by a second press.
 * 🔴 ABSENT = TODAY. shop-api declares no mint ⇒ `catalog()` null, `mint()` 404 before any read.
 *
 * revert: delete this folder and its two lines in `hooks.module.ts`.
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { toolMintConfig } from '@/config/app.config';
import {
  providerToolMint,
  toolMintCredentials,
  toolMintWire,
  type ToolMintWire,
} from '@/modules/customer-provider';

import { toIdString } from '../coerce';
import { CustomToolsService } from '../custom-tools.service';
import type { AuditRequestMetaInput } from '../hook-audit-log.service';
import { CustomTool } from '../schemas/custom-tool.schema';
import {
  ToolTagBindService,
  type TagBindReport,
} from '../tool-tag-bind/tool-tag-bind.service';

export interface ToolMintResult {
  tool: unknown;
  tags: TagBindReport;
}

@Injectable()
export class ToolMintService {
  constructor(
    @Inject(toolMintConfig.KEY)
    private readonly config: ConfigType<typeof toolMintConfig>,
    @InjectModel(CustomTool.name) private readonly toolModel: Model<CustomTool>,
    private readonly customTools: CustomToolsService,
    private readonly tagBind: ToolTagBindService,
  ) {}

  /** env key → value, from the validated `LOAN_TOOL_*` slice only */
  private readonly env = (key: string): string | undefined =>
    this.config.values[key];

  /** `GET /api/custom-tool-mint` — null on a site that mints nothing (shop-api). */
  catalog(): ToolMintWire | null {
    return toolMintWire(providerToolMint(), this.env);
  }

  /** `POST /api/custom-tool-mint/:company` */
  async mint(
    companyId: string,
    user: AuthenticatedUser | undefined,
    meta: AuditRequestMetaInput,
  ): Promise<ToolMintResult> {
    const decl = providerToolMint();
    const creds = toolMintCredentials(decl, companyId, this.env);
    if (!creds.ok) {
      if (creds.reason === 'not_declared') {
        throw new NotFoundException('ไซต์นี้ไม่มีปุ่ม mint tool');
      }
      if (creds.reason === 'unknown_company') {
        throw new NotFoundException(`ไม่รู้จักค่าย "${companyId}"`);
      }
      /* `success: false` = a pre-shaped envelope: `AllExceptionsFilter` sends it as-is, so the
         missing KEY NAMES reach the caller (any other object is cut to `{ error }` — found live
         16/10). Key names only, never a value. */
      throw new BadRequestException({
        success: false,
        error: `env ของ ${creds.company.label} ยังไม่ครบ — mint ได้แค่โครง (กรอกที่เหลือในฟอร์มแล้วบันทึก)`,
        missing: creds.missing,
        invalid: creds.invalid,
      });
    }
    if (!decl) throw new NotFoundException('ไซต์นี้ไม่มีปุ่ม mint tool');

    const name = creds.company.toolName;
    /* deleted rows included — the unique index on `name` still holds their name */
    const taken = await this.toolModel
      .findOne({ name })
      .select('_id deleted_at')
      .lean<{ _id: unknown; deleted_at?: Date | null }>()
      .exec();
    if (taken) {
      throw new ConflictException(
        taken.deleted_at
          ? `ชื่อ "${name}" ถูก tool ที่ลบไปแล้วจองไว้ — mint ซ้ำไม่ได้ (สร้างด้วยชื่ออื่นจากโครงแทน)`
          : `มี tool "${name}" อยู่แล้ว — ไม่เขียนทับ (แก้ที่ tool เดิมได้เลย)`,
      );
    }

    const created = await this.customTools.create(
      {
        name,
        description: `${decl.template.description} — ${creds.company.label} (mint)`,
        base_url: creds.baseUrl,
        auth_type: decl.template.tool.auth_type,
        username: creds.username,
        password: creds.password,
        timeout_ms: decl.template.tool.timeout_ms,
        status: true,
        /* the template's endpoints, copied — `create` normalises them like a form save */
        endpoints: decl.template.tool.endpoints.map((e) => structuredClone(e)),
      },
      user,
      meta,
    );
    const toolId = toIdString((created.data as { _id?: unknown } | null)?._id);
    /* the template's tags exist before any OA is switched to the tool */
    const tags = await this.tagBind.bindToolTags(toolId, user, meta);
    return { tool: created.data, tags };
  }
}
