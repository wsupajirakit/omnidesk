import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';

import { seedConfig } from '@/config/app.config';
import {
  AclSeederService,
  DEFAULT_MENUS,
  DEFAULT_ROLES,
} from '@/modules/admin';
import { Role } from '@/modules/admin/schemas/role.schema';
import { User } from '@/modules/admin/schemas/user.schema';
import { Menu } from '@/modules/content';

/**
 * [FEAT-20260808-ACLSEED] The seeder's one non-negotiable property: it is safe
 * to run on every boot. Prod is a BLANK DB and the seeder runs on
 * OnApplicationBootstrap, so a second run MUST insert nothing — otherwise a
 * restart would either duplicate rows or (worse) reset a live password.
 *
 * The models are tiny in-memory fakes rather than a real Mongo: the behaviour
 * under test is the seeder's skip-if-exists control flow, not Mongoose. Each
 * fake counts its `create` calls so "second run inserts nothing" is a number.
 */

/** Minimal thenable query stub — the seeder only ever calls `.exec()`. */
const query = <T>(result: T) => ({ exec: async () => result });

class FakeModel {
  readonly docs: Array<Record<string, unknown>> = [];
  createCalls = 0;
  updateCalls = 0;

  async createCollection(): Promise<void> {}
  async syncIndexes(): Promise<void> {}

  findOne(filter: Record<string, unknown>) {
    const hit =
      this.docs.find((d) =>
        Object.entries(filter).every(([k, v]) => d[k] === v),
      ) ?? null;
    return query(hit);
  }

  find(filter?: Record<string, unknown>) {
    let rows = this.docs;
    // Only shape the seeder actually passes: { deleted_at: { $exists: false } }.
    const deletedAt = filter?.deleted_at as { $exists?: boolean } | undefined;
    if (deletedAt && deletedAt.$exists === false) {
      rows = rows.filter((d) => d.deleted_at === undefined);
    }
    return query(rows);
  }

  updateOne(
    filter: Record<string, unknown>,
    update: { $set?: Record<string, unknown> },
  ) {
    this.updateCalls += 1;
    const doc = this.docs.find((d) =>
      Object.entries(filter).every(([k, v]) => d[k] === v),
    );
    if (doc && update.$set) Object.assign(doc, update.$set);
    return query({ acknowledged: true });
  }

  async create(doc: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.createCalls += 1;
    const created = { _id: new Types.ObjectId(), ...doc };
    this.docs.push(created);
    return created;
  }
}

describe('AclSeederService — idempotency', () => {
  let service: AclSeederService;
  let userModel: FakeModel;
  let roleModel: FakeModel;
  let menuModel: FakeModel;

  beforeEach(async () => {
    userModel = new FakeModel();
    roleModel = new FakeModel();
    menuModel = new FakeModel();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AclSeederService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Role.name), useValue: roleModel },
        { provide: getModelToken(Menu.name), useValue: menuModel },
        {
          provide: seedConfig.KEY,
          useValue: {
            aclSeedOnBoot: true,
            adminUsername: 'admin',
            adminPassword: 'admin',
            adminDisplayName: 'Administrator',
            devUsername: 'dev',
            devPassword: 'dev',
            devDisplayName: 'Developer',
            suUsername: 'su',
            suPassword: 'su',
            suDisplayName: 'Super User',
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AclSeederService);
  });

  it('first run creates the full seed set from a blank DB', async () => {
    const summary = await service.run();

    expect(summary.menusCreated).toBe(DEFAULT_MENUS.length); // 24
    expect(summary.rolesCreated).toBe(DEFAULT_ROLES.length); // 4
    expect(summary.usersCreated).toBe(3); // admin / dev / su
    expect(menuModel.createCalls).toBe(DEFAULT_MENUS.length);
    expect(roleModel.createCalls).toBe(DEFAULT_ROLES.length);
    expect(userModel.createCalls).toBe(3);
  });

  it('second run inserts NOTHING (skip-if-exists)', async () => {
    await service.run();
    const first = {
      menus: menuModel.createCalls,
      roles: roleModel.createCalls,
      users: userModel.createCalls,
    };

    const summary = await service.run();

    // The contract: zero new inserts on the second pass.
    expect(summary.menusCreated).toBe(0);
    expect(summary.rolesCreated).toBe(0);
    expect(summary.usersCreated).toBe(0);
    expect(menuModel.createCalls).toBe(first.menus);
    expect(roleModel.createCalls).toBe(first.roles);
    expect(userModel.createCalls).toBe(first.users);
  });

  it('a re-run never rewrites an existing user password', async () => {
    await service.run();
    const admin = userModel.docs.find((d) => d.username === 'admin');
    const hashBefore = admin?.password_hash;

    await service.run();
    const hashAfter = userModel.docs.find(
      (d) => d.username === 'admin',
    )?.password_hash;

    expect(hashAfter).toBe(hashBefore);
  });

  it('seeds the legacy role/permission set exactly', async () => {
    await service.run();

    const superadmin = roleModel.docs.find((d) => d.name === 'superadmin');
    const operator = roleModel.docs.find((d) => d.name === 'operator');

    /* [FEAT-20260824-STRIKESESSION] 20 -> 21: `strike.manage` was added, so that
       clearing a customer's strike session is a privilege of its own rather than
       part of `ticket.manage` (see modules/strike/strike.controller.ts).
       ⚠️ The number is pinned ON PURPOSE — bumping it is how a permission gets
       added silently. Only move it together with a `toContain` below naming the
       new string, so the count change always has a reason attached.
       ตัวเลขนี้กันคนแอบเพิ่มสิทธิ์ · ขยับได้ต้องบอกด้วยว่าเพิ่มอะไร */
    expect((superadmin?.permissions as string[]).length).toBe(21);
    expect(superadmin?.permissions).toContain('custom_tools.manage');
    expect(superadmin?.permissions).toContain('contact.manage');
    expect(superadmin?.permissions).toContain('strike.manage');
    // operator lacks the admin-only permissions
    expect(operator?.permissions).not.toContain('user.manage');
    expect(operator?.permissions).not.toContain('system.manage');
    // menu_access resolved to real menu ids
    const superadminSeed = DEFAULT_ROLES.find((r) => r.name === 'superadmin');
    expect((superadmin?.menu_access as unknown[]).length).toBe(
      superadminSeed?.menu_keys.length,
    );
  });

  /* [FIX-20260823-ASSISTDEFAULT] assist_admin เคยก๊อปสิทธิ์มาจาก operator ทั้งดุ้น
     (9 permissions / 10 menu_keys) และ **ไม่มีเทสไหนคุมมันเลย** — ตรวจแล้ว 23/08
     เจ้าของสั่งให้เหลือ 3 อย่างที่เป็นงานดูแลลูกค้าจริง ๆ เทสนี้ตรึงไว้ทั้งสองด้าน:
     ได้อะไร และ **ต้องไม่ได้อะไร** เพราะด้านหลังคือด้านที่พังเงียบถ้ามีคนก๊อป
     operator มาวางทับอีกรอบ */
  it('[ASSISTDEFAULT] assist_admin ได้แค่ 3 สิทธิ์งานดูแลลูกค้า', async () => {
    await service.run();
    const assist = roleModel.docs.find((d) => d.name === 'assist_admin');

    expect((assist?.permissions as string[]).slice().sort()).toEqual(
      ['assign_history.manage', 'insight.manage', 'ticket.manage'].sort(),
    );
  });

  it('[ASSISTDEFAULT] ⭐ assist_admin ต้องไม่ได้สิทธิ์ตั้งค่าระบบ', async () => {
    await service.run();
    const perms = roleModel.docs.find((d) => d.name === 'assist_admin')
      ?.permissions as string[];
    for (const p of [
      'hook.manage',
      'broadcast.manage',
      'auto_reply.manage',
      'config.manage',
      'role.manage',
      'menu.manage',
      'user.manage',
      'system.manage',
    ]) {
      expect(perms).not.toContain(p);
    }
  });

  /* [FIX-20260824-CONFIGSUPERONLY] "ตั้งค่าระบบ" belongs to superadmin alone.
   *
   * Owner, 24/08/2026, after pointing at the create-user form: give it to super
   * only, and take it off admin.
   *
   * `config.manage` is the permission behind the menu "System Config", whose
   * Thai label is "ตั้งค่าระบบ" — the same name the ASSISTDEFAULT case above
   * already uses for it. It is NOT `system.manage`, which never renders a
   * checkbox at all.
   *
   * ⚠️ `operator` is included, and that is not scope creep. Its own description
   * in the seed reads "Full control except group, user, audit log, and
   * SETTINGS" while it carries `config.manage`, which IS settings. The seed
   * contradicted itself; the owner's instruction and the file's own words point
   * the same way. description กับสิทธิ์ต้องตรงกัน.
   *
   * ⚠️ SEED ONLY — the owner was explicit that this is not to be run. It changes
   * what a NEW server inherits. Existing rows keep whatever they already hold,
   * because the seeder does not strip permissions from roles that exist.
   */
  it('[CONFIGSUPERONLY] ⭐ admin ต้องไม่ได้ config.manage', async () => {
    await service.run();
    const perms = roleModel.docs.find((d) => d.name === 'admin')
      ?.permissions as string[];
    expect(perms).not.toContain('config.manage');
  });

  /* ⚠️ `operator` ยัง NOT ถูกแตะ — และตั้งใจ
   *
   * description ของมันในซีดเขียนเองว่า "Full control except group, user, audit
   * log, and SETTINGS" ทั้งที่ถือ `config.manage` ซึ่งคือ settings ⇒ ซีดขัดกับ
   * ตัวเองอยู่จริง และคำสั่งเจ้าของว่า "ให้แค่ super" ก็ชี้ไปทางเดียวกัน
   *
   * `operator` ก็ถูกถอดด้วย — เจ้าของเคาะตามมาเมื่อ 24/08 หลังเห็นว่า description
   * ของ role นั้นเขียนเองว่า "except ... SETTINGS" ทั้งที่ถือ `config.manage` อยู่
   * เทส `operator ไม่ถูกลูกหลง` จึงถูก **flip 9 → 8** ไม่ใช่ลบ (ดูเหตุผลที่เคสนั้น)
   */

  it('[CONFIGSUPERONLY] ⭐ operator ต้องไม่ได้ config.manage — description ของมันบอกเองว่าไม่ควรมี', async () => {
    await service.run();
    const perms = roleModel.docs.find((d) => d.name === 'operator')
      ?.permissions as string[];
    expect(perms).not.toContain('config.manage');
  });

  it('[CONFIGSUPERONLY] ⭐ superadmin ยังต้องมี — ไม่งั้นไม่มีใครเข้าถึงเลย', async () => {
    await service.run();
    const perms = roleModel.docs.find((d) => d.name === 'superadmin')
      ?.permissions as string[];
    expect(perms).toContain('config.manage');
  });

  it('[CONFIGSUPERONLY] PIN สิทธิ์อื่นของ admin ยังครบ — ถอดตัวเดียว ไม่ใช่หั่น role', async () => {
    await service.run();
    const perms = roleModel.docs.find((d) => d.name === 'admin')
      ?.permissions as string[];
    for (const p of [
      'user.manage',
      'hook.manage',
      'group.manage',
      'audit.manage',
      'ticket.manage',
      'slip.manage',
      'flex.manage',
      'object.manage',
    ]) {
      expect(perms).toContain(p);
    }
  });

  it('[CONFIGSUPERONLY] PIN operator ยังถือสิทธิ์งานของตัวเองครบ', async () => {
    await service.run();
    const perms = roleModel.docs.find((d) => d.name === 'operator')
      ?.permissions as string[];
    for (const p of [
      'hook.manage',
      'ticket.manage',
      'insight.manage',
      'assign_history.manage',
    ]) {
      expect(perms).toContain(p);
    }
  });

  it('[ASSISTDEFAULT] เมนูสอดคล้องกับสิทธิ์ — ไม่โชว์เมนูที่กดเข้าไปแล้วโดนปฏิเสธ', async () => {
    await service.run();
    const seed = DEFAULT_ROLES.find((r) => r.name === 'assist_admin');

    expect(seed?.menu_keys.slice().sort()).toEqual(
      [
        'assign_history',
        'dashboard',
        'insight_report',
        'ticket_support',
      ].sort(),
    );
    // menu_access ที่ seed ลงจริงต้องมีจำนวนเท่ากับ menu_keys
    const assist = roleModel.docs.find((d) => d.name === 'assist_admin');
    expect((assist?.menu_access as unknown[]).length).toBe(
      seed?.menu_keys.length,
    );
  });

  /* [FIX-20260824-CONFIGSUPERONLY] FLIPPED 9 → 8 — ไม่ได้ลบ
   *
   * เคสนี้เกิดตอน `[ASSISTDEFAULT]` เพื่อพิสูจน์ว่า **operator ไม่โดนหางเลข**
   * จากการหั่นสิทธิ์ของ assist_admin · เจตนานั้นยังอยู่ครบและยังคุมอยู่:
   * operator ยังถือสิทธิ์งานของตัวเองทุกตัว และตัวเลขยังถูกตรึงไว้เป๊ะ
   *
   * ที่เปลี่ยนคือ `config.manage` ถูกถอดออก **โดยตั้งใจ** เจ้าของเคาะ 24/08/2026
   * ว่าสิทธิ์ "ตั้งค่าระบบ" ให้เหลือแค่ `superadmin` · และ description ของ role นี้
   * ก็เขียนไว้เองว่า "Full control except group, user, audit log, and SETTINGS"
   * ทั้งที่ถือ `config.manage` ซึ่งคือ settings ⇒ ซีดขัดกับตัวเองมาตลอด
   *
   * ⇒ ตัวเลขจึงเป็น 8 และ `config.manage` กลายเป็น "ต้องไม่มี" แทนที่จะ "ต้องมี"
   * ถ้าเลขนี้ขยับอีกโดยไม่มีใครสั่ง = มีคนไปแตะ role นี้ ซึ่งคือสิ่งที่เคสนี้มีไว้จับ
   */
  it('[ASSISTDEFAULT] ⭐ operator ไม่ถูกลูกหลง — ถือ 8 สิทธิ์ (ถอด config.manage ตามที่เจ้าของเคาะ)', async () => {
    await service.run();
    const operator = roleModel.docs.find((d) => d.name === 'operator');

    expect((operator?.permissions as string[]).length).toBe(8);
    expect(operator?.permissions).toContain('hook.manage');
    expect(operator?.permissions).not.toContain('config.manage');
  });

  it('sources seed users from config (admin, dev, su)', async () => {
    await service.run();
    const usernames = userModel.docs.map((d) => d.username).sort();
    expect(usernames).toEqual(['admin', 'dev', 'su']);
  });
});
