/**
 * [FIX-20260823-BCASTOASCOPE] Knowing an id must not be access.
 * ===========================================================================
 * 🔴 SIX ENDPOINTS TOOK A BROADCAST ID AND NONE OF THEM CHECKED THE OA.
 *    `broadcast.manage` says an account may manage broadcasts; it says nothing
 *    about WHICH. Only `listBroadcasts` narrowed by OA — so an operator scoped
 *    to one OA saw only their own jobs, and could then open, preview, read the
 *    run history of, EDIT, DELETE or SEND anybody else's by pasting the id.
 *    The list looked like a boundary and was only a filter.
 *    เห็นเฉพาะของตัวเอง แต่รู้ id แล้วเปิด/แก้/ลบ/ยิงของคนอื่นได้.
 *
 * 🔴 THE WHOLE SUITE WAS GREEN THROUGH ALL OF IT. 774 broadcast tests and not
 *    one asked "may this person touch this row" — every fixture was a
 *    superadmin, for whom scoping does not apply. A permission everybody in
 *    the tests holds is a permission nothing tests.
 *    fixture เป็น superadmin หมด ⇒ ไม่มีเทสไหนแตะเรื่องนี้เลย.
 *
 * 🔴 TWO RULES, AND THEY DIFFER ON PURPOSE:
 *    READ  → ANY hook reachable, matching `listBroadcasts` (`$in` matches when
 *            one element does). Stricter would show a job in the list and 403
 *            it on open, which is worse than the bug being fixed.
 *    WRITE → EVERY hook reachable. Editing or sending a job that also reaches
 *            an OA you cannot see means acting on that OA's followers.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ForbiddenException } from '@nestjs/common';

import type { AuthenticatedUser } from '@/common';
import {
  ensureCanReadBroadcast,
  ensureCanWriteBroadcast,
} from '@/modules/content';

const OA_MINE = 'a0d00000000000000000002e';
const OA_THEIRS = 'a0d00000000000000000003a';

/** An operator whose `allowedHooks` names exactly one OA. */
const scoped = {
  userId: 'op-1',
  roleName: 'operator',
  allowedHooks: [OA_MINE],
} as unknown as AuthenticatedUser;

const superadmin = {
  userId: 'admin-1',
  roleName: 'superadmin',
} as unknown as AuthenticatedUser;

/** `getAllowedHookIds` falls back to the group tier; nothing extra is needed. */
const hookModel = {
  find: () => ({
    select: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
  }),
} as never;

describe('read gate — any reachable OA, like the list', () => {
  it('🔴 refuses a job that belongs entirely to another OA', async () => {
    await expect(
      ensureCanReadBroadcast(scoped, [OA_THEIRS], hookModel),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a job on an OA the operator holds', async () => {
    await expect(
      ensureCanReadBroadcast(scoped, [OA_MINE], hookModel),
    ).resolves.toBeUndefined();
  });

  it('🔴 allows a SHARED job — one reachable hook is enough', async () => {
    /* This is precisely what `listBroadcasts` shows with `$in`. A stricter
       rule here would list the job and then refuse to open it.
       ถ้าเข้มกว่านี้ ลิสต์จะโชว์แต่กดเปิดไม่ได้. */
    await expect(
      ensureCanReadBroadcast(scoped, [OA_MINE, OA_THEIRS], hookModel),
    ).resolves.toBeUndefined();
  });

  it('🔴 a job with NO OA is refused, not waved through', async () => {
    /* A job belonging to nobody is not a job belonging to everybody, and no
       working campaign is in that state. */
    await expect(
      ensureCanReadBroadcast(scoped, [], hookModel),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      ensureCanReadBroadcast(scoped, undefined, hookModel),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('🔴 a superadmin is never scoped', async () => {
    /* `getAllowedHookIds` answers `null` for them, which means "no scoping
       applies" — reading it as an empty list would lock them out of
       everything. null = ไม่กั้น ไม่ใช่ห้ามทั้งหมด. */
    await expect(
      ensureCanReadBroadcast(superadmin, [OA_THEIRS], hookModel),
    ).resolves.toBeUndefined();
  });
});

describe('write gate — every OA must be reachable', () => {
  it('allows a job entirely within reach', async () => {
    await expect(
      ensureCanWriteBroadcast(scoped, [OA_MINE], hookModel),
    ).resolves.toBeUndefined();
  });

  it('🔴 REFUSES a shared job, where the read gate allows it', async () => {
    /* The asymmetry is the design: editing or sending a job that also reaches
       an OA you cannot see means acting on that OA's followers.
       อ่านได้ ไม่ได้แปลว่าแก้ได้. */
    await expect(
      ensureCanWriteBroadcast(scoped, [OA_MINE, OA_THEIRS], hookModel),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      ensureCanReadBroadcast(scoped, [OA_MINE, OA_THEIRS], hookModel),
    ).resolves.toBeUndefined();
  });

  it('refuses one entirely out of reach', async () => {
    await expect(
      ensureCanWriteBroadcast(scoped, [OA_THEIRS], hookModel),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a superadmin is never scoped here either', async () => {
    await expect(
      ensureCanWriteBroadcast(superadmin, [OA_MINE, OA_THEIRS], hookModel),
    ).resolves.toBeUndefined();
  });
});

/* ── the OAs and group a job may NAME ────────────────────────────────────── */

describe('🔴 a job may only name OAs and a group the admin already holds', () => {
  /**
   * เจ้าของสั่ง 23/08: *"group / hook oa ที่เลือกได้ใน job ต้องมีในสิทธิ์ของ admin
   * ที่ login เท่านั้น"*
   *
   * This is the WRITE side of the same question the gates above answer for
   * existing rows: not "may I touch this job" but "may I point a job at this
   * OA". Both create and update already enforce it — `ensureAllowedHookIds`
   * for the hooks and `ensureAssignGroupAccess` for the group — and the
   * pickers are server-scoped too (`getHooksByGroup` takes the user).
   *
   * 🔴 PINNED HERE BECAUSE NOTHING ELSE PINNED IT. The checks were reached
   *    only through fixtures that are superadmin, so removing either call
   *    would not have gone red. A rule enforced by code nobody tests is a rule
   *    one refactor away from gone.
   *    กฎที่ไม่มีเทส = อยู่ห่างจากการหายไปแค่หนึ่ง refactor.
   */
  const readCode = (rel: string): string =>
    readFileSync(
      join(__dirname, '..', '..', 'src', 'modules', 'content', rel),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, ' ');

  const service = readCode('broadcasts.service.ts');

  it('🔴 CREATE checks both the hooks and the group', () => {
    const body = service.slice(
      service.indexOf('async createBroadcast'),
      service.indexOf('async updateBroadcast'),
    );
    expect(body).toContain('ensureAllowedHookIds');
    /* [FEAT-20260825-MULTIGROUP] ตัวกันเปลี่ยนชื่อเป็นพหูพจน์ตอน 25/08 —
       เจตนาเดิมคือ "ยังมีการเช็คสิทธิ์กลุ่มอยู่" ซึ่งยังจริง และเข้มขึ้นด้วย
       เพราะตอนนี้เช็ค **ทุกกลุ่มในลิสต์** ไม่ใช่แค่ตัวแรก
       ⚠️ ยอมรับทั้งสองชื่อ เพื่อไม่ให้เทสนี้กลายเป็นตัวขวางการเปลี่ยนชื่อในอนาคต
          แต่ยังล้มถ้ามีคนถอดการเช็คออกจริง ๆ */
    expect(body).toMatch(/ensureAssignGroups?Access/);
  });

  it('🔴 UPDATE checks them again whenever either is changed', () => {
    /* An edit that repoints a job at another OA is the same act as creating it
       there. เปลี่ยน OA ตอนแก้ = เท่ากับสร้างที่นั่น. */
    const body = service.slice(
      service.indexOf('async updateBroadcast'),
      service.indexOf('async deleteBroadcast'),
    );
    expect(body).toMatch(
      /dto\.hook_ids !== undefined[\s\S]{0,400}ensureAllowedHookIds/,
    );
    expect(body).toMatch(
      /dto\.assign_group_ids !== undefined[\s\S]{0,600}ensureAssignGroups?Access/,
    );
  });

  it('🔴 the hook gate is the STRICT one — every id must be held', async () => {
    /* Naming an OA you cannot reach is the same as sending to it.
       ตั้ง OA ที่เข้าไม่ถึง = ยิงไปที่นั่น. */
    await expect(
      ensureCanWriteBroadcast(scoped, [OA_MINE, OA_THEIRS], hookModel),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
