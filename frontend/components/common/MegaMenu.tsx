import React, { useState, useRef, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Database, ScrollText, Layers, Tag, Building2,
  LifeBuoy, TrendingUp, History, Image as ImageIcon, MessageSquare,
  User, Activity, Settings, ChevronDown, X, Wrench, Contact,
  Languages, // [FEAT-20260803-TRANSDICT]
  Send, // [FEAT-20260805-HANDOFF]
  Megaphone, // [FEAT-20260821-BROADCASTMENU]
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { getStoredAuth } from '../../services/authStorage';

type MenuItem = {
  labelKey: string;
  labelSuffix?: string;
  descKey?: string;
  to: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;          // tailwind bg tint for the icon chip
  show: (ctx: VisibilityCtx) => boolean;
};

type MenuSection = {
  titleKey: string;
  items: MenuItem[];
  show: (ctx: VisibilityCtx) => boolean;
  // If set, the parent renders as a DIRECT link (no dropdown, no arrow) — used
  // when a section's only item just navigates somewhere (e.g. Chat → /chat).
  // Remove `directTo` to restore the normal dropdown behaviour.
  directTo?: string;
};

type VisibilityCtx = {
  roleName: string;
  username: string;
  has: (p: string) => boolean;
};

// Whole menu described as data so the dropdown and its visibility stay in one
// place (the old sidebar hard-coded every item in JSX). Sections and per-item
// guards mirror the sidebar exactly.
const SECTIONS: MenuSection[] = [
  {
    titleKey: 'sidebar.manage',
    // [FEAT-20260729-CUSTOOL] +custom_tools.manage · ถอด group.manage (ย้ายไปหมวดแอป)
    show: (c) => c.has('hook.manage') || c.has('slip.manage') || c.has('flex.manage') || c.has('dynamic_tags.manage') || c.has('custom_tools.manage') || c.has('translation_dict.manage') || c.has('handoff.manage'),
    items: [
      { labelKey: 'nav.channels', labelSuffix: ' ( Hook )', descKey: 'megamenu.channels_desc', to: '/hooks', icon: Database, color: 'bg-rose-100 text-rose-600', show: (c) => c.has('hook.manage') },
      { labelKey: 'nav.slip_verify', descKey: 'megamenu.slip_desc', to: '/slip-verify', icon: ScrollText, color: 'bg-emerald-100 text-emerald-600', show: (c) => c.has('slip.manage') },
      { labelKey: 'nav.flex_messages', descKey: 'megamenu.flex_desc', to: '/flex-messages', icon: Layers, color: 'bg-violet-100 text-violet-600', show: (c) => c.has('flex.manage') },
      { labelKey: 'nav.dynamic_tags', descKey: 'megamenu.tags_desc', to: '/dynamic-tags', icon: Tag, color: 'bg-amber-100 text-amber-600', show: (c) => c.has('dynamic_tags.manage') },
      // [FEAT-20260729-CUSTOOL] เมนูใหม่ — เห็นเฉพาะคนที่มีสิทธิ์ custom_tools.manage
      { labelKey: 'nav.custom_tools', descKey: 'megamenu.custom_tools_desc', to: '/custom-tools', icon: Wrench, color: 'bg-indigo-100 text-indigo-600', show: (c) => c.has('custom_tools.manage') },
      // [FEAT-20260805-HANDOFF] new menu item — only for users with handoff.manage
      { labelKey: 'nav.handoff', descKey: 'megamenu.handoff_desc', to: '/handoff', icon: Send, color: 'bg-cyan-100 text-cyan-600', show: (c) => c.has('handoff.manage') },
      // [FEAT-20260806-HISTORY] handoff history page — own perm handoff.history (manage also sees it)
      { labelKey: 'nav.handoff_history', descKey: 'megamenu.handoff_history_desc', to: '/handoff-history', icon: History, color: 'bg-cyan-100 text-cyan-600', show: (c) => c.has('handoff.history') || c.has('handoff.manage') },
      // [FEAT-20260803-TRANSDICT] พจนานุกรมคำแปล — อยู่ถัดจาก Custom Tools ในหมวดเดียวกัน
      { labelKey: 'nav.translation_dict', descKey: 'megamenu.translation_dict_desc', to: '/translation-dict', icon: Languages, color: 'bg-teal-100 text-teal-600', show: (c) => c.has('translation_dict.manage') },
    ],
  },
  {
    titleKey: 'sidebar.support',
    show: (c) => c.has('ticket.manage') || c.has('insight.manage') || c.has('assign_history.manage') || c.has('contact.manage'),
    items: [
      { labelKey: 'ticket.support', descKey: 'megamenu.ticket_desc', to: '/ticket-support', icon: MessageSquare, color: 'bg-blue-100 text-blue-600', show: (c) => c.has('ticket.manage') },
      // [FEAT-20260729-LEGACYDEV] ซ่อนหน้า Legacy จากทุกคน เหลือเฉพาะ username `dev`
      // เป็นหน้าตารางแบบเดิมที่เก็บไว้ให้ dev ใช้ตรวจเทียบเท่านั้น ไม่ใช่ของแอดมินทั่วไป
      // ยังต้องมี ticket.manage ด้วย เพราะ route /legacy-ticket guard ด้วยสิทธิ์นั้น
      // — ถ้าเช็คแค่ username เมนูจะโผล่ให้ dev ที่ไม่มีสิทธิ์แล้วกดเด้ง (เคส Contacts)
      // revert: show: (c) => c.has('ticket.manage')
      { labelKey: 'ticket.legacy', labelSuffix: ' (Legacy)', descKey: 'megamenu.ticket_legacy_desc', to: '/legacy-ticket', icon: LifeBuoy, color: 'bg-slate-100 text-slate-600', show: (c) => c.username === 'dev' && c.has('ticket.manage') },
      { labelKey: 'insight.manage', descKey: 'megamenu.insight_desc', to: '/insight-report', icon: TrendingUp, color: 'bg-indigo-100 text-indigo-600', show: (c) => c.has('insight.manage') },
      { labelKey: 'assign_history.manage', descKey: 'megamenu.assign_desc', to: '/assign-history', icon: History, color: 'bg-teal-100 text-teal-600', show: (c) => c.has('assign_history.manage') },
      { labelKey: 'nav.contacts', descKey: 'megamenu.contact_desc', to: '/contacts', icon: Contact, color: 'bg-emerald-100 text-emerald-600', show: (c) => c.has('contact.manage') },
      /* [FEAT-20260821-BROADCASTMENU] Broadcasts — เจ้าของสั่ง 21/08: "เปิดเมนู broadcast
         ให้ username dev" + "เอาไว้ในหมวด support"
         ⚠️ ทำไมมันไม่เคยโผล่ทั้งที่ของครบ: หน้า `/broadcasts` มีอยู่แล้ว (`App.tsx:1136`),
            แถวเมนูใน DB มี `visible: true` + `required_permissions: ['broadcast.manage']`,
            และ `GET /api/menus` คืนมันให้ dev จริง (ยิงจริงแล้ว 24 เมนู มีตัวนี้ด้วย) —
            แต่ **MegaMenu กับ Sidebar ไม่ได้อ่านเมนูจาก API เลย** ทั้งคู่เขียนลิงก์ไว้ตายตัว
            แล้วกรองด้วย permission ⇒ ไม่มีบรรทัดตรงนี้ = ไม่มีที่ให้แสดง ไม่ว่าสิทธิ์จะครบแค่ไหน
         ⭐ [REL-20260827-BROADCASTMENU] 27/08 เจ้าของสั่งปลดให้คนอื่นเห็นด้วย ⇒ ถอด
            `c.username === 'dev' &&` ออก เหลือแค่ permission เหมือนทุกเมนูในไฟล์นี้
            ⚠️ **ต้องตรงกับ `Sidebar.tsx` เสมอ** (คอมเมนต์ที่นั่นเตือนไว้เอง) — เมนูสองที่
               ที่ไม่ตรงกัน = คนเดียวกันเห็นคนละอย่างแล้วแต่ว่ากดจากตรงไหน
            ⚠️ ชั้น permission ยังอยู่ ห้ามถอด: เช็คแค่ username แล้วไม่มีสิทธิ์ จะกดแล้ว
               โดน route เด้งกลับ (เคส Contacts ที่เคยเจอ)
         revert: ใส่ `c.username === 'dev' && ` กลับหน้า `c.has(...)` */
      { labelKey: 'nav.broadcasts', descKey: 'megamenu.broadcast_desc', to: '/broadcasts', icon: Megaphone, color: 'bg-orange-100 text-orange-600', show: (c) => c.has('broadcast.manage') },
    ],
  },
  {
    titleKey: 'sidebar.objects',
    show: (c) => c.has('object.manage'),
    items: [
      { labelKey: 'nav.object_category', descKey: 'megamenu.object_cat_desc', to: '/object-categories', icon: Tag, color: 'bg-fuchsia-100 text-fuchsia-600', show: (c) => c.has('object.manage') },
      { labelKey: 'nav.object_image', descKey: 'megamenu.object_img_desc', to: '/object-images', icon: ImageIcon, color: 'bg-pink-100 text-pink-600', show: (c) => c.has('object.manage') },
    ],
  },
  {
    titleKey: 'sidebar.chat',
    // [FEAT-20260729-CHATADMIN] เพิ่ม username `admin` เข้าไปในกติกาเดิม
    // เมนูนี้ไม่ได้ผูกกับ permission ใด (ไม่มี chat.manage ในระบบ) — เป็นทางเข้า
    // demo chat ที่คุมด้วยรายชื่อ role/username ล้วนมาแต่แรก จึงเติมชื่อเข้าไป
    // ตรง ๆ แบบเดียวกับ `dev` · ต้องแก้ให้ตรงกับ Sidebar (showDemoChat) เสมอ
    // revert: ลบ `|| c.username === 'admin'` ออก
    show: (c) => c.roleName === 'superadmin' || c.roleName === 'superuser' || c.username === 'dev' || c.username === 'admin',
    // Only one item (Chat) → render the parent as a direct link (no dropdown /
    // arrow); clicking it goes straight to /chat (which redirects to the ticket
    // page). To restore the dropdown, delete this `directTo` line.
    directTo: '/chat',
    items: [
      { labelKey: 'nav.demo_chat', descKey: 'megamenu.chat_desc', to: '/chat', icon: MessageSquare, color: 'bg-cyan-100 text-cyan-600', show: (c) => c.roleName === 'superadmin' || c.roleName === 'superuser' || c.username === 'dev' },
    ],
  },
  {
    titleKey: 'sidebar.apps',
    // [FEAT-20260729-CUSTOOL] +group.manage — "กลุ่มเครือข่าย" ย้ายมาหมวดนี้แล้ว
    show: (c) => c.has('group.manage') || c.has('user.manage') || c.has('webhook_log.manage') || c.has('audit.manage') || c.has('config.manage'),
    items: [
      // [FEAT-20260729-CUSTOOL] ย้ายมาจากหมวดจัดการทั่วไป ตามที่ผู้ใช้สั่ง
      { labelKey: 'nav.groups', descKey: 'megamenu.groups_desc', to: '/groups', icon: Building2, color: 'bg-sky-100 text-sky-600', show: (c) => c.has('group.manage') },
      { labelKey: 'nav.users', descKey: 'megamenu.users_desc', to: '/users', icon: User, color: 'bg-orange-100 text-orange-600', show: (c) => c.has('user.manage') },
      { labelKey: 'nav.webhook_logs', descKey: 'megamenu.webhook_desc', to: '/webhook-logs', icon: Activity, color: 'bg-lime-100 text-lime-600', show: (c) => c.has('webhook_log.manage') },
      { labelKey: 'nav.audit_logs', descKey: 'megamenu.audit_desc', to: '/audit', icon: ScrollText, color: 'bg-slate-100 text-slate-600', show: (c) => c.has('audit.manage') },
      { labelKey: 'nav.system_config', descKey: 'megamenu.config_desc', to: '/config', icon: Settings, color: 'bg-gray-100 text-gray-600', show: (c) => c.has('config.manage') },
    ],
  },
];

interface MegaMenuProps {
  permissions: string[];
  username: string;
  isMobile?: boolean;
  onItemClick?: () => void;
}

// ==== [FEAT-20260801-TOSMENU] "ผู้ใช้คนนี้มีเมนูให้กดไหม"
// 🔒 สาย AUTO — to_dev_auto / to_prod_auto
//
// ใช้ตอนตัดสินว่าปุ่ม hamburger กดได้หรือไม่ (ผู้ใช้สั่ง: ไม่มีเมนู = กดไม่ได้)
// ⚠️ **ต้องใช้กติกาเดียวกับที่ MegaMenu ใช้จริง** — SECTIONS + item.show(ctx)
//    ชุดเดียวกันเป๊ะ ถ้าไปเขียนเงื่อนไขสิทธิ์ใหม่ที่อื่น วันหนึ่งจะหลุดจากกัน
//    แล้วเกิดเคส "ปุ่มกดได้แต่เปิดมาว่างเปล่า" หรือ "มีเมนูแต่กดไม่ได้"
//    (เคสแบบนี้เคยเกิดมาแล้วกับเมนูกับ route guard — ดู FIX-20260729-MENUPERM)
// revert: ลบฟังก์ชันนี้ + จุดเรียกใน App.tsx (marker เดียวกัน)
// [FIX-20260805-MENUPERM-SUPER] The menu asks the SAME question the BE authorize()
// asks: a user holding system.manage or '*' passes every permission check (that is the
// master bypass — see authMiddleware.authorize). Without this, a superadmin whose role
// carries system.manage but not a brand-new, un-seeded permission (e.g. handoff.manage,
// dashboard.stats.view) would be denied the menu while the route still lets them in.
// This is keyed on the PERMISSION, not the role name, so a plain `admin` without
// system.manage is unaffected — that's why the old role-name bypass (removed in
// [FIX-20260729-MENUPERM]) stays removed. superadmin เห็นเมนูใหม่ทันทีโดยไม่ต้อง seed.
// revert: has: (p) => permissions.includes(p)
export const permAllows = (permissions: string[], p: string): boolean =>
  permissions.includes('system.manage') || permissions.includes('*') || permissions.includes(p);

export const hasAnyMenu = (permissions: string[], username: string): boolean => {
  const ctx: VisibilityCtx = {
    roleName: (getStoredAuth()?.role?.name || '').toLowerCase().trim(),
    username: (username || '').toLowerCase().trim(),
    has: (p) => permAllows(permissions, p),
  };
  const items = SECTIONS.flatMap((s) => s.items.filter((i) => i.show(ctx)));
  if (items.length === 0) return false;
  // ⚠️ ต้องคัดกติกา "ticket-only" ของ MegaMenu มาด้วย (ดูจุดที่ `if (ticketOnly) return null`)
  //    ผู้ใช้ที่เมนูทุกตัวชี้ไปหน้า ticket → MegaMenu ไม่เรนเดอร์อะไรเลย
  //    ถ้าไม่เช็คตรงนี้ จะได้ "ปุ่มกดได้ แต่เปิดมาว่างเปล่า" ซึ่งเป็นเคสที่เจอจริง
  //    กับบัญชี `ticket` (มีแต่ ticket.manage)
  const onlyTicketPages = items.every(
    (i) => i.to === '/ticket-support' || i.to === '/legacy-ticket'
  );
  return !onlyTicketPages;
};
// ==== [FEAT-20260801-TOSMENU] END

export const MegaMenu: React.FC<MegaMenuProps> = ({ permissions, username, isMobile = false, onItemClick }) => {
  const { t } = useI18n();
  // Two ways a panel opens: click "pins" it open until you click away; hover
  // shows it only while the pointer is over the section (closes on leave).
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const normalizedUser = (username || '').toLowerCase().trim();
  const roleName = (getStoredAuth()?.role?.name || '').toLowerCase().trim();
  // ==== [FIX-20260729-MENUPERM] START — 🔒 สาย AUTO (to_dev_auto/to_prod_auto)
  // เดิม: has() มี bypass 2 ตัว — role superadmin และ username bp_admin — ทำให้
  // เมนูโผล่โดยไม่ดูสิทธิ์จริง เคสที่เจอ: `admin` เห็นเมนู Contacts ทั้งที่ไม่มี
  // contact.manage → กดแล้วโดน route guard เด้งกลับ Dashboard (เมนูกับ guard
  // ใช้คนละกติกา)
  //
  // The menu must ask the same question the route guard asks: does this user
  // hold the permission? Nothing else.
  //
  // ทำไมตัด superadmin bypass ได้โดยไม่กระทบ: ตรวจกับ DB จริงแล้ว บัญชี
  // role superadmin (`su`, `dev`) ถือสิทธิ์ครบ 20 ตัว ไม่ขาดเมนูไหนเลย
  // (authController ให้ superadmin ใช้ role.permissions ซึ่งครบอยู่แล้ว)
  // ทำไมตัด bp_admin ได้: ไม่มี user ชื่อนี้ในระบบแล้ว (ยืนยันจาก DB)
  //
  // revert: has: (p) => roleName === 'superadmin' || normalizedUser === 'bp_admin' || permissions.includes(p)
  const ctx: VisibilityCtx = {
    roleName,
    username: normalizedUser,
    // [FIX-20260805-MENUPERM-SUPER] system.manage/* passes any check (mirrors BE authorize)
    has: (p) => permAllows(permissions, p),
  };
  // ==== [FIX-20260729-MENUPERM] END

  // A section shows ONLY when it has at least one item the user can access. The
  // items are the single source of truth — we intentionally DON'T gate on
  // s.show(ctx) too, because a section guard that's broader than its items would
  // otherwise render an empty (or header-only) section. Filter items first, then
  // drop any section left with none.
  const visibleSections = SECTIONS
    .map((s) => ({ ...s, items: s.items.filter((i) => i.show(ctx)) }))
    .filter((s) => s.items.length > 0);

  // "Ticket-only" user: the only things they can reach are the ticket pages
  // (support section, and only its ticket.manage items). For them the whole
  // top nav — the แดชบอร์ด link AND the mega-menu bar — is noise (the ticket
  // page is already their home), so hide it entirely and let the Ticket bar
  // sit at the top. True when every visible item routes to a ticket page.
  const allItems = visibleSections.flatMap((s) => s.items);
  // [FIX-20260805-DASHTICKETONLY] มีสิทธิ์ดูการ์ด dashboard = เห็น Dashboard link บนสุด → ไม่ใช่ ticket-only
  //   (Dashboard link เป็น NavLink แยก ไม่อยู่ใน visibleSections จึงต้องเช็คสิทธิ์ตรงนี้)
  //   คนมี ticket.manage ล้วน (ไม่มีสิทธิ์นี้) ยังเป็น ticket-only เหมือนเดิม
  //   revert: ลบเงื่อนไข `!ctx.has('dashboard.stats.view') &&`
  const ticketOnly =
    !ctx.has('dashboard.stats.view') &&
    allItems.length > 0 &&
    allItems.every((i) => i.to === '/ticket-support' || i.to === '/legacy-ticket');
  if (ticketOnly) return null;

  // A section is open if pinned (clicked) OR opened by hover. A hover-opened
  // panel closes on mouse-leave; a pinned (clicked) one stays until click-outside
  // or the X.
  const openKey = pinned ?? hovered;

  const closeAll = () => {
    setPinned(null);
    setHovered(null);
    onItemClick?.();
  };

  /* [FIX-20260830-SIDEMENUCOLLAPSE] `null` used to mean two different things.
     🔴 The bug: in the sidebar accordion the first section is open by default,
        expressed as `pinned === null && section === visibleSections[0]`. Tapping
        that header ran `togglePin`, which sets `pinned` back to `null` — the very
        state that means "show the first one". It sprang open again, so the first
        section could never be collapsed. Every OTHER section closed fine, which
        is why only one header looked broken.
     The fix stops overloading `null`: `touched` records that the admin has made a
     choice at all, so "nothing chosen yet" and "deliberately closed" stop being
     the same value.
     revert: drop `touched` and restore the two-line togglePin below. */
  const [touched, setTouched] = useState(false);

  /* [FIX-20260830-SIDEMENUCOLLAPSE] which accordion section is open RIGHT NOW.
     One definition, used by both the render and the click handler — when they
     disagreed, the first tap on the default-open section did nothing. */
  const openSectionKey: string | null =
    pinned ?? (touched ? null : (visibleSections[0]?.titleKey ?? null));


  // Click a section header toggles it (and clears any hover-opened one).
  const togglePin = (key: string) => {
    setHovered(null);
    /* [FIX-20260830-SIDEMENUCOLLAPSE] toggle against what is ON SCREEN, not
       against `pinned`. On the very first tap of the default-open section
       `pinned` is still `null`, so `p === key` was false and the tap SET it —
       "opening" a section that was already open. The admin had to tap twice to
       close it. `openSectionKey` is the same value the render uses, so one tap
       always does the visible thing. */
    const closing = openSectionKey === key;
    setTouched(true);
    setPinned(closing ? null : key);
  };

  const label = (i: MenuItem) => `${t(i.labelKey)}${i.labelSuffix || ''}`;

  // Close the (desktop) dropdown on an outside click. MUST run on every render —
  // i.e. BEFORE the `if (isMobile)` early return — or React's hook order breaks
  // between mobile/desktop renders (Rules of Hooks).
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) closeAll();
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3 w-full">
        {/* Dashboard Link */}
        <NavLink
          to="/dashboard"
          end
          onClick={closeAll}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              isActive ? 'text-primary-600 bg-primary-50 dark:bg-primary-950/40 dark:text-primary-400' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`
          }
        >
          <LayoutDashboard size={18} />
          <span>{t('nav.dashboard')}</span>
        </NavLink>

        {visibleSections.map((section) => {
          if (section.directTo) {
            return (
              <NavLink
                key={section.titleKey}
                to={section.directTo}
                onClick={closeAll}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                    isActive ? 'text-primary-600 bg-primary-50 dark:bg-primary-950/40 dark:text-primary-400' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`
                }
              >
                <span>{t(section.titleKey)}</span>
              </NavLink>
            );
          }

          // Accordion: a section is open only when it's the pinned one. Before
          // anything is pinned, the FIRST section is open by default. (The old
          // `|| pinned === null` opened ALL sections whenever pinned was null,
          // so tapping a header to close it — which resets pinned to null —
          // re-opened everything, i.e. "won't close".)
          /* [FIX-20260830-SIDEMENUCOLLAPSE] the default-open branch applies only
             UNTIL the admin touches a header. After that `pinned` alone decides,
             so closing the first section actually closes it. */
          const isExpanded = openSectionKey === section.titleKey;

          return (
            <div key={section.titleKey} className="flex flex-col rounded-xl overflow-hidden border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900">
              <button
                type="button"
                onClick={() => togglePin(section.titleKey)}
                className="flex items-center justify-between w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/60 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-left border-b border-slate-100 dark:border-slate-800"
              >
                <span>{t(section.titleKey)}</span>
                <ChevronDown size={14} className={`transition-transform duration-200 ${isExpanded ? 'rotate-180 text-primary-500' : 'text-slate-400'}`} />
              </button>

              {isExpanded && (
                <div className="flex flex-col p-1.5 divide-y divide-slate-100 dark:divide-slate-800/60">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const desc = item.descKey ? t(item.descKey) : '';
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        onClick={closeAll}
                        className={({ isActive }) =>
                          `flex items-start gap-3 p-2.5 rounded-lg transition-colors ${
                            isActive ? 'bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-400 font-semibold' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/80'
                          }`
                        }
                      >
                        <span className={`flex-shrink-0 w-7 h-7 rounded-full grid place-items-center mt-0.5 ${item.color}`}>
                          <Icon size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold leading-tight">{label(item)}</span>
                          {desc && desc !== item.descKey && (
                            <span className="block text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-tight line-clamp-1">{desc}</span>
                          )}
                        </span>
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    /* [FIX-20260731-MEGATEXT] คลาสไว้เกาะสำหรับธีม light: แถบเมนูนี้อยู่บน
       topbar สีเข้ม ตัวหนังสือ/ไอคอนสีเทาเดิมจึงจม → ทาขาวเฉพาะ "ตัวที่อยู่บน
       แถบ" ผ่าน .app-megabar ใน index.css
       ⚠️ แผง dropdown ที่กางออกมาเป็นพื้นขาว ห้ามโดนด้วย — กฎจึงเจาะเฉพาะ
          ลูกโดยตรงของแถบ ไม่เหวี่ยงทั้ง subtree (ดูคอมเมนต์ใน index.css) */
    <div ref={barRef} className="app-megabar flex items-center gap-1">
      {/* หน้าแรก (Dashboard) — explicit /dashboard so it still opens even when
          "/" redirects ticket-permitted users to the ticket page. */}
      <NavLink
        to="/dashboard"
        end
        className={({ isActive }) =>
          `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
            isActive ? 'text-primary-600 bg-primary-50' : 'text-slate-600 hover:text-primary-600 hover:bg-slate-50'
          }`
        }
      >
        <LayoutDashboard size={16} />
        <span className="hidden xl:inline">{t('nav.dashboard')}</span>
      </NavLink>

      {visibleSections.map((section, idx) => {
        const isOpen = openKey === section.titleKey;
        // Sections in the right half open right-aligned so a wide panel never
        // spills off the viewport edge.
        const alignRight = idx >= Math.ceil(visibleSections.length / 2);
        // Direct-link section (e.g. Chat): render the parent as a NavLink with no
        // dropdown and no arrow. Remove `directTo` on the section to get the
        // normal dropdown back.
        if (section.directTo) {
          return (
            <NavLink
              key={section.titleKey}
              to={section.directTo}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  isActive ? 'text-primary-600 bg-primary-50' : 'text-slate-600 hover:text-primary-600 hover:bg-slate-50'
                }`
              }
            >
              {t(section.titleKey)}
            </NavLink>
          );
        }
        return (
          <div
            key={section.titleKey}
            className="relative"
            onMouseEnter={() => { if (!pinned) setHovered(section.titleKey); }}
            onMouseLeave={() => { if (!pinned) setHovered(null); }}
          >
            <button
              type="button"
              onClick={() => togglePin(section.titleKey)}
              className={`mm-parent flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                isOpen ? 'mm-parent-active text-primary-600' : 'text-slate-600 hover:text-primary-600'
              }`}
            >
              {t(section.titleKey)}
              <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
              // Desktop (md+): panel drops under its button; right-half sections
              // open right-aligned so a wide panel doesn't spill off the edge.
              // Mobile (<md): fixed + centered under the header bar so a
              // viewport-width panel never depends on the trigger's x position.
              <div className={`z-[60] pt-2 fixed left-1/2 -translate-x-1/2 top-16 md:absolute md:left-auto md:right-auto md:translate-x-0 md:top-full ${alignRight ? 'md:right-0' : 'md:left-0'}`}>
                {/* A single item gets its own full-width row (1 col). Otherwise
                    default 2 columns (2×2), rows grow first (2×3, 2×4), then a
                    column is added: 3 cols past 8 items (up to 3×4), 4 cols past
                    12 — never more than 4. */}
                {(() => {
                  const n = section.items.length;
                  const cols = n <= 1 ? 1 : n > 12 ? 4 : n > 8 ? 3 : 2;
                  // Single-item panel is ~half a 2-col panel's width. Wider frames
                  // absorb the +65% padding AND the +10% larger cards.
                  // Desktop widths (md+). Mobile base width is viewport-width
                  // (w-[calc(100vw-1rem)] on the panel), so these never overflow.
                  const width = cols === 4 ? 'md:w-[980px]' : cols === 3 ? 'md:w-[800px]' : cols === 2 ? 'md:w-[620px]' : 'md:w-[360px]';
                  // Mobile forces a single column; desktop uses the computed cols.
                  const colClass = cols === 4 ? 'grid-cols-1 md:grid-cols-4' : cols === 3 ? 'grid-cols-1 md:grid-cols-3' : cols === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1';
                  return (
                <>
                {/* little arrow — points at the trigger button (desktop only).
                    Hidden on mobile where the panel is centered, not under it. */}
                <div className={`hidden md:block absolute top-1 w-3 h-3 rotate-45 bg-white border-l border-t border-slate-200 ${alignRight ? 'right-6' : 'left-6'}`} />
                {/* Equal padding on all four sides (~38px, trimmed a touch from
                    2.5rem so the bg doesn't sit too far from the content); the
                    frame widths absorb it so the cards don't shrink. */}
                {/* Mobile (<md): panel spans the viewport width and uses tighter
                    padding so the fixed desktop widths don't overflow. Desktop
                    (md+) keeps its original width + 2.375rem padding. */}
                <div className={`relative bg-white rounded-2xl shadow-xl border border-slate-200 p-5 md:p-[2.375rem] max-h-[calc(100vh-90px)] overflow-y-auto custom-scrollbar w-[calc(100vw-1rem)] ${width} max-w-[calc(100vw-1rem)] md:max-w-[calc(100vw-2rem)]`}>
                  {/* header: title + close */}
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">{t(section.titleKey)}</span>
                    <button
                      type="button"
                      onClick={closeAll}
                      className="p-1 -mr-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                      aria-label="close"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className={`grid gap-5 ${colClass}`}>
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const desc = item.descKey ? t(item.descKey) : '';
                      // 4-up columns are narrow → stack icon over text; wider
                      // (1–3 col) layouts keep the roomier icon-beside-text row.
                      const stacked = cols === 4;
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          onClick={closeAll}
                          // Bigger cards + larger hover/click area (p-4 all round,
                          // roomier gap) so the whole card is comfortably tappable.
                          className={({ isActive }) =>
                            `mm-item flex ${stacked ? 'flex-col items-start gap-2.5' : 'items-start gap-4'} p-4 rounded-xl transition-colors ${
                              isActive ? 'mm-item-active' : ''
                            }`
                          }
                        >
                          <span className={`flex-shrink-0 w-10 h-10 rounded-full grid place-items-center ${item.color}`}>
                            <Icon size={19} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-slate-800 leading-snug">{label(item)}</span>
                            {desc && desc !== item.descKey && (
                              <span className="block text-xs text-slate-500 mt-0.5 leading-snug">{desc}</span>
                            )}
                          </span>
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
                </>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default MegaMenu;
