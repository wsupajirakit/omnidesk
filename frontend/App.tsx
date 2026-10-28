import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
// [FEAT-20260801-TOSMENU] hasAnyMenu ใช้กติกาสิทธิ์ชุดเดียวกับตัวเมนูจริง
import { MegaMenu, hasAnyMenu, permAllows } from './components/common';
import { Login } from './pages/admin/Login';

// ==== [FIX-20260729-CODESPLIT] START — load pages on demand
// 🔒 AUTO track — to_dev_auto branch only
//
// ── Why ──────────────────────────────────────────────────────────────────────
// All 25 pages were imported statically, so opening ANY route downloaded ALL of
// them: a single 2.0 MB bundle (475 kB gzipped). Someone who only ever uses
// /ticket-support still paid for the report charts, the simulator, the image
// library and everything else before the first paint.
//
// React.lazy + a route-level <Suspense> lets Vite split each page into its own
// chunk that is fetched the first time that route is visited.
//
// ── Deliberately NOT lazy ────────────────────────────────────────────────────
// `Login` stays a static import: it is the first thing an unauthenticated
// visitor sees, and lazy-loading it would show a blank frame before the form.
//
// ⚠️ default vs named exports differ per page — `Chat` and
//    `TelegramChatIdAutomate` are default exports, the rest are named. Getting
//    this wrong renders an empty page with no build error, so each line below
//    mirrors what the page actually exports.
// revert: turn these back into plain static imports and drop the <Suspense>
//         wrapper around <Routes> further down

// ==== [FIX-20260729-SPACACHE] START — 🔒 สาย AUTO (to_dev_auto / to_prod_auto)
//
// A browser still holding an OLD `index.html` asks for chunk names a later
// deploy has already removed, so the lazy import throws and the page never
// arrives. nginx fixed the cause (`index.html` = no-store); this handles the
// sessions that were already open when the deploy landed.
//
// [FIX-20260922-CHUNKSTUCK] The handler MOVED OUT of this file, because the
// version that lived here recovered by returning a promise that never settles —
// an admin whose reload did not land sat on `กำลังโหลด…` forever, with nothing
// in any server log to show for it. The replacement bounds that wait and hands
// the failure to an error boundary, so the last thing a user sees is a button
// and not a spinner. Full account, and how to revert, in the new file.
// เดิมรอแบบไม่มีวันจบ ตอนนี้มีที่สิ้นสุดเสมอ
import { lazyWithRecovery } from './components/common/chunk-recovery/lazyWithRecovery';
import { RouteErrorBoundary } from './components/common/chunk-recovery/RouteErrorBoundary';
// ==== [FIX-20260729-SPACACHE] END

const Dashboard = lazyWithRecovery(() => import('./pages/insight/Dashboard').then(m => ({ default: m.Dashboard })));
const Chat = lazyWithRecovery(() => import('./pages/chat/Chat'));
const Contact = lazyWithRecovery(() => import('./pages/chat/Contact'));
const HandoffChains = lazyWithRecovery(() => import('./pages/handoff/HandoffChains')); // [FEAT-20260805-CHAIN]
const HandoffHistory = lazyWithRecovery(() => import('./pages/handoff/HandoffHistory')); // [FEAT-20260806-HISTORY]
const WebhookList = lazyWithRecovery(() => import('./pages/hook/WebhookList').then(m => ({ default: m.WebhookList })));
const AuditLogs = lazyWithRecovery(() => import('./pages/admin/AuditLogs').then(m => ({ default: m.AuditLogs })));
const SystemConfig = lazyWithRecovery(() => import('./pages/admin/SystemConfig').then(m => ({ default: m.SystemConfig })));
const WebhookLogs = lazyWithRecovery(() => import('./pages/hook/WebhookLogs').then(m => ({ default: m.WebhookLogs })));
const Groups = lazyWithRecovery(() => import('./pages/admin/Groups').then(m => ({ default: m.Groups })));
const Users = lazyWithRecovery(() => import('./pages/admin/Users').then(m => ({ default: m.Users })));
const AutoReplies = lazyWithRecovery(() => import('./pages/messaging/AutoReplies').then(m => ({ default: m.AutoReplies })));
const Broadcasts = lazyWithRecovery(() => import('./pages/messaging/Broadcasts').then(m => ({ default: m.Broadcasts })));
const ObjectImageList = lazyWithRecovery(() => import('./pages/content/ObjectImageList').then(m => ({ default: m.ObjectImageList })));
const ObjectCategoryList = lazyWithRecovery(() => import('./pages/content/ObjectCategoryList').then(m => ({ default: m.ObjectCategoryList })));
const FlexMessageList = lazyWithRecovery(() => import('./pages/content/FlexMessageList').then(m => ({ default: m.FlexMessageList })));
const TelegramChatIdAutomate = lazyWithRecovery(() => import('./pages/hook/TelegramChatIdAutomate'));
const Simulator = lazyWithRecovery(() => import('./pages/hook/Simulator').then(m => ({ default: m.Simulator })));
const SlipVerification = lazyWithRecovery(() => import('./pages/content/SlipVerification').then(m => ({ default: m.SlipVerification })));
const DynamicTagList = lazyWithRecovery(() => import('./pages/messaging/DynamicTagList').then(m => ({ default: m.DynamicTagList })));
// [FEAT-20260729-CUSTOOL] 🔒 สาย AUTO — to_dev_auto เท่านั้น
const CustomTools = lazyWithRecovery(() => import('./pages/hook/CustomTools').then(m => ({ default: m.CustomTools })));
// [FEAT-20260805-HANDOFF] หน้าจัดการ handoff targets — gated by handoff.manage
const HandoffTargets = lazyWithRecovery(() => import('./pages/handoff/HandoffTargets').then(m => ({ default: m.HandoffTargets })));
// [FEAT-20260803-TRANSDICT] หน้าจัดการคำแปล — สิทธิ์ translation_dict.manage
const TranslationDictList = lazyWithRecovery(() => import('./pages/messaging/TranslationDictList').then(m => ({ default: m.TranslationDictList })));
const TicketSupport = lazyWithRecovery(() => import('./pages/chat/TicketSupport').then(m => ({ default: m.TicketSupport })));
const TicketChat = lazyWithRecovery(() => import('./pages/chat/TicketChat').then(m => ({ default: m.TicketChat })));
const InsightReport = lazyWithRecovery(() => import('./pages/insight/InsightReport').then(m => ({ default: m.InsightReport })));
const AssignHistory = lazyWithRecovery(() => import('./pages/handoff/AssignHistory').then(m => ({ default: m.AssignHistory })));
// ==== [FEAT-20260731-HOOKFULLPAGE] START — Standalone full page edit/clone
// revert: remove HookFormPage import
const HookFormPage = lazyWithRecovery(() => import('./pages/hook/HookFormPage').then(m => ({ default: m.HookFormPage })));
// ==== [FEAT-20260731-HOOKFULLPAGE] END
const LineQuotaEmbed = lazyWithRecovery(() => import('./pages/hook/LineQuotaEmbed').then(m => ({ default: m.LineQuotaEmbed })));

/** Shown while a route chunk is being fetched — intentionally minimal so it
 *  never flashes a heavy skeleton on a fast connection. */
const RouteFallback = () => {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center h-full w-full py-20 text-slate-400 text-sm">
      {t('common.loading', 'กำลังโหลด…')}
    </div>
  );
};
// ==== [FIX-20260729-CODESPLIT] END
import { ConfirmModal } from './components/modals';
import { SuspendedTrayButton } from './components/common/suspended/SuspendedTrayButton';
import { AlertModal } from './components/modals';
import { ChangePasswordModal } from './components/admin';
import { Menu, Globe, Sun, Moon, CircleHelp, X, Wrench, Volume2, VolumeX, Settings, Search, ChevronsUpDown, ChevronDown, Check } from 'lucide-react';
import { GearSection, fontScaleLabel, fontModeLabel } from './components/settings'; // [FEAT-20260815-GEARFOLD]
import { useTicketWS, shouldAlert, ALERT_SOUND_WINDOW_MS } from './services/chat';
/* [PERF-20260810-BARRELEAGER] Import the FILE, not the `components/chat` barrel.
 * The barrel does `export * from './FlexSlipCard'`, which chains FlexBubble →
 * dompurify (~120 KB) into the EAGER entry chunk — all to reach a 2.4 KB toast.
 * App.tsx is the only eager importer of that barrel, so naming the file moves
 * dompurify into the lazy chunk that actually renders flex, without removing it
 * (its guarding tests and the "ห้ามถอด" sanitiser rule are untouched).
 * Measured: index 414,942 → 385,541 B (−29,401 raw / −11,465 gzip), zero
 * behaviour change. ดึงไฟล์ตรง ๆ ไม่ผ่าน barrel = ไม่ลาก dompurify มา eager.
 * revert: point this back at './components/chat'. */
import { TicketToast, type ToastItem } from './components/chat/TicketToast';
import { AuthState } from './types';
// [FEAT-20260808-HTTPONLY-FE] clearStoredAuth dropped from this import — logout now
// goes through authService.logout() (below). revert: re-add clearStoredAuth here.
import { getStoredAuth, isAuthExpired } from './services/authStorage';
import { configService } from './services/admin';
// [FEAT-20260808-HTTPONLY-FE] (a) WHAT: import authService for the network logout.
// (b) WHY: logout must now hit POST /api/auth/logout so the BE clears the HttpOnly
// cookie + bumps token_version (a local clear alone leaves a valid auth cookie).
// (c) REVERT: drop this import and revert disposeSession to call clearStoredAuth().
import { authService } from './services/admin';
import { usePreference } from './hooks/usePreferences';
// [FIX-20260801-THEMEBOOT] ตัวหาธีม/ทาธีม ตัวเดียวที่ทั้ง App และ Login ใช้ร่วมกัน
import { resolveTheme, applyTheme } from './hooks/themePref';
import { useI18n } from './i18n';
import { userService } from './services/admin';
import { webhookService } from './services/hook';
import { fetchVisibleGroups, VisibleGroup, isTicketOnly } from './services/admin';
// [FEAT-20260801-ONEROW] ค่าคงที่ + ตัวเช็คว่าเคยตั้งค่านี้ไว้หรือยัง
import { ONE_ROW_PREF_PATH, ONE_ROW_DEFAULT, hasOneRowPreference, defaultOneRowForRole } from './hooks/topBarMode';

/**
 * [FIX-20260810-AUTOREFRESH] How long before expiry the session is renewed.
 *
 * 5 minutes leaves room for a slow network or one manual retry, while still
 * short enough that a token is not held client-side longer than it needs to be.
 * If the BE ever sets `JWT_EXPIRES_IN` below this, the `Math.max(0, ...)` at the
 * use site renews immediately instead of computing a negative delay.
 * ค่าน้อยกว่าอายุ token เสมอ.
 */
const SESSION_REFRESH_LEAD_MS = 5 * 60 * 1000;
// [FEAT-20260801-CHATFONT] ฟอนต์ของเว็บ (เดิม / Sarabun เฉพาะแชท / Sarabun ทุกหน้า)
import { FONT_PREF_PATH, FONT_NEW_USER_DEFAULT, FontMode, hasFontPreference, applyFontMode } from './hooks/chatFont';

const getUserInitials = (value: string) => {
  const normalized = value
    .split(' ')
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() ?? '')
    .join('');
  if (!normalized) return 'US';
  return normalized.length <= 2 ? normalized : normalized.slice(0, 2);
};


const App: React.FC = () => {
  const { t, locale, setLocale } = useI18n();
  const isDevDomain = window.location.hostname.includes('dev') || window.location.hostname === 'localhost';
  const [devGlow, setDevGlow] = useState(() => isDevDomain ? sessionStorage.getItem('devGlow') !== 'false' : false);

  useEffect(() => {
    if (isDevDomain && devGlow) {
      document.body.classList.add('dev-env');
      const style = document.createElement('style');
      style.id = 'dev-env-style';
      style.textContent = `
        .dev-env aside { box-shadow: 2px 0 18px 0px rgba(56,189,248,0.55) !important; }
        .dev-env table { box-shadow: 0 0 16px 0px rgba(56,189,248,0.35); border-radius: 8px; }
      `;
      document.head.appendChild(style);
      return () => { style.remove(); document.body.classList.remove('dev-env'); };
    } else {
      document.body.classList.remove('dev-env');
      document.getElementById('dev-env-style')?.remove();
    }
  }, [isDevDomain, devGlow]);

  const [authState, setAuthState] = useState<AuthState | null>(null);
  // Sector groups shown in the account menu — active ∩ user's groups (or ALL
  // active for super roles), same rule as everywhere else. Fetched, not read
  // straight from the (possibly stale) JWT.
  const [sectorGroups, setSectorGroups] = useState<VisibleGroup[]>([]);
  const [siteName, setSiteName] = useState('dashboard');
  const [isMobileOpen, setIsMobileOpen] = useState(false);   // mobile mega-menu drawer
  // [FEAT-20260801-TOSMENU] toast เล็กๆ ใต้ปุ่มเมนู ตอนกดแล้วไม่มีเมนูที่เข้าถึงได้
  const [menuToast, setMenuToast] = useState(false);
  const [megaOpen, setMegaOpen] = useState(true);            // desktop (lg+) mega-menu bar collapse
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isSessionTimeoutOpen, setIsSessionTimeoutOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);   // ⚙️ settings gear next to theme switch
  const [groupSearch, setGroupSearch] = useState('');
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  // Theme + notification sound now persist in DB preferences (theme used to
  // reset on reload; sound was localStorage-only). Defaults match old behavior.
  // Theme mirrors the locale pattern (the one preference that never broke):
  // a DEDICATED localStorage key written synchronously, read FIRST on boot —
  // never dependent on the auth-snapshot/preferences timing. The DB preference
  // is still written (cross-device); 'ui_theme' is the local fast path.
  const [theme, setThemePref] = usePreference<'light' | 'dark'>('ui.theme', 'light', { immediate: true });
  const themeBooted = useRef(false);
  if (!themeBooted.current) {
    themeBooted.current = true;
    try {
      const fast = localStorage.getItem('ui_theme');
      if ((fast === 'dark' || fast === 'light') && fast !== theme) {
        // apply the locally-saved theme before first paint effects run
        setTimeout(() => setThemePref(fast as 'light' | 'dark'), 0);
      }
    } catch { /* ignore */ }
  }
  const setTheme = useCallback((next: 'light' | 'dark') => {
    try { localStorage.setItem('ui_theme', next); } catch { /* ignore */ }
    applyTheme(next);   // [FIX-20260801-THEMEBOOT] ทาผ่านตัวเดียวกับที่อื่น
    setThemePref(next);
  }, [setThemePref]);
  // Font size preference — scales the whole app via the root font-size.
  // 0.9 = เล็ก, 1 = ปกติ, 1.1 = ใหญ่, 1.2 = ใหญ่มาก. Persisted immediately (DB + local).
  const [fontScale, setFontScale] = usePreference<number>('ui.fontScale', 1, { immediate: true });
  // ==== [FEAT-20260801-ONEROW] "เมนูหลัก" — แถวเดียว หรือ mega menu
  // เก็บเป็น preference ต่อผู้ใช้ (ที่เดียวกับธีม/ขนาดตัวอักษร)
  // ⚠️ ค่าเริ่มต้น = true (แถวเดียว) ตามที่ผู้ใช้กำหนด — คนที่ยังไม่เคยตั้งจะได้ค่านี้
  // ⚠️ immediate: กดแล้วต้องบันทึกทันที ไม่รอ debounce (ถ้ารีเฟรชทันทีจะไม่หาย)
  const [forceOneRow, setForceOneRow] = usePreference<boolean>(
    ONE_ROW_PREF_PATH, ONE_ROW_DEFAULT, { immediate: true }
  );
  // ==== [FEAT-20260801-CHATFONT] ฟอนต์ของเว็บ — เก็บเป็น preference ต่อผู้ใช้
  // ⚠️ immediate เหมือนตัวอื่น: กดแล้วบันทึกทันที รีเฟรชแล้วไม่หาย
  // [FIX-20260801-FONTNEWUSER] fallback ของคนที่ยังไม่มี preference = 'chat'
  //   (Sarabun เฉพาะแชท) แทน 'default' — ต้อง fallback เป็น 'chat' ด้วย ไม่ใช่แค่
  //   ตอน persist ครั้งแรก เพราะตอน reload ทั้งที่ล็อกอินอยู่ บล็อก persist ไม่ทำงาน
  //   ค่าจึงมาจาก fallback ตัวนี้ล้วนๆ · คนที่เลือก 'default' เองยังได้ 'default' ปกติ
  const [fontMode, setFontMode] = usePreference<FontMode>(
    FONT_PREF_PATH, FONT_NEW_USER_DEFAULT, { immediate: true }
  );
  // เขียน data-font ลง <html> ทุกครั้งที่ค่าเปลี่ยน (รวมตอนบูตครั้งแรก)
  // ตัว CSS ที่ตัดสินหน้าตาอยู่ใน index.html · ที่นี่แค่ประกาศค่า
  useEffect(() => { applyFontMode(fontMode); }, [fontMode]);
  const fontBooted = useRef(false);
  if (!fontBooted.current) {
    fontBooted.current = true;
    try {
      const fast = parseFloat(localStorage.getItem('ui_font_scale') || '');
      if (!Number.isNaN(fast) && fast !== fontScale) setTimeout(() => setFontScale(fast), 0);
    } catch { /* ignore */ }
  }
  useEffect(() => {
    const s = Math.min(1.2, Math.max(0.9, fontScale || 1));
    document.documentElement.style.fontSize = `${Math.round(s * 100)}%`;
    try { localStorage.setItem('ui_font_scale', String(s)); } catch { /* ignore */ }
  }, [fontScale]);

  const [pendingTheme, setPendingTheme] = useState<'light' | 'dark' | null>(null);
  const [isThemeConfirmOpen, setIsThemeConfirmOpen] = useState(false);
  const [isUserManualConfirmOpen, setIsUserManualConfirmOpen] = useState(false);
  const [alertState, setAlertState] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'success'
  });

  const [soundEnabled, setSoundEnabled] = usePreference<boolean>('ui.notiSound', true, { immediate: true });
  const [toast, setToast] = useState<ToastItem | null>(null);
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  // singleton AudioContext — reuse to avoid browser 6-instance limit
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Sound throttle: at most ONE chime per this window, no matter how many events
  // land (a burst of inbound messages/tickets must not machine-gun the speaker).
  // [FEAT-20260819-MSGALERT] the window now lives with the alert rules in
  // `services/chat/ticketAlerts.ts` (owner-set 4s) — tune it THERE. It is
  // deliberately ONE clock shared by every alerting event: that is what keeps a
  // new case, which fires ticket:new AND the message:new of its own first
  // message, down to a single beep. รัวแค่ไหนก็ดังครั้งเดียวใน 4 วิ.
  const SOUND_COOLDOWN_MS = ALERT_SOUND_WINDOW_MS;
  // -Infinity so the very FIRST chime always plays (0 would make t=0 events, and
  // the first real event when the tab just loaded, fall inside the cooldown).
  const lastSoundAtRef = useRef(-Infinity);

  const playNotiSound = useCallback(() => {
    if (!soundEnabledRef.current) return;
    // Throttle: swallow chimes that arrive within SOUND_COOLDOWN_MS of the last.
    const now = Date.now();
    if (now - lastSoundAtRef.current < SOUND_COOLDOWN_MS) return;
    lastSoundAtRef.current = now;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      // resume if browser suspended (autoplay policy)
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.35);
    } catch { /* browser blocked audio */ }
  }, []);

  useTicketWS(useCallback((event) => {
    // [FEAT-20260819-MSGALERT] WHICH events alert is decided by `shouldAlert` in
    // services/chat/ticketAlerts.ts — change the rule THERE, not here. This used
    // to fire on `ticket:new` only, with a new chat message kept silent so a new
    // case would not beep twice; that job now belongs to the shared cooldown
    // clock above, so an inbound CUSTOMER message alerts as well. Our own
    // outbound traffic (admin/bot/system) stays silent — see the case list.
    if (!shouldAlert(event as any)) return;
    /* The CORNER TOAST is for a NEW CASE only. It briefly fired for chat messages
       too and the owner removed it on 2026-08-19 ("เอาอันนี้ออก"): a busy
       conversation made it pop constantly, and an inbound message already
       announces itself — the orange number on its card, or, when that card is the
       one open, the "ได้รับข้อความใหม่" notice inside the conversation
       (components/chat/NewMessageToast.tsx). The SOUND still fires for both,
       which is what the alert rule above decides.
       ข้อความใหม่ = เสียง + เลขบนการ์ด/ป้ายกลางแชท · ไม่มี toast มุมจอ. */
    if (event.type === 'ticket:new') {
      const data = (event.data ?? {}) as any;
      setToast({ id: `${Date.now()}`, hook_name: data.hook_name || '', ts: event.ts });
    }
    playNotiSound();
  }, [playNotiSound]));



  const disposeSession = useCallback(() => {
    // [FEAT-20260808-HTTPONLY-FE] (a) WHAT: fire the network logout (which clears
    // the HttpOnly cookie server-side AND then clears local state) instead of a
    // local-only clearStoredAuth(). Fire-and-forget: the UI tears down its session
    // immediately below regardless of the network result. (b) WHY: the auth cookie
    // can only be deleted by the server. (c) REVERT: replace this line with
    // `clearStoredAuth();`.
    void authService.logout();
    setAuthState(null);
    setIsLogoutModalOpen(false);
    if (typeof window !== 'undefined') {
      window.location.hash = '#/';
    }
  }, []);

  const handleSessionTimeout = useCallback(() => {
    setIsSessionTimeoutOpen(true);
  }, [disposeSession]);

  useEffect(() => {
    const stored = getStoredAuth();
    if (!stored) return;
    if (isAuthExpired(stored)) {
      handleSessionTimeout();
      return;
    }
    setAuthState(stored);
  }, [handleSessionTimeout]);

  // Load the user's visible sector groups (active ∩ perm, or all-active for
  // super) whenever they're logged in — used by the account-menu list.
  useEffect(() => {
    if (!authState) { setSectorGroups([]); return; }
    let alive = true;
    fetchVisibleGroups().then(g => { if (alive) setSectorGroups(g); }).catch(() => {});
    return () => { alive = false; };
  }, [authState]);

  useEffect(() => {
    let isMounted = true;
    const loadSiteName = async () => {
      if (!authState) return;
      try {
        const res = await configService.listConfigs({ key_prefix: 'site_name', limit: 1 });
        const rawSiteName = res.data?.[0]?.value;
        const siteName = typeof rawSiteName === 'string' ? rawSiteName.trim() : '';
        if (!isMounted) return;
        const resolvedName = siteName || 'dashboard';
        setSiteName(resolvedName);
        localStorage.setItem('site_name', resolvedName);
        document.title = resolvedName;
      } catch (err) {
        console.warn('Failed to load site_name config', err);
        if (isMounted) {
          document.title = 'dashboard';
          setSiteName('dashboard');
        }
      }
    };
    loadSiteName();
    return () => {
      isMounted = false;
    };
  }, [authState]);

  // ==== [FIX-20260801-THEMEBOOT] ธีมที่ "แสดง" กับที่ "ใช้จริง" ต้องเป็นค่าเดียวกัน
  // เดิมคำนวณ effective ตรงนี้เอง แต่ตัวสวิตช์ด้านล่างอ่าน `theme` ดิบๆ ทั้งสอง
  // ค่าจึงหลุดจากกันได้ (ดูเหตุเต็มๆ ใน hooks/themePref.ts)
  // ตอนนี้ทั้งสวิตช์และ class ใช้ effectiveTheme ตัวเดียวกัน
  const effectiveTheme = resolveTheme(theme);
  useEffect(() => {
    // ⚠️ ต้องมี authState ใน deps ด้วย: ตอน login สำเร็จ <Login> จะ unmount แล้ว
    // cleanup ของมันเขียน class ทับ — ถ้าเราไม่ทาซ้ำหลังจากนั้น จอจะค้างตามค่าที่
    // Login เดาไว้ แทนที่จะเป็น preference จริง (นี่คือเคส "login ครั้งแรก" ที่แจ้งมา)
    // การทา class ซ้ำไม่มีผลข้างเคียง เขียนกี่รอบผลก็เท่าเดิม
    applyTheme(effectiveTheme);
  }, [effectiveTheme, authState]);
  // ==== [FIX-20260801-THEMEBOOT] END

  /* ==== [FIX-20260810-AUTOREFRESH] renew the session before it expires ====
     WHAT: this timer used to do one thing — wait for expiry, then open the
           "log in again" modal. It now wakes SESSION_REFRESH_LEAD_MS early and
           calls `authService.refresh()` first. On success the new `expiresAt`
           re-runs this effect, which arms the next timer, so the session renews
           for as long as the tab stays open.
     WHY:  `JWT_EXPIRES_IN=1h` and the cookie dies with the token, so an hour of
           work always ended in the modal and whatever was half-typed was lost.
           The BE already exposes `/api/auth/refresh` and the FE already had
           `authService.refresh()` — it was just never called anywhere except
           `pages/admin/Groups.tsx`, so nothing renewed the session app-wide.
     ⚠️ A failed refresh opens the modal exactly as before — never retry it
        silently. A 401 here can mean the token_version was bumped (permissions
        changed), and that session is MEANT to die; retrying would be an attempt
        to stay signed in after access was revoked.
     ⚠️ The `auth:invalid` listener below still handles 401s from live API calls.
        The two cover different cases and neither replaces the other.
     revert: restore `setTimeout(handleSessionTimeout, remaining)`.
     ต่ออายุอัตโนมัติ ล้มเหลวเมื่อไหร่ค่อยเด้ง modal. */
  useEffect(() => {
    if (!authState?.expiresAt) return;
    const remaining = authState.expiresAt - Date.now();
    if (remaining <= 0) {
      handleSessionTimeout();
      return;
    }
    // Wake early; a token shorter than the lead time renews at once, not on a
    // negative delay (which setTimeout would fire immediately anyway, but the
    // clamp says so on purpose).
    const wakeIn = Math.max(0, remaining - SESSION_REFRESH_LEAD_MS);
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void authService
        .refresh()
        .then((next) => {
          // Unmounted, or a different session started while the request was in
          // flight — drop the result rather than overwrite the newer state.
          if (cancelled) return;
          setAuthState(next);
        })
        .catch(() => {
          if (cancelled) return;
          handleSessionTimeout();
        });
    }, wakeIn);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [authState?.expiresAt, handleSessionTimeout]);

  useEffect(() => {
    if (!authState) return;
    const handleInvalidAuth = () => {
      setIsSessionTimeoutOpen(true);
    };
    window.addEventListener('auth:invalid', handleInvalidAuth);
    return () => {
      window.removeEventListener('auth:invalid', handleInvalidAuth);
    };
  }, [authState]);

  const handleLogin = (auth: AuthState) => {
    setAuthState(auth);
    setIsSessionTimeoutOpen(false);
    // ==== [FEAT-20260801-ONEROW] คนที่ยังไม่เคยตั้งค่านี้ → เขียนค่าเริ่มต้นลงไปเลย
    // ผู้ใช้สั่ง: "default fallback ... แล้วบันทึกให้เลยหลัง login (หากไม่เคยมี)"
    // ⚠️ เช็คจาก preferences ที่มากับ response การ login (getInitialPreferences
    //    หยิบจาก stored auth ก่อน) → ต้องเรียก **หลัง** setAuthState เท่านั้น
    // ⚠️ เขียนเฉพาะตอน "ไม่เคยมีค่านี้" — คนที่เคยตั้งไว้แล้วต้องไม่ถูกทับ
    // ⚠️ ล้มเหลวเงียบๆ ได้ — ครั้งหน้า login ก็ลองใหม่ และ fallback ก็ให้ค่าเดียวกันอยู่แล้ว
    try {
      if (isTicketOnly(auth.permissions)) {
        // ⚠️ คนที่มีแค่สิทธิ์ ticket → **บังคับทับเสมอ** ไม่ใช่เขียนเฉพาะตอนไม่เคยมี
        //    เพราะอาจเคยตั้ง false ไว้ตอนที่ยังมีสิทธิ์อื่น แล้วสิทธิ์ถูกถอดทีหลัง
        //    ถ้าไม่ทับ จะได้แถบ mega menu ที่เปิดมาว่างเปล่า
        setForceOneRow(true);
      } else if (!hasOneRowPreference()) {
        // ⚠️ เฉพาะ login ครั้งแรกที่ยังไม่มีค่านี้เท่านั้น — หลังจากนั้นผู้ใช้เลือกเอง
        //    role admin / useradmin เริ่มด้วย mega menu · นอกนั้นเริ่มด้วยแถวเดียว
        setForceOneRow(defaultOneRowForRole(auth.role?.name));
      }
      // [FEAT-20260801-CHATFONT] login ครั้งแรกที่ยังไม่เคยมีค่านี้ → เขียน default ให้เลย
      // ⚠️ เขียนเฉพาะตอน "ไม่เคยมี" เท่านั้น คนที่เคยเลือกไว้แล้วต้องไม่ถูกทับ
      //    (ต่างจาก forceOneRow ข้างบนที่มีเคสบังคับทับสำหรับคนสิทธิ์ ticket อย่างเดียว —
      //     ฟอนต์ไม่ผูกกับสิทธิ์ จึงไม่มีเคสบังคับทับ)
      if (!hasFontPreference()) {
        // [FIX-20260801-FONTNEWUSER] เขียน 'chat' (Sarabun เฉพาะแชท) ให้ user ใหม่
        // เดิมเขียน FONT_DEFAULT ('default') — ผู้ใช้เปลี่ยนค่าเริ่มต้นเป็นแชท
        setFontMode(FONT_NEW_USER_DEFAULT);
      }
    } catch { /* เขียนไม่ได้ก็ไม่เป็นไร — fallback ให้ผลเหมือนกัน */ }
  };

  const handleLogoutClick = () => {
    setIsLogoutModalOpen(true);
  };

  const confirmLogout = () => {
    disposeSession();
  };

  const closeAlert = () => setAlertState(prev => ({ ...prev, isOpen: false }));

  const submitChangePassword = async (payload: { old_password: string; password: string }) => {
    try {
      const res = await userService.changePassword(payload);
      setAlertState({
        isOpen: true,
        title: t('change_password.success_title'),
        message: res?.message || t('change_password.success_message'),
        type: 'success'
      });
    } catch (error: any) {
      setAlertState({
        isOpen: true,
        title: t('change_password.error_title'),
        message: error?.message || t('change_password.error_message'),
        type: 'error'
      });
      throw error;
    }
  };

  const isViaTelegramRoute =
    typeof window !== 'undefined' && window.location.hash.startsWith('#/via-telegram');

  if (isViaTelegramRoute) {
    return (
      <HashRouter>
        {/* [FIX-20260729-CODESPLIT] lazy page needs a Suspense boundary */}
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/via-telegram" element={<TelegramChatIdAutomate />} />
          </Routes>
        </Suspense>
      </HashRouter>
    );
  }

  // [FEAT-20260917-LINEQUOTA-EMBED] Clean standalone iframe view for /hook-quota
  const isHookQuotaRoute =
    typeof window !== 'undefined' && window.location.hash.startsWith('#/hook-quota');

  if (isHookQuotaRoute && authState) {
    return (
      <HashRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/hook-quota" element={<LineQuotaEmbed />} />
            <Route path="/hook-quota/line" element={<LineQuotaEmbed />} />
          </Routes>
        </Suspense>
      </HashRouter>
    );
  }

  const currentUser = authState?.user;
  const displayName = currentUser?.display_name ?? t('app.default_display_name');
  const username = currentUser?.username ?? 'admin';
  const initials = getUserInitials(displayName || username);
  // [FEAT-20260801-TOSMENU] มีเมนูให้กดไหม (ตามสิทธิ์ของคนที่ล็อกอินอยู่)
  // ⚠️ authState เป็น null ได้ตอนยังไม่ล็อกอิน (บรรทัดรอบๆ ใช้ authState?. หมด)
  //    ลืมใส่ ?. แล้วหน้าขาวทั้งแอปทันที — ต้องกันไว้เสมอ
  const canOpenMenu = hasAnyMenu(authState?.permissions || [], username);
  // active ∩ perm (or all-active for super) — NOT the raw JWT group list.
  const groupProviders = sectorGroups.map(g => g.group_name).filter(Boolean);

  return (
    <HashRouter>
      {!authState ? (
        <Routes>
          <Route path="*" element={<Login onLogin={handleLogin} />} />
        </Routes>
      ) : (
      (() => {
      // Ticket-only users have no mega-menu to show — hide the brand + nav and
      // let the header collapse to just the theme/profile controls, so the
      // Ticket bar underneath rises to the top. Everyone else = unchanged.
      //
      // ==== [FEAT-20260801-ONEROW] การจัดวางตัดสินด้วย preference "ค่าเดียว"
      // เดิมเป็น "สิทธิ์ ∪ ความชอบ" แล้วผู้ใช้สั่งยกเลิกเพราะสับสน — มีสองทางที่
      // ทำให้หน้าตาเปลี่ยน ไล่เหตุยากว่าตอนนี้เป็นแถวเดียวเพราะอะไร
      // → คนที่มีแค่สิทธิ์ ticket ถูก **บังคับ preference = true ตอน login** แทน
      //   (ดู handleLogin) ผลลัพธ์เหมือนเดิม แต่เหตุผลมีทางเดียว
      const ticketOnly = forceOneRow;
      // ⚠️ ใช้ **เฉพาะ** ตัดสินว่าจะโชว์หัวข้อตั้งค่า "เมนูหลัก" ไหม — ไม่ใช่โหมด
      //    คนที่มีแค่สิทธิ์ ticket เลือกไปก็ไม่มีเมนูให้ดู จึงไม่ต้องมีให้เลือก
      const ticketPermOnly = isTicketOnly(authState.permissions);
      return (
      <div className="min-h-screen bg-dark-900 text-slate-900 flex flex-col font-sans">

        {/* Main Content — full width, mega-menu replaces the sidebar */}
        <div className="flex-1 flex flex-col min-h-screen min-w-0 max-w-full w-full">
          {/* Mega-menu collapse toggle — OUTSIDE the header so it survives the
              header's collapse. Fixed, lg+ non-ticketOnly only. When open it sits
              LEFT of the theme/profile cluster (right ~356px) so it never covers
              them; when the header is collapsed that cluster is gone, so it tucks
              to the top-right corner. Arrow flips ▲/▼. z below modals (z-100). */}
          {!ticketOnly && (
            <button
              type="button"
              onClick={() => setMegaOpen((o) => !o)}
              className="tc-mega-toggle hidden lg:grid fixed z-[55] top-2 right-[356px] w-9 h-9 place-items-center rounded-full bg-transparent transition-transform hover:scale-110 active:scale-95"
              title={megaOpen ? t('pageui.app.menu_bar_hide', 'ซ่อนแถบเมนู') : t('pageui.app.menu_bar_show', 'แสดงแถบเมนู')}
              aria-expanded={megaOpen}
              aria-label={megaOpen ? t('pageui.app.menu_bar_hide', 'ซ่อนแถบเมนู') : t('pageui.app.menu_bar_show', 'แสดงแถบเมนู')}
            >
              {/* Two-tier arrow (up+down). Blue glow — deeper in light, softer in
                  dark. No white pill/background; the icon floats. */}
              <ChevronsUpDown size={24} strokeWidth={2.5} />
            </button>
          )}
          {/* Header with horizontal mega-menu. On desktop (lg+, non-ticketOnly)
              the ENTIRE header collapses away when megaOpen is false — logo, menu
              and profile all slide up and the content below moves up. */}
          <header className={`${ticketOnly ? 'h-[63px]' : (megaOpen ? 'h-16' : 'lg:h-0 lg:opacity-0 lg:pointer-events-none lg:overflow-hidden h-16')} app-topbar bg-dark-800/80 backdrop-blur-sm sticky top-0 z-50 flex items-center justify-between gap-3 px-4 md:px-6 transition-all duration-300 ease-in-out ${isDevDomain && devGlow ? 'border-b border-sky-400 shadow-[0_2px_18px_0px_rgba(56,189,248,0.65)]' : 'border-b border-dark-700'}`}>
             {/* Left: brand + mega-menu (desktop) / hamburger (mobile).
                 Ticket-only users keep the brand (site name) but lose the nav —
                 the header shrinks to brand + theme/profile, and the Ticket bar
                 sits right underneath as one compact top area. */}
             {/* [FIX-20260801-OATABMATCH] ticket-only: แท็บ OA ถูก portal มาไว้ในแถบนี้
                 ต้องให้มันสูงเต็ม header ไม่งั้นขีดใต้ของแท็บที่เลือกจะลอยกลางแถบ
                 ไม่ชนขอบล่าง (header สูง 63px และไม่มี padding แนวตั้ง)
                 ⚠️ ใช้ items-stretch เฉพาะโหมด ticket-only — โหมดปกติคงเดิมทุกค่า
                 โลโก้/ชื่อเว็บ อยู่ในกล่องลูกที่มี items-center ของตัวเอง จึงไม่เพี้ยน */}
             <div className={`flex gap-3 min-w-0 ${ticketOnly ? 'flex-1 items-stretch self-stretch' : 'items-center'}`}>
               {/* [FEAT-20260801-TOSMENU] ticket-only: เอาโลโก้ + ชื่อเว็บออก แล้วเอา
                   ปุ่ม hamburger ไปวางตรงตำแหน่งนี้แทน ตามที่ผู้ใช้สั่ง
                   (แถบของโหมดนี้แคบ พื้นที่ต้องเหลือให้แท็บ OA) */}
               {!ticketOnly && (
               <div className="flex items-center gap-2 flex-shrink-0">
                 <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-600 grid place-items-center text-white font-bold shadow-lg shadow-primary-500/30">
                   {(siteName || 'D')[0].toUpperCase()}
                 </div>
                 <span className="app-topbar-text hidden md:block text-sm font-bold text-slate-800 truncate max-w-[140px]">{siteName}</span>
               </div>
               )}
               {/* desktop mega-menu (lg+) — plain inline bar. The WHOLE header
                   collapses when hidden (see the header className), not this bar
                   alone. */}
               {!ticketOnly && (
               <div className="hidden lg:flex">
                 <MegaMenu permissions={authState.permissions || []} username={authState.user?.username || ''} />
               </div>
               )}
               {/* hamburger — เปิด/ปิด drawer เดียวกับ mega-menu ย่อ
                   (กดซ้ำแล้วปิดได้ ไม่ใช่ set-true อย่างเดียวแบบเดิม)
                   [FEAT-20260801-TOSMENU] ticket-only: **แสดงตลอดเวลา** ไม่ใช่เฉพาะจอเล็ก
                   เพราะโหมดนี้ไม่มีแถบ mega-menu แบบเต็มให้กดอยู่แล้ว
                   โหมดปกติยังเป็น lg:hidden เหมือนเดิมทุกประการ
                   ⚠️ self-center เพราะกล่องแม่ของ ticket-only เป็น items-stretch
                      (ทำไว้ให้แท็บ OA สูงเต็มแถบ) ปุ่มจะได้ไม่ยืดสูงตาม */}
               {/* ==== [FEAT-20260801-TOSMENU] ปุ่มเมนู + toast ตอนไม่มีสิทธิ์
                   ⚠️ ตัดสิน "มีเมนูไหม" ด้วย hasAnyMenu() ซึ่งใช้ SECTIONS +
                      item.show(ctx) **ชุดเดียวกับที่ MegaMenu เรนเดอร์จริง**
                      ไม่เขียนกฎสิทธิ์ซ้ำ — กันเคส "ปุ่มกดได้แต่เปิดมาว่าง"
                   ⚠️ **ไม่ใช้ disabled** เพราะปุ่มที่ disabled จะไม่ยิง onClick เลย
                      แล้ว toast จะไม่มีวันขึ้น · ใช้วิธีกดได้แต่ไม่เปิด drawer แทน
                      (ยังทำให้จาง + cursor บอกว่ากดไม่ได้ผล)
                   ⚠️ ตัวครอบต้อง relative เพื่อให้ toast เกาะตำแหน่งปุ่มพอดี
                   revert: ลบ state menuToast + บล็อก toast + คืนปุ่มเป็นแบบเดิม */}
               <div className={`relative ${ticketOnly ? 'self-center' : 'lg:hidden'}`}>
                 <button
                   onClick={() => {
                     if (!canOpenMenu) {
                       setMenuToast(true);
                       window.setTimeout(() => setMenuToast(false), 2200);
                       return;
                     }
                     setIsMobileOpen((o) => !o);
                   }}
                   className={`p-2 text-slate-600 rounded-lg transition-colors app-topbar-icon ${
                     canOpenMenu
                       ? 'hover:text-slate-900 hover:bg-dark-700'
                       : 'opacity-40 cursor-not-allowed'
                   }`}
                   aria-expanded={isMobileOpen}
                   aria-label={t('app.menu') || 'menu'}
                   title={canOpenMenu ? undefined : t('app.no_menu_access')}
                 >
                   {isMobileOpen ? <X size={24} /> : <Menu size={24} />}
                 </button>
                 {menuToast && (
                   <div
                     role="status"
                     className="absolute left-0 top-full mt-1.5 z-[60] whitespace-nowrap rounded-lg bg-slate-900 text-white text-[11px] font-medium px-2.5 py-1.5 shadow-xl border border-white/10 animate-in fade-in slide-in-from-top-1 duration-150"
                   >
                     {t('app.no_menu_access')}
                   </div>
                 )}
               </div>
               {/* Ticket-only: the OA switcher (group tabs) is portaled up here from
                   TicketChat so the whole app lives on one header row. */}
               {ticketOnly && <div id="tc-header-oa-slot" className="flex items-stretch self-stretch min-w-0 flex-1" />}
             </div>

             {/* Right: [ticket-only status slot] + theme toggle + settings button */}
             <div className="flex items-center gap-2 flex-shrink-0">
             {ticketOnly && <div id="tc-header-status-slot" className="flex items-center shrink-0" />}
             {/* Theme switch — sliding sun/moon pill, mirrors the mock. Everyone can use it. */}
             <button
               type="button"
               /* [FIX-20260801-THEMEBOOT] เดิม 3 จุดนี้อ่าน `theme` ดิบๆ ซึ่งเป็น
                  preference ที่โหลดแบบ async → ตอน boot ไม่ตรงกับ class ที่ทาจริง
                  ทำให้ไอคอนขึ้นพระจันทร์ทั้งที่จอเป็น light · ใช้ค่าเดียวกันแล้ว */
               onClick={() => setTheme(effectiveTheme === 'light' ? 'dark' : 'light')}
               className="theme-switch box-border relative w-[72px] h-8 rounded-full flex-shrink-0"
               title={effectiveTheme === 'light' ? t('app.theme_light') : t('app.theme_dark')}
               aria-label="Toggle theme"
             >
               {/* 26px round knob, vertically centered (top-1/2 + -translate-y-1/2)
                   so top/bottom gaps are always equal regardless of the 1px border.
                   Off: left 3px. On: translate 72 − 26 − 3 − 3 − 2(borders) = 38px. */}
               <span className={`theme-switch-thumb absolute left-[3px] top-1/2 -translate-y-1/2 w-[26px] h-[26px] rounded-full transition-transform duration-200 ${effectiveTheme === 'dark' ? 'translate-x-[38px]' : ''}`} />
               <span className="theme-sun absolute left-[3px] top-1/2 -translate-y-1/2 w-[26px] h-[26px] grid place-items-center pointer-events-none"><Sun size={14} /></span>
               <span className="theme-moon absolute right-[3px] top-1/2 -translate-y-1/2 w-[26px] h-[26px] grid place-items-center pointer-events-none"><Moon size={14} /></span>
             </button>

             {/* ⚙️ Settings gear — next to the theme switch. One place for sound +
                 language + font size (relocated from the account menu). The ticket
                 page portals its "การแสดงกลุ่ม / Quick Reply" controls into
                 #tc-gear-slot below (shown only on that page). Behaviour unchanged. */}
             <div className="relative z-[60]">
               <button
                 type="button"
                 onClick={() => setGearOpen(o => !o)}
                 /* [FIX-20260731-TOPBARTEXT] ธีม light ใช้แถบบนสีเข้ม ไอคอนเทาเดิมจึงจม
                    ใส่ `app-topbar-icon` เฉพาะตอน "ยังไม่เปิด" — ตอนเปิดยังเป็นสีฟ้า
                    active ตามเดิม (ผู้ใช้สั่ง "setting tool สีเดิม ตามธีม")
                    revert: ลบ app-topbar-icon ออกจาก class ฝั่ง else */
                 /* [FIX-20260801-USERCHIP] ⚠️ ใช้ border-[1px] ไม่ใช่ `border` เปล่าๆ
                    เพราะ index.html มีกฎ global ในธีม light:
                      html:not(.theme-dark) .border { border-color:#DCE3EC !important }
                    ซึ่งจะทับสีขอบที่ตั้งไว้ทันที (ธีมสวิชเชอร์ข้างๆ รอดเพราะไม่มีคลาส
                    `border`) · ใช้ border-[1px] แล้ว selector นั้นไม่จับ สีจึงอยู่ตามที่ตั้ง */
                 className={`relative z-[61] p-2.5 rounded-xl border-[1px] transition-colors flex-shrink-0 ${gearOpen ? 'border-primary-400 bg-primary-50 text-primary-600' : 'app-topbar-icon border-white/10 text-slate-500 hover:bg-slate-100'}`}
                 title={t('app.settings') || 'ตั้งค่า'}
                 aria-expanded={gearOpen}
                 aria-haspopup="menu"
               >
                 <Settings size={16} />
               </button>
               {gearOpen && (
                 <>
                   {/* backdrop: subtle 20% blur behind the panel; blocks clicks but
                       does NOT close (dismiss via the X / ปิด only). */}
                   <div className="fixed inset-0 z-[55] backdrop-blur-[2px] bg-slate-900/10" />
                   {/* wrapper positions the dropdown; the floating X is a sibling so
                       it can sit OUTSIDE the scroll box (which clips overflow-x). */}
                   <div className="app-popover absolute right-0 top-full mt-2 w-[320px] max-w-[calc(100vw-1rem)] z-[60]">
                     {/* floating X — pulled out past the top-left corner so it never
                         overlaps the sound button. Blue tint (light darker / dark
                         lighter), 50% bigger than before. */}
                     <button
                       type="button"
                       onClick={() => setGearOpen(false)}
                       className="gear-x absolute -top-4 -left-5 z-[62] w-11 h-11 grid place-items-center rounded-full shadow-md transition-colors"
                       aria-label="close"
                     >
                       <X size={22} />
                     </button>
                     <div className="w-full rounded-2xl border border-slate-200 bg-white shadow-xl overflow-y-auto custom-scrollbar max-h-[calc(100vh-90px)]">
                     {/* sound + language (+ dev-glow) */}
                     <div className="p-3 flex flex-wrap gap-2 border-b border-slate-100 [&>button]:flex-1 [&>button]:min-w-[44px] [&>button]:justify-center">
                       <button
                         type="button"
                         onClick={() => setSoundEnabled(!soundEnabled)}
                         className={`p-2 rounded-lg border text-xs inline-flex items-center gap-1 ${soundEnabled ? 'border-emerald-400 bg-emerald-50 text-emerald-600' : 'border-slate-300 text-slate-400'}`}
                         title={soundEnabled ? t('pageui.app.sound_on_title', 'เสียงแจ้งเตือน: เปิด') : t('pageui.app.sound_off_title', 'เสียงแจ้งเตือน: ปิด')}
                       >
                         {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                       </button>
                       {isDevDomain && (
                         <button
                           type="button"
                           onClick={() => setDevGlow(v => { const next = !v; if (isDevDomain) sessionStorage.setItem('devGlow', String(next)); return next; })}
                           className={`p-2 rounded-lg border inline-flex items-center ${devGlow ? 'border-sky-400 bg-sky-50 text-sky-500' : 'border-slate-300 text-slate-400'}`}
                           title="Dev Glow"
                         >
                           <Wrench size={16} />
                         </button>
                       )}
                       {(['th','en'] as const).map(lng => (
                         <button
                           key={lng}
                           type="button"
                           onClick={() => setLocale(lng)}
                           className={`px-2.5 py-2 rounded-lg border text-xs font-semibold inline-flex items-center gap-1 ${locale === lng ? 'border-primary-400 bg-primary-50 text-primary-600' : 'border-slate-300 text-slate-500'}`}
                         >
                           <Globe size={13} />{lng.toUpperCase()}
                         </button>
                       ))}
                     </div>
                     {/* [FEAT-20260815-GEARFOLD] folded card — buttons untouched */}
                     <GearSection title={t('app.font_size')} value={fontScaleLabel(fontScale, t)}>
                       <div className="flex items-center gap-1.5 px-2 pb-1">
                         {([
                           { v: 0.9, label: t('app.font_small') },
                           { v: 1, label: t('app.font_normal') },
                           { v: 1.1, label: t('app.font_large') },
                           { v: 1.2, label: t('app.font_xlarge') },
                         ]).map(opt => {
                           const active = Math.abs((fontScale || 1) - opt.v) < 0.001;
                           return (
                             <button
                               key={opt.v}
                               type="button"
                               onClick={() => setFontScale(opt.v)}
                               className={`flex-1 px-2 py-1.5 rounded-lg border font-semibold inline-flex items-center justify-center gap-1 transition-colors ${active ? 'border-primary-400 bg-primary-50 text-primary-600' : 'border-slate-300 text-slate-500 hover:bg-slate-50'}`}
                               style={{ fontSize: `${Math.round(opt.v * 12)}px` }}
                               title={opt.label}
                             >
                               <span>ก</span><span className="text-[11px]">{opt.label}</span>
                             </button>
                           );
                         })}
                       </div>
                     </GearSection>
                     {/* ==== [FEAT-20260801-ONEROW] หัวข้อ "เมนูหลัก"
                          ⚠️ โชว์เฉพาะคนที่ **ไม่ใช่ ticket-only จริงตามสิทธิ์**
                             คนที่เป็น ticket-only อยู่แล้วเลือกไปก็ไม่มีเมนูให้ดู
                             จึงไม่ต้องมีตัวเลือกให้สับสน
                          ⚠️ ใช้ ticketPermOnly (สิทธิ์) ไม่ใช่ ticketOnly (การจัดวาง)
                             — ถ้าใช้ตัวหลัง พอเลือก "แถวเดียว" หัวข้อจะหายไปเอง
                               แล้วกดกลับไม่ได้อีก (ขังตัวเอง)
                          รูปแบบปุ่มลอกจาก "การแสดงกลุ่ม" ของหน้า ticket ให้เข้าชุดกัน
                          revert: ลบบล็อกนี้ */}
                     {!ticketPermOnly && (
                       <GearSection title={t('app.main_menu')} value={forceOneRow ? t('app.main_menu_one_row') : t('app.main_menu_mega')}>
                         {([
                           { v: true, label: t('app.main_menu_one_row'), desc: t('app.main_menu_one_row_desc') },
                           { v: false, label: t('app.main_menu_mega'), desc: t('app.main_menu_mega_desc') },
                         ]).map(opt => {
                           const active = forceOneRow === opt.v;
                           return (
                             <button
                               key={String(opt.v)}
                               type="button"
                               onClick={() => {
                                 setForceOneRow(opt.v);
                                 // [FEAT-20260801-ONEROW] บอกหน้า ticket ให้ย้ายแท็บ OA ทันที
                                 // (มันอ่านโหมดจาก hooks/topBarMode ซึ่งอ่านจากแคช —
                                 //  ไม่มี event นี้จะต้องรีเฟรชก่อนถึงจะเห็นผล)
                                 // ⚠️ ยิงหลัง setForceOneRow เพื่อให้แคชถูกเขียนก่อนแล้ว
                                 //    (usePreference immediate เขียน local แบบ synchronous)
                                 window.dispatchEvent(new CustomEvent('app:topbar-mode-changed'));
                               }}
                               className={`w-full flex items-start gap-2 px-2 py-2 rounded-lg text-left transition-colors ${active ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                             >
                               <span className={`mt-0.5 shrink-0 ${active ? 'text-primary' : 'text-transparent'}`}><Check size={14} /></span>
                               <span className="min-w-0">
                                 <span className={`block text-xs font-bold ${active ? 'text-primary' : 'text-gray-700'}`}>{opt.label}</span>
                                 <span className="block text-[10px] text-gray-400 leading-tight">{opt.desc}</span>
                               </span>
                             </button>
                           );
                         })}
                       </GearSection>
                     )}
                     {/* ==== [FEAT-20260801-CHATFONT] หัวข้อ "ฟอนต์"
                          รูปแบบปุ่มลอกจากหัวข้อ "เมนูหลัก" ข้างบนให้เข้าชุดกัน
                          ⚠️ ไม่ผูกกับสิทธิ์ — ทุกคนเห็นและเลือกได้ (ต่างจาก "เมนูหลัก"
                             ที่ซ่อนจากคนสิทธิ์ ticket อย่างเดียว)
                          revert: ลบบล็อกนี้ */}
                     <GearSection title={t('app.font')} value={fontModeLabel(fontMode, t)}>
                       {([
                         { v: 'default' as FontMode, label: t('app.font_default'), desc: t('app.font_default_desc') },
                         { v: 'chat' as FontMode, label: t('app.font_chat'), desc: t('app.font_chat_desc') },
                         { v: 'all' as FontMode, label: t('app.font_all'), desc: t('app.font_all_desc') },
                       ]).map(opt => {
                         const active = fontMode === opt.v;
                         return (
                           <button
                             key={opt.v}
                             type="button"
                             onClick={() => {
                               setFontMode(opt.v);
                               // เขียน attribute ทันทีด้วย ไม่รอ effect — กดแล้วต้องเห็นผลเดี๋ยวนั้น
                               applyFontMode(opt.v);
                             }}
                             className={`w-full flex items-start gap-2 px-2 py-2 rounded-lg text-left transition-colors ${active ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                           >
                             <span className={`mt-0.5 shrink-0 ${active ? 'text-primary' : 'text-transparent'}`}><Check size={14} /></span>
                             <span className="min-w-0">
                               <span className={`block text-xs font-bold ${active ? 'text-primary' : 'text-gray-700'}`}>{opt.label}</span>
                               <span className="block text-[10px] text-gray-400 leading-tight">{opt.desc}</span>
                             </span>
                           </button>
                         );
                       })}
                     </GearSection>
                     {/* Ticket page portals การแสดงกลุ่ม / Quick Reply controls here. */}
                     <div id="tc-gear-slot" />
                     {/* Close — blue-tinted, the primary dismiss action. */}
                     <button
                       type="button"
                       onClick={() => setGearOpen(false)}
                       className="gear-close w-full py-3 border-t border-blue-100 text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors"
                     >
                       <X size={18} /> {t('common.close', 'ปิด')}
                     </button>
                     </div>
                   </div>
                 </>
               )}
             </div>

             {/* [FEAT-20260826-STRIKESUSPEND] ระหว่างฟันเฟืองกับชิพผู้ใช้ ตามที่เจ้าของสั่ง
                 ⚠️ บรรทัดเดียวโดยตั้งใจ — ไฟล์นี้ 1,300+ บรรทัดและอยู่ใน waiver list ของ
                 `max-lines` ซึ่ง §6.1 บอกว่า "หดได้อย่างเดียว ห้ามโต" ⇒ ตรรกะทั้งหมด
                 อยู่ใน `components/common/suspended/` · ถอดฟีเจอร์ = ลบโฟลเดอร์ + ลบบรรทัดนี้
                 📖 แผน: `omnidesk-api/todo/task/26082026/todo10_26082026_strike-suspend.md` */}
             {/* [FEAT-2708-TRAYNOCLEAR] ถาดไม่รับสิทธิ์อีกแล้ว — ปุ่มเคลียร์ถูกถอด
                 (ยกเลิกทำที่ modal สถิติ strike จาก avatar · จุดนั้นยังเช็ค
                 permAllows ใน TicketChat ตาม [FIX-2708-STRIKESUPERADMIN]) */}
             <SuspendedTrayButton />

             <div className="relative">
               {/* ==== [FIX-20260801-USERCHIP] ชิพผู้ใช้ตามภาพอ้างอิงที่ผู้ใช้ส่ง
                    เดิม: วงกลม + ชื่อบรรทัดเดียว ในกล่องมุมมน rounded-xl
                    ใหม่: ชื่อบรรทัดบน / role บรรทัดล่าง + ลูกศรท้าย + มุมมนขึ้น
                    ⚠️ ปุ่มเดิมทำอะไร ยังทำเหมือนเดิมทุกอย่าง (เปิด/ปิดเมนูบัญชี
                       · aria-expanded · title) — เปลี่ยนแค่สิ่งที่แสดงข้างใน
                    ⚠️ role อ่านจาก authState.role.name ที่มีอยู่แล้ว ไม่ได้เรียก API เพิ่ม
                       ไม่มี role → ไม่แสดงบรรทัดล่าง (ไม่โชว์ค่าว่างให้เกะกะ)
                    ⚠️ ลูกศรหมุนตามสถานะเปิด/ปิด ให้รู้ว่ากดได้
                    revert: เอาบล็อกปุ่มเดิม (วงกลม + span ชื่อ) กลับมา */}
               <button
                 type="button"
                 onClick={() => setIsSettingsOpen(open => !open)}
                 /* [FIX-20260801-USERCHIP] ขอบจางเหลือ 10% ให้เท่ากับธีมสวิชเชอร์ที่อยู่ข้างกัน
                    (index.css ใช้ rgba(255,255,255,0.10) — ยกค่าเดียวกันมาใช้
                     ทั้งแถวจะได้ดูเป็นชุดเดียวกัน ไม่มีอันไหนเด่นกว่าเพื่อน) */
                 className="app-topbar-icon flex items-center gap-2.5 pl-2 pr-2.5 py-1.5 rounded-2xl border-[1px] border-white/10 text-slate-500 hover:bg-slate-100 transition-colors"
                 title={t('app.account_menu')}
                 aria-expanded={isSettingsOpen}
                 aria-haspopup="menu"
               >
                 <div
                   className="w-7 h-7 shrink-0 rounded-full grid place-items-center text-[10px] font-bold text-white"
                   /* [FIX-20260801-USERCHIP] ⚠️ ใช้ inline style ไม่ใช่คลาส gradient
                      เพราะ index.html มีกฎ html.theme-dark ... !important หลายตัว
                      ที่ทับพื้นหลังตามชื่อคลาส ทำให้วงกลมกลายเป็นสีเข้มในธีม dark
                      inline style ชนะทุกกฎ → dark กับ light ได้สีเดียวกันแน่นอน */
                   style={{ backgroundImage: 'linear-gradient(135deg,#8b5cf6,#4f46e5)' }}
                 >
                   {initials}
                 </div>
                 {/* [FIX-20260731-TOPBARTEXT] ชื่อผู้ล็อกอินรับสีมาจากปุ่มแม่ ซึ่งจม
                     กับแถบบนสีเข้มในธีม light — ทาสีที่ตัวข้อความเอง
                     (avatar วงกลมยังใช้สีตามธีมเดิม ตามที่ผู้ใช้สั่ง) */}
                 <span className="app-topbar-text hidden sm:flex flex-col items-start leading-tight min-w-0">
                   {/* [FIX-20260801-USERCHIP]
                       บรรทัดบน = **ชื่อแสดง** (`display_name`) — dev → "Developer"
                       บรรทัดล่าง = **username** (ไอดีล็อกอิน) — ไม่ใช่ชื่อ role
                       ⚠️ ตาราง users ไม่มีฟิลด์ `nickname` แยก มีแค่ 2 ตัวนี้
                       ⚠️ บางบัญชี display_name == username (เช่น `ticket`) จะซ้ำกัน
                          → ซ่อนบรรทัดล่างไปเลย ไม่โชว์คำเดิม 2 รอบให้รก */}
                   <span className="text-xs font-bold max-w-[120px] truncate">{displayName}</span>
                   {/* ⚠️ โชว์เสมอแม้จะซ้ำกับ display_name (บัญชี `ticket` เป็นแบบนั้น)
                       — ผู้ใช้ต้องการเห็นทั้ง 2 บรรทัดตลอด ไม่ต้องยุบ */}
                   <span className="text-[10px] font-medium opacity-70 max-w-[120px] truncate">{username}</span>
                 </span>
                 <ChevronDown
                   size={14}
                   className={`app-topbar-icon shrink-0 transition-transform duration-200 ${isSettingsOpen ? 'rotate-180' : ''}`}
                 />
               </button>

               {isSettingsOpen && (
                 <>
                   {/* click-outside backdrop — above the header so clicking the
                       nav also closes the panel */}
                   <div className="fixed inset-0 z-[55]" onClick={() => setIsSettingsOpen(false)} />
                   <div
                     className="absolute right-0 top-full mt-2 w-[374px] max-w-[calc(100vw-1rem)] rounded-2xl border border-slate-200 bg-white shadow-xl overflow-y-auto custom-scrollbar max-h-[calc(100vh-90px)] z-[60]"
                     onMouseLeave={() => setIsSettingsOpen(false)}
                   >
                     {/* account header */}
                     <div className="pl-7 pr-4 py-3 border-b border-slate-100 flex items-center gap-3">
                       {/* [FIX-20260801-USERCHIP] ใช้สีเดียวกับ avatar บนชิพด้านนอก
                           ไม่งั้นกดเปิดเมนูแล้ววงกลมเปลี่ยนสี ดูเหมือนคนละคน */}
                       <div
                         className="flex-shrink-0 w-9 h-9 rounded-full grid place-items-center text-xs font-bold text-white"
                         style={{ backgroundImage: 'linear-gradient(135deg,#8b5cf6,#4f46e5)' }}
                       >{initials}</div>
                       <div className="min-w-0 flex-1">
                         <div className="text-sm font-semibold text-slate-800 truncate">{displayName}</div>
                         <div className="text-xs text-slate-500 truncate">{username}</div>
                       </div>
                       <button
                         type="button"
                         onClick={() => setIsSettingsOpen(false)}
                         className="flex-shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                         aria-label="close"
                       >
                         <X size={18} />
                       </button>
                     </div>

                     {/* toggles row — buttons share the width evenly (flex-1) so
                         they're wider and fit whatever count is visible; flex-wrap
                         keeps them from overflowing on a narrow panel. */}
                     {/* sound / language / font-size moved to the ⚙️ gear next to the
                         theme switch. */}

                     {/* actions */}
                     <button type="button" onClick={() => { setIsSettingsOpen(false); setIsUserManualConfirmOpen(true); }} className="w-full pl-7 pr-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2">
                       <CircleHelp size={15} />{t('app.user_manual')}
                     </button>
                     <button type="button" onClick={() => { setIsSettingsOpen(false); setIsChangePasswordOpen(true); }} className="w-full pl-7 pr-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 border-t border-slate-100">
                       {t('app.change_password')}
                     </button>
                     <button type="button" onClick={() => { setIsSettingsOpen(false); handleLogoutClick(); }} className="w-full pl-7 pr-4 py-3 text-left text-sm font-semibold text-red-600 hover:bg-red-50 border-t border-slate-100">
                       {t('app.logout')}
                     </button>
                   </div>
                 </>
               )}
             </div>
             </div>
          </header>

          {/* Mobile menu drawer (mega-menu vertical) */}
          {isMobileOpen && (
            // Starts BELOW the sticky header (h-16) so the drawer doesn't cover
            // the top bar / hamburger and its content isn't flush to the edge.
            <div className={`${ticketOnly ? 'top-[63px]' : 'lg:hidden top-16'} fixed inset-x-0 bottom-0 z-40`}>
              <div className="absolute inset-0 bg-black/40" onClick={() => setIsMobileOpen(false)} />
              {/* The panel itself must NOT close on any click — otherwise tapping
                  a section header (accordion expand/collapse) closes the whole
                  drawer. It closes only via the backdrop, the header X, or a real
                  nav item (MegaMenu's onItemClick). */}
              <div className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl overflow-y-auto p-4">
                {/* No title/close row here — the header's hamburger toggles to an
                    X and closes the drawer, so a second X would be redundant. */}
                <MegaMenu permissions={authState.permissions || []} username={authState.user?.username || ''} isMobile onItemClick={() => setIsMobileOpen(false)} />
              </div>
            </div>
          )}

          {/* --app-header-h tracks the CURRENT header height so full-height pages
              (TicketChat) size to the real remaining space. It shrinks to 0 when
              the desktop header is collapsed, so those pages grow to fill the gap
              instead of leaving a dead strip at the bottom. */}
          <main
            className="p-4 md:p-6 lg:p-8 flex-1 overflow-x-hidden overflow-y-auto w-full min-w-0 max-w-[100vw]"
            style={{ ['--app-header-h' as any]: ticketOnly ? '63px' : (megaOpen ? '64px' : '0px') }}
          >
            {/* [FIX-20260729-CODESPLIT] every page below is lazy — one boundary
                here covers them all, so switching routes shows the fallback only
                on the first visit to each page (the chunk is cached after that) */}
            {/* [FIX-20260922-CHUNKSTUCK] The boundary sits OUTSIDE the
                Suspense on purpose: a chunk that fails to load rejects the
                lazy promise, and only something above Suspense can catch it.
                Inside, React would simply keep waiting. */}
            <RouteErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route
                path="/"
                element={
                  // ==== [FIX-20260729-LANDING] START — 🔒 AUTO track
                  // Send people to the page they can actually use.
                  //
                  // ⚠️ This check existed (a29febb) and was lost in 43e6bfc, when
                  // restoring another session's work overwrote this file. An
                  // account holding only ticket.manage landed on a Dashboard it
                  // has no permission to read.
                  //
                  // superadmin always gets the Dashboard — it holds ticket.manage
                  // too, and would otherwise be redirected like everyone else.
                  // Anyone else with ticket.manage goes straight to the chat.
                  // revert: element={<Dashboard />}
                  authState.role?.name === 'superadmin'
                    ? <Dashboard />
                    : authState.permissions?.includes('ticket.manage')
                      ? <Navigate to="/ticket-support" replace />
                      : <Dashboard />
                  // ==== [FIX-20260729-LANDING] END
                }
              />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/simulator" element={<Simulator />} />
              {/* FORCE: /chat now redirects straight to /ticket-support (the new
                  chat UI). To restore the old standalone Chat page, swap the
                  element back to the permission-gated <Chat/> block below:
                    element={(superadmin|superuser|dev) ? <Chat/> : <Navigate to="/"/>}
                  (Chat import + component are kept.) */}
              <Route
                path="/chat"
                element={<Navigate to="/ticket-support" replace />}
              />
              <Route path="/demo-chat" element={<Navigate to="/chat" replace />} />
              <Route
                path="/slip-verify"
                element={authState.permissions?.includes('slip.manage') ? <SlipVerification /> : <Navigate to="/" replace />}
              />
              <Route
                path="/hooks"
                element={authState.permissions?.includes('hook.manage') ? <WebhookList /> : <Navigate to="/" replace />}
              />
              <Route path="/hook-quota" element={<LineQuotaEmbed />} />
              <Route path="/hook-quota/line" element={<LineQuotaEmbed />} />
              {/* [FEAT-20260805-CHAIN] handoff chains config + run history — revert: remove this route + the lazy import */}
              <Route
                path="/handoff-chains"
                element={permAllows(authState.permissions || [], 'handoff.manage') ? <HandoffChains /> : <Navigate to="/" replace />}
              />
              {/* [FEAT-20260806-HISTORY] handoff history — own perm handoff.history OR handoff.manage (superadmin bypass) */}
              <Route
                path="/handoff-history"
                element={(permAllows(authState.permissions || [], 'handoff.history') || permAllows(authState.permissions || [], 'handoff.manage')) ? <HandoffHistory /> : <Navigate to="/" replace />}
              />
              {/* ==== [FEAT-20260731-HOOKFULLPAGE] START — Full page edit / clone routes
                  revert: remove these 6 route blocks */}
              <Route
                path="/hooks/edit/:id"
                element={authState.permissions?.includes('hook.manage') ? <HookFormPage mode="edit" /> : <Navigate to="/" replace />}
              />
              <Route
                path="/hooks/clone/:id"
                element={authState.permissions?.includes('hook.manage') ? <HookFormPage mode="clone" /> : <Navigate to="/" replace />}
              />
              <Route
                path="/hooks/create"
                element={authState.permissions?.includes('hook.manage') ? <HookFormPage mode="create" /> : <Navigate to="/" replace />}
              />
              <Route
                path="/hooks/view/:id"
                element={authState.permissions?.includes('hook.manage') ? <HookFormPage mode="view" /> : <Navigate to="/" replace />}
              />
              <Route path="/webhooks/edit/:id" element={<Navigate to="/hooks/edit/:id" replace />} />
              <Route path="/webhooks/clone/:id" element={<Navigate to="/hooks/clone/:id" replace />} />
              {/* ==== [FEAT-20260731-HOOKFULLPAGE] END */}
              <Route
                path="/auto-replies"
                element={authState.permissions?.includes('auto_reply.manage') ? <AutoReplies /> : <Navigate to="/" replace />}
              />
              <Route
                path="/broadcasts"
                element={authState.permissions?.includes('broadcast.manage') ? <Broadcasts /> : <Navigate to="/" replace />}
              />
              <Route
                path="/groups"
                element={authState.permissions?.includes('group.manage') ? <Groups /> : <Navigate to="/" replace />}
              />
              <Route
                path="/users"
                element={authState.permissions?.includes('user.manage') ? <Users /> : <Navigate to="/" replace />}
              />
              <Route
                path="/audit"
                element={authState.permissions?.includes('audit.manage') ? <AuditLogs /> : <Navigate to="/" replace />}
              />
              <Route
                path="/webhook-logs"
                element={authState.permissions?.includes('webhook_log.manage') ? <WebhookLogs /> : <Navigate to="/" replace />}
              />
              <Route
                path="/config"
                element={
                  authState.permissions?.includes('config.manage')
                    ? <SystemConfig /> 
                    : <Navigate to="/" replace />
                }
              />
              <Route
                path="/object-images"
                element={authState.permissions?.includes('object.manage') ? <ObjectImageList /> : <Navigate to="/" replace />}
              />
              <Route
                path="/object-categories"
                element={authState.permissions?.includes('object.manage') ? <ObjectCategoryList /> : <Navigate to="/" replace />}
              />
              <Route
                path="/flex-messages"
                element={authState.permissions?.includes('flex.manage') ? <FlexMessageList /> : <Navigate to="/" replace />}
              />
              <Route
                path="/dynamic-tags"
                 element={authState.permissions?.includes('dynamic_tags.manage') ? <DynamicTagList /> : <Navigate to="/" replace />}
              />
              {/* [FEAT-20260729-CUSTOOL] 🔒 สาย AUTO — to_dev_auto เท่านั้น
                  ไม่มีสิทธิ์ custom_tools.manage = เด้งกลับหน้าแรก (fallback เดียวกับหน้าอื่น)
                  เมนูฝั่ง BE ก็ซ่อนด้วย permission ตัวเดียวกัน (aclMigrationService) */}
              <Route
                path="/custom-tools"
                 element={authState.permissions?.includes('custom_tools.manage') ? <CustomTools /> : <Navigate to="/" replace />}
              />
              {/* [FEAT-20260805-HANDOFF] Handoff targets — guard mirrors BE authorize():
                  system.manage/* passes, so a superadmin sees + enters it without seeding
                  handoff.manage. permAllows keeps the menu and this route in lockstep. */}
              <Route
                path="/handoff"
                 element={permAllows(authState.permissions || [], 'handoff.manage') ? <HandoffTargets /> : <Navigate to="/" replace />}
              />
              {/* [FEAT-20260803-TRANSDICT] พจนานุกรมคำแปล — กติกาเดียวกับหน้าอื่น
                  ไม่มีสิทธิ์ = เด้งกลับหน้าแรก · เมนูฝั่ง BE ซ่อนด้วย permission ตัวเดียวกัน */}
              <Route
                path="/translation-dict"
                 element={authState.permissions?.includes('translation_dict.manage') ? <TranslationDictList /> : <Navigate to="/" replace />}
              />
              {/* Ticket Support is now the omnichannel chat-first view (route unchanged). */}
              <Route
                path="/ticket-support"
                 element={authState.permissions?.includes('ticket.manage') ? <TicketChat /> : <Navigate to="/" replace />}
              />
              {/* Legacy DataTable ticket view — kept reachable after the omnichannel merge. */}
              <Route
                path="/legacy-ticket"
                 element={authState.permissions?.includes('ticket.manage') ? <TicketSupport /> : <Navigate to="/" replace />}
              />
              <Route
                path="/insight-report"
                 element={authState.permissions?.includes('insight.manage') ? <InsightReport /> : <Navigate to="/" replace />}
              />
              <Route
                path="/assign-history"
                 element={authState.permissions?.includes('assign_history.manage') ? <AssignHistory /> : <Navigate to="/" replace />}
              />
              {/* [FIX-20260729-CONTACTPERM] guard the route like every neighbour.
                  The menu entry was already hidden without contact.manage, but
                  the route itself rendered for anyone who typed the URL — the
                  page then loads chat rooms and customer profiles, so a hidden
                  menu was not actually protecting anything.
                  revert: restore `element={<Contact />}`. */}
              <Route
                path="/contacts"
                 element={authState.permissions?.includes('contact.manage') ? <Contact /> : <Navigate to="/" replace />}
              />
              <Route
                path="/contact"
                 element={<Navigate to="/contacts" replace />}
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
            </RouteErrorBoundary>
          </main>
        </div>

        <ConfirmModal 
          isOpen={isLogoutModalOpen}
          onClose={() => setIsLogoutModalOpen(false)}
          onConfirm={confirmLogout}
          title={t('app.sign_out_title')}
          message={t('app.sign_out_message')}
          type="warning"
        />

        <ConfirmModal
          isOpen={isThemeConfirmOpen}
          onClose={() => {
            setIsThemeConfirmOpen(false);
            setPendingTheme(null);
          }}
          onConfirm={() => {
            // setTheme writes the dedicated ui_theme key + applies the class
            // synchronously + persists the preference — lands on the 1st click
            // and survives an immediate reload.
            const next = pendingTheme || (theme === 'light' ? 'dark' : 'light');
            setTheme(next);
            setIsThemeConfirmOpen(false);
            setPendingTheme(null);
          }}
          title={t('app.theme_confirm_title')}
          message={t('app.theme_confirm_message')}
          type="info"
          confirmLabel={t('common.confirm')}
          cancelLabel={t('common.cancel')}
        />

        <ConfirmModal
          isOpen={isUserManualConfirmOpen}
          onClose={() => setIsUserManualConfirmOpen(false)}
          onConfirm={() => {
            setIsUserManualConfirmOpen(false);
            window.open('/guide.html', '_blank', 'noopener,noreferrer');
          }}
          title={t('app.user_manual_confirm_title')}
          message={t('app.user_manual_confirm_message')}
          type="info"
          confirmLabel={t('app.user_manual_confirm_open')}
          cancelLabel={t('common.cancel')}
        />

        <ConfirmModal
          isOpen={isSessionTimeoutOpen}
          onClose={() => {}}
          onConfirm={confirmLogout}
          title={t('app.session_expired_title')}
          message={t('app.session_expired_message')}
          type="danger"
          hideCancel
          hideClose
          closeOnConfirm
          confirmLabel={t('app.logout')}
        />

        <ChangePasswordModal
          isOpen={isChangePasswordOpen}
          onClose={() => setIsChangePasswordOpen(false)}
          onSubmit={submitChangePassword}
        />

        <AlertModal
          isOpen={alertState.isOpen}
          onClose={closeAlert}
          title={alertState.title}
          message={alertState.message}
          type={alertState.type}
        />

        <TicketToast
          toast={toast}
          onDismiss={() => setToast(null)}
        />

      </div>
      );
      })()
      )}
    </HashRouter>
  );
};

export default App;
