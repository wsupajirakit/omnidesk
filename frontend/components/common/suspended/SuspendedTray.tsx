import React from 'react';
import { X, Bell, BellOff } from 'lucide-react';

import { useI18n } from '../../../i18n';
import type { SuspendedEntry } from '../../../services/strike/strikeService';
import { SuspendedRow } from './SuspendedRow';

/**
 * [FEAT-20260826-STRIKESUSPEND] The header tray — who the bot is ignoring.
 * ===========================================================================
 * 📖 PLAN: `omnidesk-api/todo/task/26082026/todo10_26082026_strike-suspend.md`
 *
 * ⚠️ CLICKING AWAY DOES NOT CLOSE IT. Owner, 26/08: *"ไม่ให้ allow click outside"*.
 * This is a working surface — an admin reads a phone number out of it and types
 * it somewhere else — and a dropdown that vanishes on the next click loses their
 * place every time. The backdrop is there to block clicks reaching the page
 * behind, not to dismiss. Only the X closes it.
 *
 * This is the same shape the settings gear already uses (`App.tsx`), copied
 * deliberately rather than invented: same backdrop, same 44px floating X pulled
 * outside the corner, same `max-w-[calc(100vw-1rem)]` so it never overflows a
 * narrow screen. A second dropdown that behaves differently from the first is a
 * worse dropdown even when it is a nicer one. ยืมของที่มีอยู่ ไม่ประดิษฐ์ใหม่
 *
 * ⚠️ IT RENDERS WHAT IT IS GIVEN AND FETCHES NOTHING. The caller loads on open,
 * so the list costs one query per deliberate click — never on page load, never
 * on a timer, and never per row.
 *
 * revert: delete this folder and the one line in `App.tsx` that mounts it.
 */
interface Props {
  rows: SuspendedEntry[];
  onClose: () => void;
  loading?: boolean;
  /* [FEAT-20260830-MUTEALERT] the per-admin alert switch, both OPTIONAL and
     omitted by every caller except SuspendedTrayButton — an omitted pair
     renders this tray byte-identical to before (the house optional-prop rule).
     `alertMuted` drives the icon (inverse of the state) and the hint line;
     `onToggleAlert` opens the owner-required confirm, which lives in the
     Button because the Button owns the preference. */
  alertMuted?: boolean;
  onToggleAlert?: () => void;
}

/* [FEAT-2708-TRAYNOCLEAR] onCleared/canClear ถูกถอดพร้อมปุ่มเคลียร์ —
   ถาดนี้เป็นข้อมูลอ่านอย่างเดียว การยกเลิกทำที่ modal สถิติ strike (avatar) */
export const SuspendedTray: React.FC<Props> = ({
  rows,
  onClose,
  loading = false,
  alertMuted = false,
  onToggleAlert,
}) => {
  const { t } = useI18n();
  /* [FEAT-2708-COPYTOAST] เจ้าของ 27/08: "copy ต้องมี toast บอก" — pill เดียว
     กลางถาด ขับด้วย counter (แบบเดียวกับ NewMessageToast: กดซ้ำ = ต่ออายุ)
     ไม่มี toast กลางในระบบให้ reuse (เช็คแล้ว) จึงเป็นของถาดเอง จบในไฟล์นี้ */
  /* [FEAT-20260830-MUTEALERT] the confirm is INLINE, inside this tray, right
     under the switch — a full-screen ConfirmModal put the question in the middle
     of the page, far from the control the admin just pressed (owner: "เอาตรง
     บริเวณที่กดสิ"). The parent still owns the preference: this only asks, then
     calls `onToggleAlert` once the admin says yes. */
  const [askSwitch, setAskSwitch] = React.useState(false);
  const [copyTick, setCopyTick] = React.useState(0);
  const [copyVisible, setCopyVisible] = React.useState(false);
  React.useEffect(() => {
    if (!copyTick) return;
    setCopyVisible(true);
    const timer = window.setTimeout(() => setCopyVisible(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copyTick]);

  return (
    <>
      {/* blocks clicks reaching the page behind — it does NOT dismiss */}
      <div
        data-testid="suspended-backdrop"
        className="fixed inset-0 z-[55] bg-slate-900/10 backdrop-blur-[2px]"
      />
      <div className="app-popover absolute right-0 top-full z-[60] mt-2 w-[360px] max-w-[calc(100vw-1rem)]">
        {/* the X sits OUTSIDE the scroll box, which clips its own overflow */}
        <button
          type="button"
          data-testid="suspended-close"
          onClick={onClose}
          aria-label={t('common.close')}
          /* [FIX-20260826-TRAYX] เจ้าของแจ้ง 26/08 พร้อมภาพ: *"กากบาทอันนี้ย้ายไปทางขวา"*
             เดิมอยู่มุมซ้ายบน (`-left-5`) ซึ่งชนกับขอบซ้ายของ tray และไปทับเนื้อหา
             หัวเรื่องพอดี · ย้ายไปมุมขวาบนแทน — ตำแหน่งเดียวกับที่ผู้ใช้คาดว่าปุ่มปิดจะอยู่
             revert: เปลี่ยน `-right-4` กลับเป็น `-left-5` */
          className="gear-x absolute -right-4 -top-4 z-[62] grid h-11 w-11 place-items-center rounded-full shadow-md transition-colors"
        >
          <X size={22} />
        </button>

        <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-dark-700 dark:bg-dark-800">
          <div className="border-b border-slate-100 p-3 dark:border-dark-700">
            {/* [FEAT-20260830-MUTEALERT] the switch sits RIGHT AFTER the label
                (owner: "ย้ายไปหลัง label"), not pushed to the far edge — the
                control and the thing it controls read as one phrase. */}
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                {t('suspended.title')}
              </p>
              {/* [FEAT-20260830-MUTEALERT] the switch. The icon shows the
                  CURRENT state (owner: "icon inverse ตามสถานะ") — Bell while
                  alerts are on, BellOff while muted — so a glance answers
                  "am I muted?". Rendered only when the owner component wired
                  the handler; other callers keep their exact old markup. */}
              {onToggleAlert && (
                <button
                  type="button"
                  data-testid="suspended-alert-switch"
                  aria-pressed={alertMuted}
                  onClick={() => setAskSwitch((v) => !v)}
                  title={alertMuted ? t('suspended.alert_state_off') : t('suspended.alert_state_on')}
                  aria-label={alertMuted ? t('suspended.alert_state_off') : t('suspended.alert_state_on')}
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors ${
                    alertMuted
                      ? 'border-slate-300 bg-slate-100 text-slate-500 hover:bg-slate-200 dark:border-dark-600 dark:bg-dark-700 dark:text-slate-400'
                      : 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400'
                  }`}
                >
                  {alertMuted ? <BellOff size={15} /> : <Bell size={15} />}
                </button>
              )}
            </div>
            {/* [FEAT-20260830-MUTEALERT] the quiet hint the owner asked for —
                so nobody stares at a grey button wondering why nothing is red. */}
            {alertMuted && (
              <p
                data-testid="suspended-muted-hint"
                className="mt-1 text-[11px] font-medium text-slate-400 dark:text-slate-500"
              >
                {t('suspended.alert_muted_hint')}
              </p>
            )}
            {/* [FEAT-20260830-MUTEALERT] the confirm, in place. States current →
                target in the message, per the owner's design. Nothing is written
                until ยืนยัน; ยกเลิก just closes this panel. */}
            {askSwitch && (
              <div
                data-testid="suspended-alert-confirm"
                className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-700/60 dark:bg-amber-950/30"
              >
                <p className="text-[11px] font-bold text-amber-900 dark:text-amber-300">
                  {alertMuted
                    ? t('suspended.alert_confirm_on_title')
                    : t('suspended.alert_confirm_off_title')}
                </p>
                <p className="mt-1 whitespace-pre-line break-words text-[11px] leading-relaxed text-amber-800 dark:text-amber-200/90">
                  {alertMuted
                    ? t('suspended.alert_confirm_on_message')
                    : t('suspended.alert_confirm_off_message')}
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    data-testid="suspended-alert-cancel"
                    onClick={() => setAskSwitch(false)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50 dark:border-dark-600 dark:bg-dark-800 dark:text-slate-300"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    data-testid="suspended-alert-confirm-ok"
                    onClick={() => {
                      setAskSwitch(false);
                      onToggleAlert?.();
                    }}
                    className="rounded-lg bg-amber-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-amber-500"
                  >
                    {t('common.confirm')}
                  </button>
                </div>
              </div>
            )}
            {/* [FEAT-2708-TRAYNOCLEAR] ข้อความบรรยาย ("เคลียร์ session แล้วจะ
                กลับมาคุยได้") ถูกถอดตามเจ้าของ 27/08 — "เอาออกและไม่ต้องบอก
                ข้อความ" · คีย์ i18n คงไว้เผื่อ revert (ซ่อน ไม่ลบ) */}
          </div>

          {/* [FEAT-2708-TRAYPOLISH] เจ้าของ 27/08: "แสดงสูงสุดแค่ 2 card" —
              ~17rem = สองการ์ดพอดี ที่เหลือ scroll (เดิม 60vh เห็นเป็นสิบใบ) */}
          {copyVisible && (
            <div
              data-testid="suspended-copy-toast"
              className="pointer-events-none absolute inset-x-0 top-12 z-10 flex justify-center"
            >
              <span className="rounded-full bg-slate-900/85 px-3 py-1 text-[11px] font-semibold text-white shadow-lg backdrop-blur-sm">
                {t('suspended.copied')}
              </span>
            </div>
          )}
          <div className="custom-scrollbar max-h-[17rem] overflow-y-auto">
            {loading && (
              <p
                data-testid="suspended-loading"
                className="p-4 text-center text-xs text-slate-400"
              >
                {t('common.loading')}
              </p>
            )}
            {!loading && rows.length === 0 && (
              /* Said in words rather than left blank: an empty tray and a failed
                 load look identical otherwise, and this one is good news. */
              <p
                data-testid="suspended-empty"
                className="p-6 text-center text-xs font-medium text-slate-400"
              >
                {t('suspended.empty')}
              </p>
            )}
            {!loading &&
              rows.map((row) => (
                <SuspendedRow
                  key={row._id}
                  row={row}
                  t={t}
                  onCopied={() => setCopyTick((n) => n + 1)}
                />
              ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default SuspendedTray;
