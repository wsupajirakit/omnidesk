/* [FEAT-2708-HEADERQUOTA] The OA's push quota, always visible in the chat header.
 * ===========================================================================
 * 📖 PLAN: `omnidesk-api/todo/task/27082026/todo9_27082026_guard-window-adminname-quota.md` §3
 *
 * Owner, 27/08: the header shows "1,587/15,000 ใช้ไปแล้ว เหลือ 13,413" with the
 * same percent gauge as the ⓘ dialog, refreshed on entering a room and after a
 * successful admin push; past 90% both turn red and a toast fires — a SEPARATE
 * toast instance from the new-message one, in the same spot.
 *
 * WHAT IS REUSED, deliberately (ห้ามประกาศซ้ำ):
 *   · `readQuota` — the one place used/limit/remaining/percent are derived
 *   · `fmt` — the modal's th-TH formatter, now exported from hook/quota
 *   · `useHookQuota` — the fetch-state hook the ⓘ dialog already uses
 *   · the 90/75 colour thresholds — same numbers as QuotaModal's bar
 *
 * ⚠️ THE THROTTLE, and why it exists here when `useHookQuota` is proudly
 * no-cache: the dialog opens on an explicit click — rare. The header rides
 * EVERY room click, and ticket work means hopping between rooms of the SAME
 * OA all day. Each read is 2 real GETs to LINE (BE proxies both), and LINE's
 * rate limits are per-channel. So: a room-click refresh inside
 * `QUOTA_THROTTLE_MS` of the last completed read of that hook is skipped
 * (the number on screen is at most that many seconds old); a PUSH refresh
 * always goes through, because a push is the one event that actually moves
 * the number. เปลี่ยนใจ = แก้เลขเดียวข้างล่าง (0 = ปิดกันชน).
 *
 * ⚠️ FAILURE IS SILENT — a header must never break for a gauge (same stance
 * as the strike mark in TicketChat). No error text, no crash: just nothing.
 *
 * revert: delete this file + the [FEAT-2708-HEADERQUOTA] blocks in
 * ChatRoomView.tsx (import/state/mount/listener) and the one dispatch in
 * TicketChat.tsx. The ⓘ button + QuotaModal were never touched.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useHookQuota, readQuota, fmt } from '../hook/quota/useHookQuota';
import { useI18n } from '../../i18n';
import { withVars } from './i18nVars';

/** Room-click refreshes within this window reuse the number on screen. */
export const QUOTA_THROTTLE_MS = 20_000;

/** Last COMPLETED read per hook — module-level so remounts share it. */
const lastReadAt = new Map<string, number>();

/** Tests only: the map above outlives each test's render. */
export const __resetQuotaThrottleForTests = (): void => {
  lastReadAt.clear();
};

interface GaugeProps {
  hookId?: string | null;
  /** Bumped on entering a room — throttled per hook. */
  refreshTick: number;
  /** Bumped after a successful admin push — never throttled. */
  forceTick: number;
  /** Called once per crossing INTO ≥90%, not on every high read. */
  onDanger?: () => void;
  /** [FEAT-2708-GAUGECLICK] กดเกจ = เปิด modal โควตา (เหมือนปุ่ม ⓘ ข้าง ๆ) */
  onOpenDetail?: () => void;
}

export const HeaderQuotaGauge: React.FC<GaugeProps> = ({
  hookId,
  refreshTick,
  forceTick,
  onDanger,
  onOpenDetail,
}) => {
  const { t } = useI18n();
  const { data, loading, error, reload } = useHookQuota(hookId, !!hookId);

  /* Refs so the effects below never re-fire from identity churn (the same
     reason `t` stays out of deps elsewhere in this repo). */
  const onDangerRef = useRef(onDanger);
  onDangerRef.current = onDanger;
  const wasDangerRef = useRef(false);

  // room-click: through only when the hook's last read is stale
  const firstRefresh = useRef(true);
  useEffect(() => {
    if (firstRefresh.current) {
      firstRefresh.current = false; // mount fetch already covers the first look
      return;
    }
    if (!hookId) return;
    const last = lastReadAt.get(hookId) ?? 0;
    if (Date.now() - last >= QUOTA_THROTTLE_MS) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  // push: always through — the number genuinely moved
  const firstForce = useRef(true);
  useEffect(() => {
    if (firstForce.current) {
      firstForce.current = false;
      return;
    }
    if (hookId) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceTick]);

  // a different OA starts its own danger story
  useEffect(() => {
    wasDangerRef.current = false;
  }, [hookId]);

  /* [FIX-2708-GAUGESTALE] เจ้าของ 27/08: "ตอนสลับ chat มันมองเห็นของเกจแชทก่อน"
     — useHookQuota ถือ data เดิมไว้ระหว่างโหลดตัวใหม่ ⇒ จำว่าเลขที่ถืออยู่เป็น
     ของ hook ไหน · ยังไม่ใช่ของ hook ปัจจุบัน = skeleton บัง ห้ามโชว์เลขแชทก่อน
     (refresh ใน hook เดิม: เลขเดิมโชว์ต่อได้ ไม่กะพริบ) */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  /* การ์ดสองชั้นพอ (mutation พิสูจน์แล้วว่าไม่ต้องมี reset ระหว่าง render):
     ① เลขโชว์เฉพาะเมื่อ loadedFor === hookId — สลับ hook แล้ว mismatch ทันที
     ② stamp เฉพาะขอบ loading-จบ — data ค้างของแชทก่อนไม่มีวันถูกนับเป็นของใหม่ */
  const wasLoadingRef = useRef(false);

  // bookkeeping per completed read: throttle stamp + danger crossing
  useEffect(() => {
    if (loading) {
      wasLoadingRef.current = true;
      return;
    }
    if (!data || !hookId) return;
    lastReadAt.set(hookId, Date.now());
    /* stamp เฉพาะขอบ "โหลดจบจริง" — ข้อมูลที่ค้างจากแชทก่อนไม่มีวันถูกนับเป็น
       ของ hook ใหม่ (มันไม่เคยผ่านขอบ loading ของ hook นี้) */
    if (wasLoadingRef.current) {
      wasLoadingRef.current = false;
      setLoadedFor(hookId);
    }
    const q = readQuota(data);
    const danger = !q.unlimited && q.percent >= 90;
    if (danger && !wasDangerRef.current) onDangerRef.current?.();
    wasDangerRef.current = danger;
  }, [data, loading, hookId]);

  if (!hookId || error) return null;
  if (!data || loadedFor !== hookId) {
    /* skeleton ขนาดเดียวกับแคปซูลจริง — จอไม่กระตุกและไม่มีเลขเก่าให้เห็น */
    return (
      <span
        data-testid="header-quota-loading"
        className="relative inline-flex h-7 min-w-[14rem] shrink-0 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700"
      />
    );
  }
  const q = readQuota(data);

  if (q.unlimited) {
    return (
      <span
        data-testid="header-quota"
        className="shrink-0 text-[11px] font-medium text-slate-500"
      >
        {t('hook_quota.unlimited', 'ไม่จำกัด')}
      </span>
    );
  }

  const danger = q.percent >= 90;
  /* [FEAT-2708-GAUGEBG] (งาน 5.8) เจ้าของ 27/08 พร้อม screenshot: "เกจ ทำให้
     เป็น bg ของ 156/300 เลย...ให้มันบอกตรงนั้นเลย...ขยายเกจใหญ่ขึ้น" —
     ตัวเลขกับเกจเลิกเป็นสองชิ้นวางข้างกัน: แคปซูลเดียว (h-7) แท่งเติมเป็นพื้นหลัง
     และตัวเลขนั่งทับตรงกลาง (เกณฑ์สี 90/75 ชุดเดิมของ dialog)
     · ฟอนต์ (แก้ตามสั่ง "font ขาว"): ขาวหนา + เงาเข้ม = อ่านออกทั้งบนแท่งสีและ track
       เทา — ตามคำสั่ง "ระวังสี font ต้องเห็นทั้ง bg และแท่งจริง" เนื้อแท่งจึงใช้
       โทน /70-/80 ให้ตัวหนังสือเข้มชนะเสมอ
     · ≥90%: แท่ง rose + pulse + ขอบชมพู (ของ 5.6 คงพฤติกรรม) — ตัวเลขชุดเดิม
     revert: คืนเป็นสองชิ้น (ข้อความ + เกจจิ๋ว) ตาม tag [FEAT-2708-TIERFIRST] */
  return (
    <button
      type="button"
      onClick={onOpenDetail}
      title={t('ticketui.gauge.detail', 'ดูรายละเอียดโควตา')}
      data-testid="header-quota"
      /* [FEAT-2708-GAUGECLICK] กดได้ = เปิด modal เดียวกับปุ่ม ⓘ
         [FEAT-2708-GAUGESMALL] เล็กลงตามสั่ง: h-7→h-6, กว้าง 14rem→11rem */
      className={`relative shrink-0 inline-flex h-5 min-w-[9.5rem] items-center overflow-hidden rounded-full transition-all ${
        danger
          ? 'bg-rose-100 ring-1 ring-rose-300 gauge-danger-bounce dark:bg-rose-950/60 dark:ring-rose-500/50'
          : 'bg-slate-300 dark:bg-slate-800 dark:ring-1 dark:ring-slate-600'
      }`}
    >
      <span
        data-testid="header-quota-bar"
        className={`absolute inset-y-0 left-0 rounded-full transition-all ${
          /* [FIX-2708-DARKFILL] In dark the fill has to actually READ against the
             track — the original shade sat at the same value as the dark track and
             vanished. Light shades (300) plus a glow on the leading edge.

             [FIX-2708-DARKFILL-CASCADE] WHY THE LIGHT COLOURS ARE RAW HEX rather than
             `bg-blue-500/70` / `bg-amber-500/70`, and why nobody may put those back:
             index.html carries a site-wide dark repaint built from ATTRIBUTE SUBSTRING
             selectors —

               html.theme-dark [class*="bg-blue-500/"]  { background-color: rgba(59,130,246,0.16) !important }
               html.theme-dark [class*="bg-amber-500/"] { background-color: rgba(245,158,11,0.16) !important }

             An element merely CARRYING such a token is repainted to a flat 16%-alpha
             tint. Those rules are `!important` AND outrank Tailwind's
             `.dark\:bg-sky-300:where(.theme-dark,…)` (0,2,1 vs 0,1,0), so the `dark:`
             utility could never win and the bar stayed near-invisible on the dark
             track. Three separate rounds of "make the blue lighter" moved nothing for
             exactly this reason. A raw hex carries no trapped token, so `dark:` applies.
             The hexes are byte-identical to what Tailwind compiled for the old classes
             (#3080ffb3 = blue-500/70, #f99c00b3 = amber-500/70): the LIGHT theme is
             deliberately unchanged.
             rose keeps its class — index.html has no `bg-rose-500/` rule, so the danger
             shade was never affected, and the smaller diff is the safer one.
             Guarded by test/gaugeDarkFillCascade.value.test.ts.
             revert: put the two Tailwind classes back, and accept that dark sinks again. */
          danger
            ? 'bg-rose-500/80 dark:bg-rose-400 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.9)]'
            : q.percent >= 75
              ? 'bg-[#f99c00b3] dark:bg-amber-300 dark:shadow-[2px_0_8px_rgba(252,211,77,0.8)]'
              : 'bg-[#3080ffb3] dark:bg-sky-300 dark:shadow-[2px_0_8px_rgba(125,211,252,0.85)]'
        }`}
        style={{ width: `${q.percent}%` }}
      />
      <span className="relative z-10 w-full whitespace-nowrap px-2.5 text-center text-[9px] font-bold text-white drop-shadow-[0_1px_2px_rgba(15,23,42,0.85)] [text-shadow:0_0_3px_rgba(15,23,42,0.7)]">
        {withVars(t('ticketui.gauge.used_left', '{used}/{limit} ใช้ไปแล้ว · เหลือ {left}'), { used: fmt(q.used), limit: q.limit === null ? '-' : fmt(q.limit), left: q.remaining === null ? '-' : fmt(q.remaining) })}
      </span>
    </button>
  );
};

/** How long the quota warning stays up — same rhythm as the message toast. */
export const QUOTA_WARNING_TOAST_MS = 2600;

/**
 * The ≥90% warning. Its own component, its own `trigger` counter, its own
 * timer — NEVER the NewMessageToast instance (owner: "คนละ instance") even
 * though it lands in the same header spot. Structure cloned from
 * NewMessageToast so the two age the same way.
 */
export const QuotaWarningToast: React.FC<{ trigger: number }> = ({ trigger }) => {
  const { t } = useI18n();
  const [visible, setVisible] = React.useState(false);

  useEffect(() => {
    if (!trigger) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), QUOTA_WARNING_TOAST_MS);
    return () => clearTimeout(timer);
  }, [trigger]);

  return (
    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-30 flex justify-center pointer-events-none">
      <div
        data-testid="quota-warning-toast"
        className={`flex items-center gap-[13px] px-[26px] py-4 rounded-full text-[17px] font-semibold
          bg-white/95 dark:bg-slate-800/95 text-rose-600 dark:text-rose-400
          border-2 border-rose-300 dark:border-rose-500/60 backdrop-blur-sm shadow-lg
          transition-all duration-300 ${visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
      >
        <AlertTriangle size={21} className="text-rose-500 shrink-0" />
        {t('ticketui.gauge.over90', 'โควตาข้อความ OA นี้เกิน 90% แล้ว')}
      </div>
    </div>
  );
};
