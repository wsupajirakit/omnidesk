import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

/**
 * [FEAT-2708-HEADERQUOTA] The OA quota strip in the chat-room header.
 * ===========================================================================
 * 📖 PLAN: `omnidesk-api/todo/task/27082026/todo9_27082026_guard-window-adminname-quota.md` §3
 *
 * Pinned rules (each a separate owner decision):
 *   · numbers come from `readQuota` — used/limit + เหลือ, th-TH formatted
 *   · unlimited plan says "ไม่จำกัด", never 0/0, and draws no bar
 *   · a failed read renders NOTHING — the header must never break (strike-mark
 *     precedent)
 *   · ≥90% turns text AND bar rose, and fires onDanger exactly on the
 *     crossing, not on every refresh that stays high
 *   · room-click refreshes pass a 20s per-hook throttle; push refreshes
 *     (forceTick) always go through
 *   · the warning toast is its OWN instance — NewMessageToast's counter must
 *     not move it
 */
const getHookQuota = vi.fn();
vi.mock('../services/hook', () => ({
  __esModule: true,
  webhookService: { getHookQuota: (...a: unknown[]) => getHookQuota(...a) },
}));

import {
  HeaderQuotaGauge,
  QuotaWarningToast,
  __resetQuotaThrottleForTests,
} from '../components/chat/HeaderQuotaGauge';
import { NewMessageToast } from '../components/chat/NewMessageToast';

const quota = (used: number, limit: number | 'none' = 15000) => ({
  quota: limit === 'none' ? { type: 'none' } : { type: 'limited', value: limit },
  consumption: { totalUsage: used },
  remaining: limit === 'none' ? null : (limit as number) - used,
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetQuotaThrottleForTests();
  getHookQuota.mockResolvedValue(quota(1587));
});
afterEach(() => vi.useRealTimers());

describe('HeaderQuotaGauge — the numbers', () => {
  it('draws used/limit + เหลือ from readQuota, th-TH formatted — ON the gauge itself', async () => {
    /* งาน 5.8 (เจ้าของ 27/08): "เกจ ทำให้เป็น bg ของ 156/300 เลย...ขยายเกจใหญ่ขึ้น"
       ⇒ ตัวเลขนั่งอยู่ในแคปซูลเดียวกับแท่ง ไม่ใช่ข้อความลอยข้าง ๆ */
    render(<HeaderQuotaGauge hookId="h1" refreshTick={0} forceTick={0} />);
    const el = await screen.findByTestId('header-quota');
    expect(el.textContent).toContain('1,587/15,000');
    expect(el.textContent).toContain('ใช้ไปแล้ว');
    expect(el.textContent).toContain('เหลือ 13,413');
    // แท่ง (bar) กับตัวเลขอยู่ในกล่องเดียวกัน และกล่องคือแคปซูลใหญ่ (h-7)
    const barEl = el.querySelector('[data-testid="header-quota-bar"]') as HTMLElement;
    expect(barEl).not.toBeNull();
    /* [GAUGESMALL] เจ้าของ 27/08: "ลดขนาดเกจลง ลด font ลงมันใหญ่ไป" */
    expect(el.className).toContain('h-5');
    expect(el.className).not.toContain('h-6');
    expect(el.className).toContain('min-w-[9.5rem]');
    /* [DARKGAUGE] บั๊กเจ้าของ 27/08: dark theme เกจซีด — เนื้อ /70 บน track
       สว่างจมกับพื้นมืด ⇒ dark ต้องมีชุดสีของตัวเอง (track เข้ม + แท่งทึบ) */
    /* [DARKFILL] dark ใช้เฉดสว่าง (400) + glow ขอบ เพื่อให้แท่ง "วิ่งแล้วเห็น"
       บนพื้นมืด — เฉด 500 เดิมจมกับ track */
    /* dark ต้องสว่างพอให้ "เห็นแท่งวิ่ง" — sky-300 (เจ้าของ: ฟ้ายังมืดไป) */
    expect(barEl.className).toContain('dark:bg-sky-300');
    expect(barEl.className).toMatch(/dark:shadow-/);
    expect(el.className).toContain('dark:bg-slate-800');
    // ฟอนต์ขาว + halo เข้ม (เจ้าของ 27/08: "light theme font ขาว") — อ่านออก
    // ทั้งบนแท่งสีและบน track อ่อนเพราะขอบเงาเข้มตัดให้
    const label = el.querySelector('[class*="drop-shadow"]') as HTMLElement;
    expect(label).not.toBeNull();
    expect(label.className).toContain('text-white');
    expect(label.className).toContain('text-[9px]');
  });

  it('unlimited plan says ไม่จำกัด and draws no bar', async () => {
    getHookQuota.mockResolvedValue(quota(10, 'none'));
    render(<HeaderQuotaGauge hookId="h1" refreshTick={0} forceTick={0} />);
    const el = await screen.findByTestId('header-quota');
    expect(el.textContent).toContain('ไม่จำกัด');
    expect(el.querySelector('[data-testid="header-quota-bar"]')).toBeNull();
  });

  it('⭐ a failed read renders NOTHING — the header must never break', async () => {
    getHookQuota.mockRejectedValue(new Error('down'));
    render(<HeaderQuotaGauge hookId="h1" refreshTick={0} forceTick={0} />);
    await waitFor(() => expect(getHookQuota).toHaveBeenCalled());
    expect(screen.queryByTestId('header-quota')).toBeNull();
  });

  it('no hookId → renders nothing and never fetches', () => {
    render(<HeaderQuotaGauge hookId={null} refreshTick={0} forceTick={0} />);
    expect(screen.queryByTestId('header-quota')).toBeNull();
    expect(getHookQuota).not.toHaveBeenCalled();
  });
});

describe('HeaderQuotaGauge — กดได้ เปิด modal เหมือนปุ่ม info', () => {
  it('⭐⭐ เกจเป็นปุ่มจริง กดแล้วเรียก onOpenDetail', async () => {
    const onOpenDetail = vi.fn();
    render(
      <HeaderQuotaGauge hookId="h1" refreshTick={0} forceTick={0} onOpenDetail={onOpenDetail} />,
    );
    const el = await screen.findByTestId('header-quota');
    expect(el.tagName).toBe('BUTTON');
    fireEvent.click(el);
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });
});

describe('HeaderQuotaGauge — the 90% line', () => {
  it('⭐ ≥90% turns text and bar rose; 89% does not (exact edge)', async () => {
    getHookQuota.mockResolvedValue(quota(13500)); // 90%
    const { unmount } = render(
      <HeaderQuotaGauge hookId="h1" refreshTick={0} forceTick={0} />,
    );
    let el = await screen.findByTestId('header-quota');
    const bar = el.querySelector('[data-testid="header-quota-bar"]')!;
    expect(bar.className).toContain('bg-rose-500');
    /* งาน 5.6: ≥90% ต้อง "หนา ๆ เด่น ๆ" — glow กระพริบ ไม่ใช่แค่เปลี่ยนสี */
    expect(bar.className).toContain('animate-pulse');
    /* เจ้าของ 27/08: "เกจต้องเด้ง" แล้วขอ "เบากว่านี้" — เด้งนุ่ม ±2px
       (keyframes เองใน index.css ไม่ใช่ animate-bounce เต็มแรง) */
    expect(el.className).toContain('gauge-danger-bounce');
    unmount();
    __resetQuotaThrottleForTests();

    getHookQuota.mockResolvedValue(quota(13350)); // 89%
    render(<HeaderQuotaGauge hookId="h1" refreshTick={0} forceTick={0} />);
    el = await screen.findByTestId('header-quota');
    expect(
      el.querySelector('[data-testid="header-quota-bar"]')!.className,
    ).not.toContain('animate-pulse');
    expect(el.className).not.toContain('gauge-danger-bounce');
  });

  it('⭐ onDanger fires on the crossing, not on every refresh that stays high', async () => {
    const onDanger = vi.fn();
    getHookQuota.mockResolvedValue(quota(13500));
    const { rerender } = render(
      <HeaderQuotaGauge hookId="h1" refreshTick={0} forceTick={0} onDanger={onDanger} />,
    );
    await waitFor(() => expect(onDanger).toHaveBeenCalledTimes(1));

    // push refresh, still ≥90 — no second toast
    rerender(
      <HeaderQuotaGauge hookId="h1" refreshTick={0} forceTick={1} onDanger={onDanger} />,
    );
    await waitFor(() => expect(getHookQuota).toHaveBeenCalledTimes(2));
    expect(onDanger).toHaveBeenCalledTimes(1);
  });

  it('below 90 never fires onDanger', async () => {
    const onDanger = vi.fn();
    render(
      <HeaderQuotaGauge hookId="h1" refreshTick={0} forceTick={0} onDanger={onDanger} />,
    );
    await screen.findByTestId('header-quota');
    expect(onDanger).not.toHaveBeenCalled();
  });
});

describe('HeaderQuotaGauge — สลับ OA ต้องไม่เห็นเลขของแชทก่อน', () => {
  it('⭐⭐ เปลี่ยน hook: โชว์ skeleton จนกว่าเลขของ hook ใหม่จะมา — เลขเก่าห้ามโผล่', async () => {
    /* เจ้าของ 27/08: "ตอนสลับ chat มันมองเห็นของเกจแชทก่อน (ทำ loading บังก็ได้)" */
    let releaseH2: (v: unknown) => void = () => {};
    getHookQuota.mockImplementation((id: unknown) =>
      id === 'h2'
        ? new Promise((res) => {
            releaseH2 = res;
          })
        : Promise.resolve(quota(1587)),
    );
    const { rerender } = render(
      <HeaderQuotaGauge hookId="h1" refreshTick={0} forceTick={0} />,
    );
    await screen.findByTestId('header-quota');
    rerender(<HeaderQuotaGauge hookId="h2" refreshTick={0} forceTick={0} />);
    // ระหว่างรอของ h2: เลขของ h1 ต้องหาย มี skeleton บังแทน
    await waitFor(() => {
      expect(screen.queryByTestId('header-quota-loading')).not.toBeNull();
    });
    expect(document.body.textContent).not.toContain('1,587');
    releaseH2(quota(30, 300));
    await waitFor(() => {
      const el = screen.queryByTestId('header-quota');
      expect(el?.textContent).toContain('30/300');
    });
  });
});

describe('HeaderQuotaGauge — when it refetches', () => {
  it('⭐ refreshTick inside 20s is throttled; forceTick always goes through', async () => {
    const { rerender } = render(
      <HeaderQuotaGauge hookId="h1" refreshTick={0} forceTick={0} />,
    );
    await screen.findByTestId('header-quota');
    expect(getHookQuota).toHaveBeenCalledTimes(1);

    // a room-click straight after — inside the throttle window: no call
    rerender(<HeaderQuotaGauge hookId="h1" refreshTick={1} forceTick={0} />);
    await act(async () => {});
    expect(getHookQuota).toHaveBeenCalledTimes(1);

    // a push refresh — always through
    rerender(<HeaderQuotaGauge hookId="h1" refreshTick={1} forceTick={1} />);
    await waitFor(() => expect(getHookQuota).toHaveBeenCalledTimes(2));
  });

  it('switching OA (hookId) refetches without waiting for any tick', async () => {
    const { rerender } = render(
      <HeaderQuotaGauge hookId="h1" refreshTick={0} forceTick={0} />,
    );
    await screen.findByTestId('header-quota');
    rerender(<HeaderQuotaGauge hookId="h2" refreshTick={0} forceTick={0} />);
    await waitFor(() => expect(getHookQuota).toHaveBeenCalledTimes(2));
    expect(getHookQuota).toHaveBeenLastCalledWith('h2');
  });
});

describe('QuotaWarningToast — its own instance', () => {
  it('⭐ NewMessageToast trigger does not show the quota toast, and vice versa', () => {
    const { container } = render(
      <div>
        <NewMessageToast trigger={5} />
        <QuotaWarningToast trigger={0} />
      </div>,
    );
    const quotaToast = container.querySelector('[data-testid="quota-warning-toast"]');
    expect(quotaToast).toBeTruthy();
    expect(quotaToast!.className).toContain('opacity-0');

    const { container: c2 } = render(<QuotaWarningToast trigger={3} />);
    expect(
      c2.querySelector('[data-testid="quota-warning-toast"]')!.className,
    ).toContain('opacity-100');
  });
});
