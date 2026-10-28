/**
 * [FEAT-20260808-ACLSEED] ACL bootstrap seed data — the roles, menus and the
 * shape of the seed users a blank/fresh database needs before anyone can log in.
 *
 * Ported field-for-field from legacy
 * `legacy-api/src/services/admin/aclMigrationService.js` (DEFAULT_MENUS /
 * DEFAULT_ROLES). Every permission string and menu `meta.key` MUST match the
 * legacy value exactly — the dashboard hides menus and gates routes by these
 * same strings, so a single renamed permission silently removes access.
 *
 * This is DATA, not logic: it lives alone so the seed set is edited in one
 * place (config-driven) and the seeder service stays small. Adding a menu or a
 * permission here is the whole change — the seeder picks it up unmodified.
 */

/** A navigation entry to seed. `meta.key` is the stable id roles reference. */
export interface SeedMenu {
  readonly label: string;
  readonly path: string;
  readonly required_permissions: readonly string[];
  readonly order: number;
  readonly meta: Readonly<Record<string, unknown>>;
}

/** A role to seed. `menu_keys` are resolved to Menu ObjectIds at seed time. */
export interface SeedRole {
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly string[];
  readonly menu_keys: readonly string[];
}

export const DEFAULT_MENUS: readonly SeedMenu[] = [
  {
    label: 'Dashboard',
    path: '/dashboard',
    required_permissions: ['system.manage'],
    order: 10,
    meta: { key: 'dashboard' },
  },
  {
    label: 'Users',
    path: '/users',
    required_permissions: ['user.manage'],
    order: 20,
    meta: { key: 'users' },
  },
  {
    label: 'Roles',
    path: '/roles',
    required_permissions: ['role.manage'],
    order: 30,
    meta: { key: 'roles' },
  },
  {
    label: 'Menus',
    path: '/menus',
    required_permissions: ['menu.manage'],
    order: 40,
    meta: { key: 'menus' },
  },
  {
    label: 'Webhooks',
    path: '/hooks',
    required_permissions: ['hook.manage'],
    order: 45,
    meta: { key: 'hooks' },
  },
  {
    label: 'Webhook Logs',
    path: '/webhook-logs',
    required_permissions: ['webhook_log.manage'],
    order: 45,
    meta: { key: 'webhook_logs' },
  },
  {
    label: 'Broadcasts',
    path: '/broadcasts',
    required_permissions: ['broadcast.manage'],
    order: 46,
    meta: { key: 'broadcasts' },
  },
  {
    label: 'Auto Replies',
    path: '/auto-replies',
    required_permissions: ['auto_reply.manage'],
    order: 47,
    meta: { key: 'auto_replies' },
  },
  {
    label: 'Groups',
    path: '/groups',
    required_permissions: ['group.manage'],
    order: 48,
    meta: { key: 'groups' },
  },
  {
    label: 'Ticket Support',
    path: '/ticket-support',
    required_permissions: ['ticket.manage'],
    order: 49,
    meta: { key: 'ticket_support' },
  },
  {
    label: 'Audit Logs',
    path: '/audit',
    required_permissions: ['audit.manage'],
    order: 50,
    meta: { key: 'audit' },
  },
  {
    label: 'Insight Report',
    path: '/insight-report',
    required_permissions: ['insight.manage'],
    order: 51,
    meta: { key: 'insight_report' },
  },
  {
    label: 'Assign History',
    path: '/assign-history',
    required_permissions: ['assign_history.manage'],
    order: 52,
    meta: { key: 'assign_history' },
  },
  {
    label: 'Contacts',
    path: '/contacts',
    required_permissions: ['contact.manage'],
    order: 53,
    meta: { key: 'contacts', category: 'support' },
  },
  {
    label: 'System Config',
    path: '/config',
    required_permissions: ['config.manage'],
    order: 60,
    meta: { key: 'config' },
  },
  {
    label: 'User Management',
    path: '/user',
    required_permissions: ['user.manage'],
    order: 70,
    meta: { key: 'user' },
  },
  {
    label: 'Settings',
    path: '/settings',
    required_permissions: ['system.manage'],
    order: 80,
    meta: { key: 'settings' },
  },
  {
    label: 'Slip Verification',
    path: '/slip-verify',
    required_permissions: ['slip.manage'],
    order: 90,
    meta: { key: 'slip_verify' },
  },
  {
    label: 'Flex Messages',
    path: '/flex-messages',
    required_permissions: ['flex.manage'],
    order: 100,
    meta: { key: 'flex_messages' },
  },
  {
    label: 'Dynamic Tags',
    path: '/dynamic-tags',
    required_permissions: ['dynamic_tags.manage'],
    order: 110,
    meta: { key: 'dynamic_tags' },
  },
  // [FEAT-20260729-CUSTOOL] Custom Tools menu — visible only with
  // `custom_tools.manage`; the BE route authorizes on the same permission so a
  // direct call can't bypass the hidden menu. (Ported from legacy AUTO branch.)
  {
    label: 'Custom Tools',
    path: '/custom-tools',
    required_permissions: ['custom_tools.manage'],
    order: 115,
    meta: { key: 'custom_tools' },
  },
  {
    label: 'Object Images',
    path: '/object-images',
    required_permissions: ['object.manage'],
    order: 120,
    meta: { key: 'object_images' },
  },
  {
    label: 'Object Categories',
    path: '/object-categories',
    required_permissions: ['object.manage'],
    order: 130,
    meta: { key: 'object_categories' },
  },
];

export const DEFAULT_ROLES: readonly SeedRole[] = [
  {
    name: 'superadmin',
    description: 'See every menu and manage every permission',
    permissions: [
      'system.manage',
      'user.manage',
      'role.manage',
      'menu.manage',
      'hook.manage',
      'webhook_log.manage',
      'broadcast.manage',
      'auto_reply.manage',
      'group.manage',
      'audit.manage',
      'config.manage',
      'ticket.manage',
      'insight.manage',
      'assign_history.manage',
      'slip.manage',
      'flex.manage',
      'dynamic_tags.manage',
      // [FEAT-20260729-CUSTOOL] Custom Tools management permission
      'custom_tools.manage',
      'object.manage',
      'contact.manage',
      /* [FEAT-20260824-STRIKESESSION] clearing a customer's strike session.
         Read stays on `ticket.manage`; only the PATCH needs this one
         (`modules/strike/strike.controller.ts`).
         ⚠️ This line reaches a FRESH database only — `seedRoles` is create-only
         (`acl-seeder.service.ts:176-179`), so it changes nothing on a database
         whose roles already exist. That is deliberate: the owner decided on
         24/08 that nothing is granted retroactively.
         ⚠️ And listing it on a role is NOT the same as an account having it: a
         token carries the ROLE's permissions only for `superadmin`/`superuser`
         (`auth.service.ts:223-232`); every other account carries its own list.
         So on an existing database a superadmin clears sessions immediately and
         grants the permission to whoever else needs it, one account at a time.
         seed มีผลกับฐานใหม่เท่านั้น · และ role ถือ != user ถือ — มีแต่ superadmin ที่เอาของ role ไป */
      'strike.manage',
    ],
    menu_keys: [
      'dashboard',
      'users',
      'roles',
      'menus',
      'hooks',
      'webhook_logs',
      'broadcasts',
      'auto_replies',
      'groups',
      'audit',
      'config',
      'user',
      'settings',
      'ticket_support',
      'insight_report',
      'assign_history',
      'contacts',
      'slip_verify',
      'flex_messages',
      'dynamic_tags',
      'custom_tools', // [FEAT-20260729-CUSTOOL]
      'object_images',
      'object_categories',
    ],
  },
  {
    name: 'admin',
    description: 'See every menu and manage every permission',
    permissions: [
      'system.manage',
      'user.manage',
      'role.manage',
      'menu.manage',
      'hook.manage',
      'webhook_log.manage',
      'broadcast.manage',
      'auto_reply.manage',
      'group.manage',
      'audit.manage',
      /* [FIX-20260824-CONFIGSUPERONLY] ถอด `config.manage` ("ตั้งค่าระบบ") ออก
         เจ้าของสั่ง 24/08/2026: สิทธิ์นี้ให้เหลือแค่ `superadmin`
         (superadmin ยังถืออยู่ครบ — ถอดหมดจะไม่มีใครเข้าถึงได้เลย)
         ⚠️ SEED เท่านั้น เจ้าของสั่งชัดว่าไม่ต้องรัน — มีผลกับ server ใหม่
            role ที่มีอยู่แล้วไม่ถูกแตะ seeder ไม่เคยถอดสิทธิ์ออกจาก role เดิม
         revert: ใส่ 'config.manage', กลับเข้าไปในลิสต์นี้ */
      'ticket.manage',
      'insight.manage',
      'assign_history.manage',
      'slip.manage',
      'flex.manage',
      'dynamic_tags.manage',
      // [FEAT-20260729-CUSTOOL] Custom Tools management permission
      'custom_tools.manage',
      'object.manage',
      /* [FEAT-20260824-STRIKESESSION] clearing a customer's strike session.
         Read stays on `ticket.manage`; only the PATCH needs this one
         (`modules/strike/strike.controller.ts`).
         ⚠️ This line reaches a FRESH database only — `seedRoles` is create-only
         (`acl-seeder.service.ts:176-179`), so it changes nothing on a database
         whose roles already exist. That is deliberate: the owner decided on
         24/08 that nothing is granted retroactively.
         ⚠️ And listing it on a role is NOT the same as an account having it: a
         token carries the ROLE's permissions only for `superadmin`/`superuser`
         (`auth.service.ts:223-232`); every other account carries its own list.
         So on an existing database a superadmin clears sessions immediately and
         grants the permission to whoever else needs it, one account at a time.
         seed มีผลกับฐานใหม่เท่านั้น · และ role ถือ != user ถือ — มีแต่ superadmin ที่เอาของ role ไป */
      'strike.manage',
    ],
    menu_keys: [
      'dashboard',
      'users',
      'roles',
      'menus',
      'hooks',
      'webhook_logs',
      'broadcasts',
      'auto_replies',
      'groups',
      'audit',
      'config',
      'user',
      'settings',
      'ticket_support',
      'insight_report',
      'assign_history',
      'slip_verify',
      'flex_messages',
      'dynamic_tags',
      'custom_tools', // [FEAT-20260729-CUSTOOL]
      'object_images',
      'object_categories',
    ],
  },
  {
    name: 'operator',
    description: 'Full control except group, user, audit log, and settings',
    permissions: [
      'role.manage',
      'menu.manage',
      'hook.manage',
      'broadcast.manage',
      'auto_reply.manage',
      /* [FIX-20260824-CONFIGSUPERONLY] ถอด `config.manage` ("ตั้งค่าระบบ") ออก
         เจ้าของเคาะ 24/08/2026: สิทธิ์นี้ให้เหลือแค่ `superadmin`
         ⚠️ role นี้ไม่ควรมีมาตั้งแต่แรก — description ข้างบนเขียนเองว่า
            "Full control except group, user, audit log, and SETTINGS"
            ทั้งที่ถือ `config.manage` ซึ่งคือ settings · seed ขัดกับตัวเองมาตลอด
         ⚠️ SEED เท่านั้น เจ้าของสั่งชัดว่าไม่ต้องรัน — มีผลกับ server ใหม่
         revert: ใส่ 'config.manage', กลับเข้าไปในลิสต์นี้ */
      'ticket.manage',
      'insight.manage',
      'assign_history.manage',
    ],
    menu_keys: [
      'dashboard',
      'roles',
      'menus',
      'hooks',
      'broadcasts',
      'auto_replies',
      'config',
      'ticket_support',
      'insight_report',
      'assign_history',
    ],
  },
  /* ==== [FIX-20260823-ASSISTDEFAULT] assist_admin = งานดูแลลูกค้า 3 อย่างเท่านั้น
   *
   * เจ้าของสั่ง 23/08/2026: "default checkbox สิทธิ์ของ assist admin เวลาสร้าง
   * ให้เหลือแค่ 3 อันนี้เท่านั้น" — จัดการงาน (แชท) · รายงานเชิงลึก · ประวัติจ่ายงาน
   *
   * WAS: 9 permissions / 10 menu_keys — ก๊อปมาจาก `operator` ทั้งดุ้น จน description
   * ยังเขียนว่า "equivalent to operator" ทั้งที่บทบาทจริงคือแอดมินผู้ช่วยที่ดูแลเคส
   * ลูกค้า ไม่ใช่คนตั้งค่าระบบ (hook / broadcast / auto-reply / config)
   *
   * ⚠️ ไฟล์นี้มีผลกับ **ฐานข้อมูลเปล่าเท่านั้น** — `acl-seeder.service.ts:176-179`
   *    เขียนว่า `if (existing) continue;` ⇒ role ที่มีอยู่แล้วบน stg/prod ไม่ถูกแตะ
   *    และผู้ใช้ที่ถือ role นั้นอยู่ก็ไม่ถูกแตะ ⇒ ไม่ใช่ migration ไม่ใช่ back-fill
   *    ถ้าอยากให้ prod เปลี่ยนตาม ต้องแก้แถวใน DB เอง ซึ่งเจ้าของสั่งว่ายังไม่ทำ
   *
   * ⚠️ `menu_keys` ตัดตามให้สอดคล้อง — ถ้าตัดแต่ permissions แล้วปล่อยเมนูไว้ 10 อัน
   *    ผู้ใช้บนฐานใหม่จะเห็นเมนูที่กดเข้าไปแล้วโดนปฏิเสธ ซึ่งแย่กว่าเดิม
   *    เก็บ `dashboard` ไว้เพราะเป็นหน้าแรกที่ต้องมีที่ลง และไม่ผูกกับ permission ใด
   *
   * คู่กับฝั่ง FE: `omnidesk-console/components/admin/UserFormModal.tsx` แท็กเดียวกัน
   * — ตัวนั้นคุมค่าตั้งต้นของ checkbox ซึ่งมีผลกับ **ทุกฐาน** รวม prod ที่ role ยังถือ
   * 9 สิทธิ์อยู่ · ไฟล์นี้คุมเฉพาะฐานที่สร้างใหม่
   *
   * revert: คืน permissions 9 ตัว + menu_keys 10 ตัว ชุดเดียวกับ `operator` ข้างบน
   */
  {
    name: 'assist_admin',
    description: 'Assistant administrator — customer case handling only',
    permissions: ['ticket.manage', 'insight.manage', 'assign_history.manage'],
    menu_keys: [
      'dashboard',
      'ticket_support',
      'insight_report',
      'assign_history',
    ],
  },
];
