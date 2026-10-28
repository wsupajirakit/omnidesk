import React, { useCallback, useEffect, useState } from 'react';
import { UserX } from 'lucide-react';

import { useI18n } from '../../../i18n';
import strikeService, {
  type SuspendedEntry,
} from '../../../services/strike/strikeService';
import { SuspendedTray } from './SuspendedTray';
/* [FEAT-20260830-MUTEALERT] the per-admin mute switch — see the hook's header
   for the whole design. revert: drop these imports + the tagged blocks below. */
import { usePreference } from '../../../hooks/usePreferences';
import {
  SUSPENDED_ALERT_MODE_PATH,
  SUSPENDED_ALERT_DEFAULT,
  isSuspendedAlertMuted,
  type SuspendedAlertMode,
} from '../../../hooks/suspendedAlertMode';

/**
 * [FEAT-20260826-STRIKESUSPEND] The header button that owns the tray.
 * ===========================================================================
 * 📖 PLAN: `omnidesk-api/todo/task/26082026/todo10_26082026_strike-suspend.md`
 *
 * Sits between the settings gear and the account menu. Glows red while anyone is
 * locked out, and drops the list when clicked.
 *
 * ⚠️ THE COUNT LOADS ONCE PER MOUNT, THE LIST LOADS ON OPEN. Two different
 * costs for two different needs: the glow has to be right without anybody asking
 * (one small read when the app starts), while the joined rows — name, phone, OA
 * — are only worth fetching when somebody is actually going to read them. No
 * polling and no socket: a lock is not urgent enough to pay for either, and the
 * page reloads often enough in practice.
 * ต้นทุนผูกกับสิ่งที่แอดมินทำ ไม่ใช่กับจำนวนลูกค้า
 *
 * ⚠️ THE BUTTON IS ALWAYS VISIBLE, even with nobody locked. A control that
 * appears only when it has something to say is a control nobody learns is there,
 * and an admin who wants to check "is anyone locked right now?" would have no
 * way to ask. Grey means nobody. ปุ่มอยู่เสมอ · สีบอกสถานะ ไม่ใช่การหายไป
 *
 * ⚠️ IT FAILS QUIET. The header must not break because one read did; a failed
 * load leaves the button grey and the tray empty, which is the same as "nobody
 * is locked" — a wrong grey is survivable, a crashed header is not.
 *
 * revert: delete this folder and the single line in `App.tsx` that renders it.
 */
/* [FEAT-2708-TRAYNOCLEAR] ไม่มี props แล้ว — สิทธิ์เคลียร์ไม่เกี่ยวกับถาดอีก
   (ปุ่มเคลียร์ย้ายไปอยู่ modal สถิติ strike ที่ avatar ทางเดียว) */
export const SuspendedTrayButton: React.FC = () => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SuspendedEntry[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await strikeService.listSuspended();
      setRows(res.suspended ?? []);
      setCount(res.suspended?.length ?? 0);
    } catch {
      /* header stays up; see the note above */
    } finally {
      setLoading(false);
    }
  }, []);

  // the glow only — one read at mount, so the badge is honest before any click
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void load();
  };

  const anyone = count > 0;

  /* ═══ [FEAT-20260830-MUTEALERT] ════════════════════════════════════════════
     `muted` silences ONLY the glow and the badge (`alerting` below). The
     button, the tray, the rows and the count inside all behave exactly as
     before — the data is untouched and other admins are unaffected.
     Normalized on every read: `usePreference` returns stored values verbatim,
     so a missing/broken value resolves to `alert` and nobody's header breaks.
     Every press is CONFIRMED (owner), and the message states current → target. */
  const [alertModeRaw, setAlertModeRaw] = usePreference<SuspendedAlertMode>(
    SUSPENDED_ALERT_MODE_PATH,
    SUSPENDED_ALERT_DEFAULT,
    { immediate: true },
  );
  const muted = isSuspendedAlertMuted(alertModeRaw);
  const alerting = anyone && !muted;

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="suspended-trigger"
        onClick={toggle}
        aria-label={t('suspended.title')}
        title={t('suspended.title')}
        /* [FIX-20260826-TRAYBTNFRAME] เจ้าของแจ้ง 26/08 พร้อมภาพ: ปุ่มนี้มีกรอบขาว
           เด่นกว่าฟันเฟืองข้าง ๆ — *"ทำเหมือนฟันเฟืองเลย · กรอบสีเดียวกับฟันเฟือง"*

           🔴 ต้นเหตุไม่ใช่เลือกสีผิด แต่ใช้ `border` เปล่า ๆ ซึ่ง `index.html` มีกฎ
           global ในธีม light ทับไว้:
               html:not(.theme-dark) .border { border-color:#DCE3EC !important }
           ⇒ สีขอบที่ตั้งไว้ถูกทับทันที ไม่ว่าจะตั้งเป็นอะไร
           ปุ่มฟันเฟืองเจอปัญหานี้มาก่อนแล้วและแก้ด้วย `border-[1px]` ซึ่ง selector
           ตัวนั้นจับไม่ได้ (`App.tsx` [FIX-20260801-USERCHIP] เขียนเตือนไว้ครบ)

           ⇒ ก๊อป 3 อย่างจากฟันเฟืองมาตรง ๆ: `border-[1px]` · `app-topbar-icon`
           · `border-white/10` · และ padding แบบเดียวกัน (`p-2.5` ไม่ใช่ h-10 w-10)
           ยืมของที่แก้ถูกแล้ว ดีกว่าตั้งสีใหม่ให้โดนทับซ้ำ

           ⚠️ สถานะ "มีคนติดล็อก" ยังแดง+glow เหมือนเดิมทุกประการ — แก้แค่ตอนว่าง
           revert: เอา className ก้อนเดิมกลับมา */
        /* [FEAT-20260830-MUTEALERT] `alerting`, not `anyone`: muted admins get
           the quiet style however many customers are locked. ⚠️ the class
           strings themselves are untouched — the border-[1px] trap note above
           still governs both. */
        className={`relative p-2.5 rounded-xl border-[1px] transition-colors flex-shrink-0 ${
          alerting
            ? 'border-red-400 bg-red-50 text-red-600 shadow-[0_0_12px_rgba(239,68,68,0.55)] dark:border-red-700 dark:bg-red-950/40 dark:text-red-400'
            : 'app-topbar-icon border-white/10 text-slate-500 hover:bg-slate-100'
        }`}
      >
        <UserX size={16} />
        {alerting && (
          <span
            data-testid="suspended-count"
            className="absolute -right-1 -top-1 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white"
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <SuspendedTray
          /* [FEAT-20260830-MUTEALERT] the switch renders in the tray header;
             this component owns the preference and the confirm. */
          alertMuted={muted}
          /* [FEAT-20260830-MUTEALERT] called only AFTER the tray's inline
             confirm — asking happens where the admin clicked; writing stays
             here, with the preference. */
          onToggleAlert={() => setAlertModeRaw(muted ? 'alert' : 'muted')}
          rows={rows}
          loading={loading}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
};

export default SuspendedTrayButton;
