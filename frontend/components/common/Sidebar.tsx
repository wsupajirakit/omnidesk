import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Database, ChevronLeft, ChevronRight, LogOut, Hexagon, X, ScrollText, Settings, Activity, Users, User, Reply, Megaphone, Building2, MessageSquare, Image as ImageIcon, Tag, Layers, ShieldCheck, LifeBuoy, TrendingUp, History, Contact } from 'lucide-react';
import { getStoredAuth } from '../../services/authStorage';
import { useI18n } from '../../i18n';

interface SidebarProps {
  isDesktopOpen: boolean;
  toggleDesktop: () => void;
  isMobileOpen: boolean;
  closeMobile: () => void;
  onLogout: () => void;
  siteName: string;
  permissions: string[];
  username?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  isDesktopOpen, 
  toggleDesktop, 
  isMobileOpen, 
  closeMobile,
  onLogout,
  siteName,
  permissions,
  username
}) => {
  const { t } = useI18n();
  const normalizedUser = username?.toLowerCase().trim();

  // ==== [FIX-20260729-MENUPERM] START — ถอด bypass ของ username `bp_admin`
  // เดิมทุกบรรทัดในบล็อกนี้ขึ้นต้นด้วย `isActuallyBpAdmin ||` ซึ่งเปิดเมนู
  // ทั้งหมดให้ user ชื่อนั้นโดยไม่ดูสิทธิ์ — **ไม่มี user ชื่อ bp_admin ใน
  // ระบบแล้ว** (ยืนยันจาก DB) เงื่อนไขนั้นจึงเป็น false เสมอ การถอดออกจึง
  // ให้ผลลัพธ์เท่าเดิมเป๊ะทุกบัญชี แต่เหลือกติกาเดียว = สิทธิ์จริง
  // revert: ใส่ `const isActuallyBpAdmin = normalizedUser === 'bp_admin';`
  //         กลับมา แล้วเติม `isActuallyBpAdmin ||` นำหน้า 5 จุดในบล็อกนี้
  //         (hasPermission · hasManage · hasObject · hasChat · hasApps · hasSupport)
  const hasPermission = (perm: string) => permissions.includes(perm);
  const hasManage =
    hasPermission('hook.manage') || hasPermission('flex.manage') || hasPermission('slip.manage') || hasPermission('dynamic_tags.manage') || hasPermission('group.manage');

  const hasObject = hasPermission('object.manage');
  // Toggle chat-related menus without removing routes.
  const auth = getStoredAuth();
  const roleName = auth?.role?.name?.toLowerCase().trim();
  const isSuperOrAdminOrDev = roleName === 'superadmin' || roleName === 'admin' || normalizedUser === 'dev';
  const isSuperOrDev = roleName === 'superadmin' || roleName === 'superuser' || normalizedUser === 'dev';
  // [FEAT-20260729-CHATADMIN] เติม username `admin` — ต้องตรงกับ MegaMenu
  // (SECTIONS: sidebar.chat) เสมอ ไม่งั้นเมนูสองที่จะไม่ตรงกัน
  // revert: ลบ `|| normalizedUser === 'admin'` ออก
  const showDemoChat = roleName === 'superadmin' || roleName === 'superuser' || normalizedUser === 'dev' || normalizedUser === 'admin';
  // [FEAT-20260811-DEVONLYMENU] Auto-reply is DEV-ONLY while unfinished
  // (owner 2026-08-11). Gate = username `dev`/`dev2` **AND** the matching permission.
  //
  // ⭐ [REL-20260827-BROADCASTMENU] BROADCAST WAS RELEASED 27/08/2026 — เจ้าของสั่ง
  // "ปลดเมนู broadcast ให้เห็นกับคนอื่นด้วย". The release was exactly the one-line
  // change this block was built for: `isDevUser &&` deleted from `showBroadcasts`,
  // nothing else. It is now permission-only like every other menu in this file.
  // ⚠️ AUTO-REPLY IS NOT PART OF THIS — เจ้าของย้ำ "auto reply ไม่เกี่ยว" ⇒ it keeps
  //    the username gate below. Releasing it later is the same one-line change.
  // revert: put `isDevUser && ` back in front of `hasPermission('broadcast.manage')`.
  //
  // WHY BOTH — and specifically why the permission half stays even though the
  // username half already restricts it: it is the ZERO-DEBT release switch. When
  // the pages ship, releasing them is a ONE-LINE change — delete the `isDevUser &&`
  // — and they fall straight back to the file's normal permission-only model with
  // NOTHING left to clean up. Keeping the permission check now means the released
  // state is already wired; we only ever remove the temporary username guard.
  // เหตุผลที่ใส่ perm ด้วย: พอ dev ทำเสร็จ แค่ปลด `isDevUser &&` ออก เมนูกลับเป็น
  // permission-only ทันที ไม่เหลือ debt ให้ตามเก็บ.
  //
  // `dev2` is included though only `dev` exists in the DB today (the second dev
  // account to come). revert: set both to `false` to hide fully.
  const isDevUser = normalizedUser === 'dev' || normalizedUser === 'dev2';
  const showAutoReplies = isDevUser && hasPermission('auto_reply.manage');
  const showBroadcasts = hasPermission('broadcast.manage');
  const hasChat = showDemoChat || showAutoReplies || showBroadcasts;
  const showGroups = hasPermission('group.manage');
  const showUsers = hasPermission('user.manage');
  const showWebhookLogs = hasPermission('webhook_log.manage');
  const showAuditLogs = hasPermission('audit.manage');
  const showSystemConfig = hasPermission('config.manage');
  // Sector Groups sits under General Management, so it no longer decides
  // whether the App Library heading is shown.
  const hasApps = showUsers || showWebhookLogs || showAuditLogs || showSystemConfig;
  const hasSupport = hasPermission('ticket.manage') || hasPermission('insight.manage') || hasPermission('assign_history.manage') || hasPermission('contact.manage');
  // ==== [FIX-20260729-MENUPERM] END


  const [permissionAlert, setPermissionAlert] = React.useState(false);

  const handleNavClick = (e: React.MouseEvent, to: string) => {
    closeMobile();
  };
  // Logic for sidebar width and visibility
  // Mobile: fixed width (w-64), transform handles visibility
  // Desktop: transform always 0, width changes between 64 and 20
  const sidebarClasses = `
    fixed inset-y-0 left-0 z-40 bg-dark-800 border-r border-dark-700 flex flex-col transition-all duration-300 ease-in-out
    transform
    ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
    lg:translate-x-0
    ${isDesktopOpen ? 'lg:w-64' : 'lg:w-20'}
    w-64
  `;

  return (
    <>
      <aside className={sidebarClasses}>
        <div className="h-16 flex items-center justify-between px-4 border-b border-dark-700">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="bg-gradient-to-tr from-primary-500 to-primary-600 p-2 rounded-lg shrink-0">
               <Hexagon className="text-white" size={20} fill="currentColor" fillOpacity={0.3} />
            </div>
            <span className={`text-lg font-bold text-slate-900 whitespace-nowrap transition-opacity duration-300 ${!isDesktopOpen && 'lg:opacity-0 lg:w-0'}`}>
              {siteName}
            </span>
          </div>
          
          {/* Desktop Toggle Button */}
          <button 
            onClick={toggleDesktop}
            className="hidden lg:flex p-1.5 rounded-md bg-dark-700 text-slate-600 hover:text-slate-900 hover:bg-dark-600 transition-colors absolute -right-3 top-5 border border-dark-600 shadow-sm z-50"
          >
            {isDesktopOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>

          {/* Mobile Close Button */}
          <button 
            onClick={(e) => handleNavClick(e, '/')}
            className="lg:hidden p-1 text-slate-600 hover:text-slate-900"
          >
            <X size={24} />
          </button>
        </div>

        <nav className="flex-1 py-6 px-3 flex flex-col gap-2 overflow-y-auto custom-scrollbar">
          <div className={`px-3 text-xs font-semibold uppercase tracking-widest text-slate-500/80 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
            {t('sidebar.home')}
          </div>
          <NavLink 
            to="/" 
            onClick={(e) => handleNavClick(e, '/')}
            className={({ isActive }) => 
              `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                isActive 
                  ? 'sidebar-link-active text-primary-500 font-medium' 
                  : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
              }`
            }
          >
            <LayoutDashboard size={22} className="shrink-0" />
            <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
              {t('nav.dashboard')}
            </span>
            {!isDesktopOpen && (
              <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                {t('nav.dashboard')} <span className="text-slate-500 ml-1">/#/</span>
              </div>
            )}
          </NavLink>

          {hasManage && (
            <div className={`px-3 pt-4 text-xs font-semibold uppercase tracking-widest text-slate-500/80 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
              {t('sidebar.manage')}
            </div>
          )}

          {hasPermission('hook.manage') && (
            <NavLink 
              to="/hooks" 
              onClick={(e) => handleNavClick(e, '/hooks')}
              className={({ isActive }) => 
                `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                  isActive 
                    ? 'sidebar-link-active text-primary-500 font-medium' 
                    : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                }`
              }
            >
              <Database size={22} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                {t('nav.channels')} ( Hook )
              </span>
              {!isDesktopOpen && (
                <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                  {t('nav.channels')} ( Hook ) <span className="text-slate-500 ml-1">/#/hooks</span>
                </div>
              )}
            </NavLink>
          )}

          {hasPermission('slip.manage') && (
            <NavLink 
              to="/slip-verify" 
              onClick={(e) => handleNavClick(e, '/slip-verify')}
              className={({ isActive }) => 
                `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                  isActive 
                    ? 'sidebar-link-active text-primary-500 font-medium' 
                    : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                }`
              }
            >
              <ScrollText size={22} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                {t('nav.slip_verify')}
              </span>
              {!isDesktopOpen && (
                <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                  {t('nav.slip_verify')} <span className="text-slate-500 ml-1">/#/slip-verify</span>
                </div>
              )}
            </NavLink>
          )}

          {hasPermission('flex.manage') && (
            <NavLink
              to="/flex-messages"
              onClick={(e) => handleNavClick(e, '/flex-messages')}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                  isActive
                    ? 'sidebar-link-active text-primary-500 font-medium'
                    : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                }`
              }
            >
              <Layers size={22} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                {t('nav.flex_messages')}
              </span>
              {!isDesktopOpen && (
                <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                  {t('nav.flex_messages')} <span className="text-slate-500 ml-1">/#/flex-messages</span>
                </div>
              )}
            </NavLink>
          )}

          {hasPermission('dynamic_tags.manage') && (
            <NavLink
              to="/dynamic-tags"
              onClick={(e) => handleNavClick(e, '/dynamic-tags')}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                  isActive
                    ? 'sidebar-link-active text-primary-500 font-medium'
                    : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                }`
              }
            >
              <Tag size={22} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                {t('nav.dynamic_tags')}
              </span>
              {!isDesktopOpen && (
                <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                  {t('nav.dynamic_tags')} <span className="text-slate-500 ml-1">/#/dynamic-tags</span>
                </div>
              )}
            </NavLink>
          )}

          {showGroups && (
            <NavLink 
              to="/groups" 
              onClick={(e) => handleNavClick(e, '/groups')}
              className={({ isActive }) => 
                `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                  isActive 
                    ? 'sidebar-link-active text-primary-500 font-medium' 
                    : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                }`
              }
            >
              <Building2 size={22} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                {t('nav.groups')}
              </span>
              {!isDesktopOpen && (
                <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                  {t('nav.groups')} <span className="text-slate-500 ml-1">/#/groups</span>
                </div>
              )}
            </NavLink>
          )}

          {hasSupport && (
            <>
              <div className={`px-3 pt-4 text-xs font-semibold uppercase tracking-widest text-slate-500/80 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                {t('sidebar.support')}
              </div>
              {hasPermission('ticket.manage') && (
                <NavLink 
                  to="/ticket-support" 
                  onClick={(e) => handleNavClick(e, '/ticket-support')}
                  className={({ isActive }) => 
                    `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                      isActive 
                        ? 'sidebar-link-active text-primary-500 font-medium' 
                        : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                    }`
                  }
                >
                  <LifeBuoy size={22} className="shrink-0" />
                  <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                    {t('ticket.manager')}
                  </span>
                  {!isDesktopOpen && (
                    <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                      {t('ticket.manager')} <span className="text-slate-500 ml-1">/#/ticket-support</span>
                    </div>
                  )}
                </NavLink>
              )}

              {hasPermission('insight.manage') && (
                <NavLink 
                  to="/insight-report" 
                  onClick={(e) => handleNavClick(e, '/insight-report')}
                  className={({ isActive }) => 
                    `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                      isActive 
                        ? 'sidebar-link-active text-primary-500 font-medium' 
                        : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                    }`
                  }
                >
                  <TrendingUp size={22} className="shrink-0" />
                  <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                    {t('insight.manage')}
                  </span>
                  {!isDesktopOpen && (
                    <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                      {t('insight.manage')} <span className="text-slate-500 ml-1">/#/insight-report</span>
                    </div>
                  )}
                </NavLink>
              )}

              {hasPermission('assign_history.manage') && (
                <NavLink 
                  to="/assign-history" 
                  onClick={(e) => handleNavClick(e, '/assign-history')}
                  className={({ isActive }) => 
                    `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                      isActive 
                        ? 'sidebar-link-active text-primary-500 font-medium' 
                        : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                    }`
                  }
                >
                  <History size={22} className="shrink-0" />
                  <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                    {t('assign_history.manage')}
                  </span>
                  {!isDesktopOpen && (
                    <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                      {t('assign_history.manage')} <span className="text-slate-500 ml-1">/#/assign-history</span>
                    </div>
                  )}
                </NavLink>
              )}

              {hasPermission('contact.manage') && (
                <NavLink 
                  to="/contacts" 
                  onClick={(e) => handleNavClick(e, '/contacts')}
                  className={({ isActive }) => 
                    `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                      isActive 
                        ? 'sidebar-link-active text-primary-500 font-medium' 
                        : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                    }`
                  }
                >
                  <Contact size={22} className="shrink-0" />
                  <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                    {t('nav.contacts') || 'Contacts'}
                  </span>
                  {!isDesktopOpen && (
                    <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                      {t('nav.contacts') || 'Contacts'} <span className="text-slate-500 ml-1">/#/contacts</span>
                    </div>
                  )}
                </NavLink>
              )}
            </>
          )}

          {hasObject && (
            <>
              <div className={`px-3 pt-4 text-xs font-semibold uppercase tracking-widest text-slate-500/80 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                {t('sidebar.objects')}
              </div>
              <NavLink 
                to="/object-categories" 
                onClick={(e) => handleNavClick(e, '/object-categories')}
                className={({ isActive }) => 
                  `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                    isActive 
                      ? 'sidebar-link-active text-primary-500 font-medium' 
                      : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                  }`
                }
              >
                <Tag size={22} className="shrink-0" />
                <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                  {t('nav.object_category')}
                </span>
                {!isDesktopOpen && (
                  <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                    {t('nav.object_category')} <span className="text-slate-500 ml-1">/#/object-categories</span>
                  </div>
                )}
              </NavLink>

              <NavLink 
                to="/object-images" 
                onClick={(e) => handleNavClick(e, '/object-images')}
                className={({ isActive }) => 
                  `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                    isActive 
                      ? 'sidebar-link-active text-primary-500 font-medium' 
                      : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                  }`
                }
              >
                <ImageIcon size={22} className="shrink-0" />
                <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                  {t('nav.object_image')}
                </span>
                {!isDesktopOpen && (
                  <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                    {t('nav.object_image')} <span className="text-slate-500 ml-1">/#/object-images</span>
                  </div>
                )}
              </NavLink>
            </>
          )}

          {hasChat && (
            <div className={`px-3 pt-4 text-xs font-semibold uppercase tracking-widest text-slate-500/80 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
              {t('sidebar.chat')}
            </div>
          )}
          {showDemoChat && (
            <NavLink
              to="/chat"
              onClick={(e) => handleNavClick(e, '/chat')}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                  isActive
                    ? 'sidebar-link-active text-primary-500 font-medium'
                    : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                }`
              }
            >
              <MessageSquare size={22} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                {t('nav.demo_chat')}
              </span>
              {!isDesktopOpen && (
                <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                  {t('nav.demo_chat')} <span className="text-slate-500 ml-1">/#/chat</span>
                </div>
              )}
            </NavLink>
          )}

          {showAutoReplies && (
            <NavLink 
              to="/auto-replies" 
              onClick={(e) => handleNavClick(e, '/auto-replies')}
              className={({ isActive }) => 
                `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                  isActive 
                    ? 'sidebar-link-active text-primary-500 font-medium' 
                    : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                }`
              }
            >
              <Reply size={22} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                {t('nav.auto_replies')}
              </span>
              {!isDesktopOpen && (
                <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                  {t('nav.auto_replies')} <span className="text-slate-500 ml-1">/#/auto-replies</span>
                </div>
              )}
            </NavLink>
          )}

          {showBroadcasts && (
            <NavLink 
              to="/broadcasts" 
              onClick={(e) => handleNavClick(e, '/broadcasts')}
              className={({ isActive }) => 
                `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                  isActive 
                    ? 'sidebar-link-active text-primary-500 font-medium' 
                    : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                }`
              }
            >
              <Megaphone size={22} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                {t('nav.broadcasts')}
              </span>
              {!isDesktopOpen && (
                <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                  {t('nav.broadcasts')} <span className="text-slate-500 ml-1">/#/broadcasts</span>
                </div>
              )}
            </NavLink>
          )}

          {hasApps && (
            <div className={`px-3 pt-4 text-xs font-semibold uppercase tracking-widest text-slate-500/80 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
              {t('sidebar.apps')}
            </div>
          )}

          {showUsers && (
            <NavLink 
              to="/users" 
              onClick={(e) => handleNavClick(e, '/users')}
              className={({ isActive }) => 
                `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                  isActive 
                    ? 'sidebar-link-active text-primary-500 font-medium' 
                    : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                }`
              }
            >
              <User size={22} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                {t('nav.users')}
              </span>
              {!isDesktopOpen && (
                <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                  {t('nav.users')} <span className="text-slate-500 ml-1">/#/users</span>
                </div>
              )}
            </NavLink>
          )}

          {showWebhookLogs && (
            <NavLink
              to="/webhook-logs"
              onClick={(e) => handleNavClick(e, '/webhook-logs')}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                  isActive
                    ? 'sidebar-link-active text-primary-500 font-medium'
                    : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                }`
              }
            >
              <Activity size={22} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                {t('nav.webhook_logs')}
              </span>
              {!isDesktopOpen && (
                <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                  {t('nav.webhook_logs')} <span className="text-slate-500 ml-1">/#/webhook-logs</span>
                </div>
              )}
            </NavLink>
          )}

          {showAuditLogs && (
            <NavLink
              to="/audit"
              onClick={(e) => handleNavClick(e, '/audit')}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                  isActive
                    ? 'sidebar-link-active text-primary-500 font-medium'
                    : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                }`
              }
            >
              <ScrollText size={22} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                {t('nav.audit_logs')}
              </span>
              {!isDesktopOpen && (
                <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                  {t('nav.audit_logs')} <span className="text-slate-500 ml-1">/#/audit</span>
                </div>
              )}
            </NavLink>
          )}

          {showSystemConfig && (
            <NavLink
              to="/config"
              onClick={(e) => handleNavClick(e, '/config')}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group sidebar-link ${
                  isActive
                    ? 'sidebar-link-active text-primary-500 font-medium'
                    : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                }`
              }
            >
              <Settings size={22} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
                {t('nav.system_config')}
              </span>
              {!isDesktopOpen && (
                <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                  {t('nav.system_config')} <span className="text-slate-500 ml-1">/#/config</span>
                </div>
              )}
            </NavLink>
          )}

        </nav>

        <div className="p-3 border-t border-dark-700">
          <button 
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-all duration-200 group"
          >
            <LogOut size={22} className="shrink-0" />
            <span className={`whitespace-nowrap transition-all duration-300 ${!isDesktopOpen ? 'lg:hidden' : ''}`}>
              {t('nav.logout')}
            </span>
             {!isDesktopOpen && (
              <div className="hidden lg:block fixed left-16 bg-dark-800 text-slate-900 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                {t('nav.logout')}
              </div>
            )}
          </button>
        </div>
      </aside>

      {permissionAlert && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-dark-800 border border-dark-700 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform animate-in zoom-in-95 duration-300">
            <div className="p-8 flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-4 ring-8 ring-red-500/5">
                <ShieldCheck size={32} className="text-red-500" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">No Permission</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                You do not have permission to access this menu. Please contact your system administrator for assistance.
              </p>
            </div>
            <div className="p-4 bg-dark-900/50 border-t border-dark-700">
              <button
                onClick={() => setPermissionAlert(false)}
                className="w-full py-3 px-4 bg-primary-600 hover:bg-primary-500 text-white rounded-xl font-bold transition-all active:scale-[0.98] shadow-lg shadow-primary-500/20"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
