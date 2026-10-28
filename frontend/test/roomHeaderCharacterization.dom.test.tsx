/**
 * [FEAT-20260905-CUSTPROV PART 5] Characterization of the chat-room header bar.
 * ============================================================================
 * WHAT: a frozen DOM record of the header bar in the four states §28 names —
 *       open case · closed case (เคสนี้ปิดแล้ว) · quota present · quota
 *       absent/loading — plus the QuotaWarningToast "exactly once" rule and the
 *       showTierBadge gate on the HEADER badge site.
 *
 * WHY:  the bar is being lifted out of `ChatRoomView.tsx` into
 *       `components/chat/room-header/`. That is a MOVE, not a redesign, so the
 *       only acceptable proof is "the DOM that came out is the DOM that went
 *       in". This file is written and made GREEN against the UNMOVED component
 *       first (dev-local §6.3 step 2), so the snapshots in
 *       `__snapshots__/roomHeaderCharacterization.dom.test.tsx.snap` are a
 *       recording of TODAY. After the move the same run must match them
 *       byte-for-byte; a single changed class string turns it red.
 *
 * 🔴 THE SNAPSHOT IS THE POINT. Do not re-record it to make a run pass. If it
 *    goes red after a refactor, the refactor changed the screen — that is the
 *    finding, not a stale fixture. ห้าม `-u` เพื่อให้เขียว — แดง = จอเปลี่ยนจริง
 *
 * NOT DUPLICATED HERE: the ticket-CARD half of the tier switch. It is already
 * proven by `test/tierSwitch.dom.test.tsx` (§B, site 2/2). Only the header
 * badge site is asserted below, because only the header is moving.
 *
 * ⚠️ jsdom paints nothing, so `toBeVisible()` is the matcher for "renders"
 *    (the [FIX-20260824-TARGETHIDDEN] lesson recorded in tierSwitch.dom.test.tsx)
 *    and a direct `.toBeNull()` query is the matcher for "never rendered".
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ 🔴 OPEN — FOUR NEIGHBOUR ANCHORS STILL POINT AT THE OLD ADDRESS.         ║
 * ║ These four cases read `components/chat/ChatRoomView.tsx` as SOURCE and   ║
 * ║ assert a string that this move relocated. Every asserted string still    ║
 * ║ exists VERBATIM — only its file changed — so each is a one-line repoint, ║
 * ║ not a rule that was lost:                                                ║
 * ║                                                                          ║
 * ║  test/headerNameDedup.value.test.ts:93   /headerNameParts\(\{/           ║
 * ║      → components/chat/room-header/parts/HeaderNameLine.tsx              ║
 * ║  test/lineGlow.value.test.ts:55          hasRawProfile((memberData ??    ║
 * ║      → components/chat/room-header/RoomHeader.tsx                        ║
 * ║  test/orphanRooms.value.test.ts:240      avatarRingClass({ is_orphan_... ║
 * ║      → components/chat/room-header/RoomHeader.tsx                        ║
 * ║  test/newMessageToast.dom.test.tsx:185   <NewMessageToast trigger={new...║
 * ║      → components/chat/room-header/RoomHeader.tsx. This one also orders  ║
 * ║        header < toast < stream; the stream anchor stays in ChatRoomView, ║
 * ║        so that half becomes structural (the header module contains no    ║
 * ║        message stream) rather than an index comparison.                  ║
 * ║                                                                          ║
 * ║ They were left untouched ON PURPOSE: this task's scope was the header    ║
 * ║ module, ChatRoomView.tsx and new test files, and two other agents are    ║
 * ║ working in this repo. The BEHAVIOUR each of them guards is covered by    ║
 * ║ the snapshots below — the dim mark, the ring class, the toast element    ║
 * ║ and the deduped name segments are all inside the recorded header HTML.   ║
 * ║ What they uniquely add is a SOURCE-level "nobody hand-wrote this class"  ║
 * ║ rule, which is theirs to keep, so it is not copied here. ไม่ก๊อปกฎมาไว้สองที่ ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * revert: delete this file and its snapshot file.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { QUOTA_WARNING_TOAST_MS } from '../components/chat/HeaderQuotaGauge';

/** A LINE quota payload at a chosen percentage — the shape `readQuota` reads. */
const quotaAt = (percent: number, limit = 300) => ({
  quota: { type: 'limited' as const, value: limit },
  consumption: { totalUsage: Math.round((limit * percent) / 100) },
  remaining: limit - Math.round((limit * percent) / 100),
});

/** Never settles — the gauge stays on its `header-quota-loading` skeleton. */
const NEVER = () => new Promise<never>(() => {});

beforeEach(() => {
  vi.resetModules();
  /* jsdom has no layout — same stub the other ChatRoomView mounts use */
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Mount the REAL ChatRoomView with the REAL header, the REAL HeaderQuotaGauge
 * and the REAL useHookQuota. Only the two network edges are mocked:
 * `chatService.getMessages` (the stream, irrelevant here) and
 * `webhookService.getHookQuota` (the quota read the gauge lives on). Mocking
 * the gauge itself would delete the thing under test.
 */
const mountHeader = async (opts: {
  quota?: () => Promise<unknown>;
  caseClosed?: boolean;
  canCloseCase?: boolean;
  onCloseCase?: () => void;
  showTierBadge?: boolean;
  memberData?: unknown;
  oaName?: string | undefined;
  omitOaName?: boolean;
} = {}) => {
  vi.doMock('../services/chat', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../services/chat');
    return {
      ...actual,
      chatService: {
        ...(actual.chatService as Record<string, unknown>),
        getMessages: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
      useTicketWS: () => undefined,
    };
  });
  vi.doMock('../services/hook', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../services/hook');
    return {
      ...actual,
      webhookService: {
        ...(actual.webhookService as Record<string, unknown>),
        getHookQuota: vi.fn(opts.quota ?? (() => Promise.resolve(quotaAt(50)))),
      },
    };
  });
  const { ChatRoomView } = await import('../components/chat/ChatRoomView');
  const { __resetQuotaThrottleForTests } = await import(
    '../components/chat/HeaderQuotaGauge'
  );
  __resetQuotaThrottleForTests();

  const room = {
    _id: 'room1',
    line_user_id: 'U1',
    hook_id: 'hook1',
    user_data: {
      _id: 'm1',
      display_name: 'ไอติม',
      full_name: 'ไอติม',
      nickname: 'bbbb',
      picture_url: 'https://example.test/a.png',
    },
  } as never;

  /* omit the prop entirely when unset, so the component's OWN default runs */
  const tier = opts.showTierBadge === undefined ? {} : { showTierBadge: opts.showTierBadge };
  const oa = opts.omitOaName ? {} : { oaName: opts.oaName ?? 'omnidesk-dev-oa' };

  const utils = render(
    <ChatRoomView
      room={room}
      hookId="hook1"
      headerTitle="0925550014"
      showDetailBox={false}
      memberId="m1"
      memberData={opts.memberData ?? { _id: 'm1', tier: { name: 'Normal', level: 0 } }}
      caseClosed={opts.caseClosed}
      canCloseCase={opts.canCloseCase}
      onCloseCase={opts.onCloseCase}
      onOpenFontScale={() => {}}
      fontScaleLabel="ขนาดตัวอักษร"
      {...tier}
      {...oa}
    />,
  );
  return utils;
};

/** The bar itself — one element, so its outerHTML is the whole record. */
const headerOf = (container: HTMLElement): HTMLElement => {
  const el = container.querySelector('.tc-chat-header');
  expect(el, 'the header bar must exist').not.toBeNull();
  return el as HTMLElement;
};

/* ══════════════════════════════════════════════════════════════════════════
 * §1 — the four states, recorded as DOM snapshots
 * ══════════════════════════════════════════════════════════════════════════ */
describe('[CUSTPROV PART 5] the header bar — four frozen states', () => {
  it('⭐ state 1/4 · OPEN case — the close-case button is on screen and pressable', async () => {
    const { container } = await mountHeader({
      onCloseCase: () => {},
      canCloseCase: true,
      quota: NEVER,
    });
    const header = headerOf(container);
    const close = Array.from(header.querySelectorAll('button')).find((b) =>
      (b.textContent || '').includes('ปิดเคส'),
    );
    expect(close, 'the close-case control must render on an open case').toBeTruthy();
    expect(close).toBeVisible();
    expect((close as HTMLButtonElement).disabled).toBe(false);
    expect(header.textContent).not.toContain('เคสนี้ปิดแล้ว');
    expect(header.outerHTML).toMatchSnapshot('open-case');
  });

  it('⭐ state 2/4 · CLOSED case — the badge replaces the button, no way to press it', async () => {
    const { container } = await mountHeader({
      onCloseCase: () => {},
      canCloseCase: true,
      caseClosed: true,
      quota: NEVER,
    });
    const header = headerOf(container);
    expect(header.textContent).toContain('เคสนี้ปิดแล้ว');
    const close = Array.from(header.querySelectorAll('button')).find((b) =>
      (b.textContent || '').trim().startsWith('ปิดเคส'),
    );
    expect(close, 'the close-case BUTTON must be gone once the case is closed').toBeUndefined();
    expect(header.outerHTML).toMatchSnapshot('closed-case');
  });

  /* 🔴 50%, NOT 90%, AND THE REASON MATTERS.
     The first draft of this case read the quota at exactly 90% — the danger
     threshold. That crossing fires `onDanger`, which bumps `quotaWarnTick`,
     which flips the warning toast from `opacity-0 scale-95` to
     `opacity-100 scale-100` in a LATER commit than the one that first paints
     the gauge. `waitFor` only waited for the gauge, so the recorded HTML
     captured whichever commit won the race: 1 run in ~10 disagreed with the
     other 9 and the snapshot went red with nothing changed in the product.
     A characterization gate that flickers is worse than no gate — it teaches
     everyone to re-record instead of to look. This state now asks one question
     only ("is the gauge showing real numbers"); the ≥90% behaviour has its own
     timing-explicit cases in §3. เกจกับ toast คนละเรื่อง อย่าวัดพร้อมกัน */
  it('⭐ state 3/4 · quota PRESENT — the gauge shows the real numbers', async () => {
    const { container } = await mountHeader({
      onCloseCase: () => {},
      canCloseCase: true,
      quota: () => Promise.resolve(quotaAt(50, 300)),
    });
    await waitFor(() =>
      expect(container.querySelector('[data-testid="header-quota"]')).not.toBeNull(),
    );
    const header = headerOf(container);
    const gauge = header.querySelector('[data-testid="header-quota"]');
    expect(gauge).toBeVisible();
    expect(gauge!.textContent).toContain('ใช้ไปแล้ว');
    expect(header.outerHTML).toMatchSnapshot('quota-present');
  });

  it('⭐ state 4/4 · quota ABSENT/loading — the skeleton holds the slot, nothing else moves', async () => {
    const { container } = await mountHeader({
      onCloseCase: () => {},
      canCloseCase: true,
      quota: NEVER,
    });
    const header = headerOf(container);
    expect(header.querySelector('[data-testid="header-quota-loading"]')).toBeVisible();
    expect(header.querySelector('[data-testid="header-quota"]')).toBeNull();
    expect(header.outerHTML).toMatchSnapshot('quota-loading');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §2 — the three things §26 says a header may NEVER hide
 * ══════════════════════════════════════════════════════════════════════════ */
describe('[CUSTPROV PART 5] §26 — the header always carries these', () => {
  /* ⚠️ ONE mount per `it`. `vi.doMock` is only re-evaluated after
     `vi.resetModules()`, which runs in `beforeEach` — a second mount inside the
     same case silently reuses the FIRST case's quota mock. That is exactly how
     the first draft of this file failed, and splitting the case is the fix;
     forcing `resetModules()` mid-test would hand RTL a second React instance.
     หนึ่งเทส = หนึ่ง mount */
  it('🔴 the quota slot holds its skeleton while the read is still in flight', async () => {
    const { container } = await mountHeader({ quota: NEVER });
    expect(
      headerOf(container).querySelector('[data-testid="header-quota-loading"]'),
    ).toBeVisible();
  });

  it('🔴 the quota slot shows the live gauge once the read lands', async () => {
    const { container } = await mountHeader({ quota: () => Promise.resolve(quotaAt(40)) });
    await waitFor(() =>
      expect(container.querySelector('[data-testid="header-quota"]')).not.toBeNull(),
    );
    expect(headerOf(container).querySelector('[data-testid="header-quota"]')).toBeVisible();
  });

  it('🔴 an OPEN case always offers the close-case control', async () => {
    const { container } = await mountHeader({
      onCloseCase: () => {},
      canCloseCase: true,
      quota: NEVER,
    });
    expect(headerOf(container).textContent).toContain('ปิดเคส');
  });

  it('🔴 a CLOSED case always says so in the same slot', async () => {
    const { container } = await mountHeader({
      onCloseCase: () => {},
      caseClosed: true,
      quota: NEVER,
    });
    expect(headerOf(container).textContent).toContain('เคสนี้ปิดแล้ว');
  });

  it('🔴 AA (font scale) and search are both on the bar', async () => {
    const { container } = await mountHeader({ quota: NEVER });
    const header = headerOf(container);
    expect(
      header.querySelector('button[title="ขนาดตัวอักษร"]'),
      'the AA control must render whenever onOpenFontScale is passed',
    ).toBeVisible();
    expect(
      header.querySelector('button[title="ค้นหาข้อความในห้องนี้"]'),
      'the search control must render',
    ).toBeVisible();
  });

  it('⭐ with NEITHER an OA name nor a tier, the controls still render', async () => {
    /* 🔴 THIS CASE WAS INVERTED ON 06/09, AND THE OLD ONE DID ITS JOB FIRST.
       It used to pin the opposite — that the whole second row, search and AA and
       close-case included, vanished when there was no OA name and no tier —
       explicitly so that a REFACTOR could not quietly "fix" it. That was right:
       a move must reproduce what ships, and a behaviour change needs its own
       decision.

       This is that decision. The gate's purpose was never to hide anything; it
       was to stop an EMPTY row pushing the header taller. But the controls sat
       inside it, and the legacy page sends no `oaName` at all, so a customer
       with no tier left the operator with NO WAY TO CLOSE THE CASE — the exact
       outcome plan §26 names when it says these three may never be hidden.
       See [FIX-20260906-HEADERCONTROLS] in `RoomHeader.tsx`.
       เคสเดิมทำหน้าที่ของมันแล้ว — กันไม่ให้แก้เงียบ ตอนนี้แก้แบบตั้งใจ */
    const { container } = await mountHeader({
      omitOaName: true,
      memberData: { _id: 'm1' },
      onCloseCase: () => {},
      canCloseCase: true,
      quota: NEVER,
    });
    const header = headerOf(container);
    expect(
      header.querySelector('button[title="ค้นหาข้อความในห้องนี้"]'),
      'search must survive an absent OA name and tier',
    ).toBeVisible();
    expect(header.textContent, 'close-case must survive them too').toContain(
      'ปิดเคส',
    );
    expect(header.outerHTML).toMatchSnapshot('no-oa-no-tier');
  });

  it('⭐ the search control is UNCONDITIONAL — the reason the gate could go', () => {
    /* The old gate's stated purpose was to stop an EMPTY row. That purpose never
       applied: `<HeaderActions>` sits in the row and its search button has no
       condition on it, so the row always had at least one child. Removing the
       gate is therefore safe — but only while that stays true.

       This reads the SOURCE rather than the DOM on purpose. The DOM cases above
       prove what renders today; this one pins the PROPERTY the removal rests on,
       so anyone who later makes search conditional lands on a red test and this
       comment instead of quietly reintroducing an empty row.
       เอา gate ออกได้เพราะปุ่มค้นหาไม่มีเงื่อนไข — วันที่มีเงื่อนไข ต้องกลับมาคิดใหม่ */
    const actions = readFileSync(
      resolve(__dirname, '../components/chat/room-header/parts/HeaderActions.tsx'),
      'utf8',
    );
    expect(actions).toContain('ค้นหาข้อความในห้องนี้');
    /* The property is stated directly rather than inferred from where the
       nearest `&&` sits: an earlier attempt scanned for any `{x && (` between
       the row's <div> and the button and went red on the AA control's own
       gate, which is a DIFFERENT control and perfectly allowed to have one.
       A guard that fires on its neighbour teaches people to delete it. */
    expect(actions, 'the search control must not be gated').not.toContain(
      '{onToggleSearch && (',
    );
    const view = readFileSync(
      resolve(__dirname, '../components/chat/ChatRoomView.tsx'),
      'utf8',
    );
    expect(view, 'and the page must always supply it').toContain(
      'onToggleSearch={',
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §3 — QuotaWarningToast: exactly ONE fire per crossing into ≥90%
 * ══════════════════════════════════════════════════════════════════════════
 * §27 calls this the riskiest surface on the bar despite being the smallest:
 * a re-render change can double-fire the warning or silence it. The guard is
 * `wasDangerRef` inside HeaderQuotaGauge; what the MOVE can break is the
 * wiring around it — a gauge that remounts each render resets that ref, and a
 * toast that remounts replays its effect. Both show up here.
 *
 * The observable: the toast auto-hides after QUOTA_WARNING_TOAST_MS. Fire →
 * visible; wait it out → hidden; a SECOND high read must leave it hidden.
 */
const toastVisible = (container: HTMLElement): boolean => {
  const t = container.querySelector('[data-testid="quota-warning-toast"]');
  expect(t, 'the quota toast element is always mounted').not.toBeNull();
  return (t as HTMLElement).className.includes('opacity-100');
};

describe('[CUSTPROV PART 5] QuotaWarningToast fires once, at 90%', () => {
  it('⭐ crossing into ≥90% shows the warning exactly once — a second high read does NOT re-fire', async () => {
    vi.useFakeTimers();
    const getQuota = vi.fn(() => Promise.resolve(quotaAt(95, 300)));
    const { container } = await mountHeader({ quota: getQuota });

    // let the mount read settle (the mock resolves on the microtask queue)
    await act(async () => {});
    expect(toastVisible(container), 'first crossing into danger must warn').toBe(true);

    // ride out the toast's own lifetime
    await act(async () => {
      vi.advanceTimersByTime(QUOTA_WARNING_TOAST_MS + 200);
    });
    expect(toastVisible(container), 'the warning hides itself on schedule').toBe(false);

    // a push refresh: a SECOND completed read, still ≥90%, still the same crossing
    const before = getQuota.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('tc:quota-refresh'));
    });
    await act(async () => {});
    expect(getQuota.mock.calls.length, 'the push refresh really did re-read').toBeGreaterThan(
      before,
    );
    expect(
      toastVisible(container),
      'still inside the same ≥90% period — the operator must not be warned twice',
    ).toBe(false);
  });

  it('under the threshold nothing fires at all — 89% is not a warning', async () => {
    vi.useFakeTimers();
    const { container } = await mountHeader({
      quota: () => Promise.resolve(quotaAt(89, 300)),
    });
    await act(async () => {});
    expect(toastVisible(container)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §4 — showTierBadge governs the HEADER badge site
 * ══════════════════════════════════════════════════════════════════════════
 * The ticket-CARD site is proven in test/tierSwitch.dom.test.tsx and is NOT
 * repeated here. What is repeated on purpose is the header site, because the
 * header is the thing moving: after the move this prop travels one hop further
 * (ChatRoomView -> RoomHeader), and `tsc` does not check JSX props here, so a
 * dropped prop would be a silently missing badge with a clean build.
 */
describe('[CUSTPROV PART 5] showTierBadge on the moved surface', () => {
  it('⭐ unset (default) → the 💎 badge renders', async () => {
    const { container } = await mountHeader({ quota: NEVER });
    const badge = headerOf(container).querySelector('.panel-badge-purple');
    expect(badge).toBeVisible();
    expect(badge!.textContent).toContain('Normal');
  });

  it('🔴 showTierBadge={false} → the badge is not in the header DOM at all', async () => {
    const { container } = await mountHeader({ showTierBadge: false, quota: NEVER });
    expect(headerOf(container).querySelector('.panel-badge-purple')).toBeNull();
  });
});
