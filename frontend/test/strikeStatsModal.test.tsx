import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

/**
 * [FEAT-20260826-STRIKESUSPEND] The per-customer strike modal + the avatar mark.
 * ===========================================================================
 * 📖 PLAN: `omnidesk-api/todo/task/26082026/todo10_26082026_strike-suspend.md`
 *
 * WHAT IS WORTH PINNING HERE, and what is not. The markup is not — it will be
 * restyled and a snapshot would only make that painful. What must not drift is
 * the set of RULES the owner stated, each of which is a separate decision that a
 * later edit could quietly undo:
 *
 *   · opening is always allowed; CLEARING waits for the lock  (two conditions)
 *   · the threshold is the SERVER's, never a constant on this side
 *   · the mark appears only while locked, and never eats the avatar's click
 *   · nothing is fetched while the modal is closed
 *
 * Each test below is one of those, and the mutation notes say what breaks it.
 */
const current = vi.fn();
const sessions = vi.fn();
const listSuspended = vi.fn();
const clearSession = vi.fn();
// [FEAT-20260827-ADMINBLOCK] the block call the new button makes
const suspendSession = vi.fn();

vi.mock('../services/strike/strikeService', () => ({
  __esModule: true,
  default: {
    current: (...a: unknown[]) => current(...a),
    sessions: (...a: unknown[]) => sessions(...a),
    listSuspended: (...a: unknown[]) => listSuspended(...a),
    clearSession: (...a: unknown[]) => clearSession(...a),
    suspendSession: (...a: unknown[]) => suspendSession(...a),
  },
}));

/* The real `t` returns a template that the component fills in with `.replace`,
   so a mock that returns the bare key would make the "3 left" assertion vacuous
   — it would pass on a component that never substituted anything. These two
   carry their placeholder, exactly like the shipped strings.
   mock ต้องมี placeholder จริง ไม่งั้นเทสผ่านทั้งที่ไม่ได้แทนค่า */
vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (k: string) =>
      k === 'strike.rule_line'
        ? 'ceiling {n} within {h} h'
        : k === 'strike.window'
          ? 'within {h} h'
          : k,
  }),
}));

import { StrikeStatsModal } from '../components/common/strike/StrikeStatsModal';
import { StrikeCautionMark } from '../components/common/strike/StrikeCautionMark';

const session = (over: Record<string, unknown> = {}) => ({
  _id: 's1',
  line_user_id: 'U1',
  seq: 1,
  status: 'open',
  strike_total: 2,
  by_level: { '1': 2 },
  opened_at: '2026-08-26T10:00:00.000Z',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  current.mockResolvedValue({ current: session() });
  sessions.mockResolvedValue({ sessions: [session()] });
  listSuspended.mockResolvedValue({
    suspended: [],
    policy: { suspend_at: 5, window_hours: 24 },
  });
  clearSession.mockResolvedValue({ closed: session({ status: 'closed' }) });
  suspendSession.mockResolvedValue({
    suspended: session({ suspended_at: '2026-08-27T10:00:00Z' }),
  });
});

describe('StrikeCautionMark — the red ! on the avatar', () => {
  it('renders nothing at all when the customer is not locked', () => {
    /* An absent mark is the normal state. Rendering a hidden one would still
       cover the avatar and swallow the click that opens the modal. */
    const { container } = render(
      <StrikeCautionMark suspended={false} label="x" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('appears when locked', () => {
    render(<StrikeCautionMark suspended label="locked" />);
    expect(screen.getByTestId('strike-caution-mark')).toBeTruthy();
  });

  it('⭐ never eats the click meant for the avatar underneath', () => {
    /* 🔴 THE MUTATION THIS EXISTS FOR: drop `pointer-events-none` and every
       other test here still passes, while the feature breaks in the exact place
       it matters — a locked customer is precisely the one whose stats an admin
       wants to open, and the mark sits on top of that button.
       ครอบปุ่มอยู่ ⇒ ต้องคลิกทะลุได้ */
    render(<StrikeCautionMark suspended label="locked" />);
    expect(
      screen.getByTestId('strike-caution-mark').className,
    ).toContain('pointer-events-none');
  });
});

describe('StrikeStatsModal — the numbers', () => {
  it('reads the ceiling from the SERVER policy, never a local constant', async () => {
    /* [FIX-20260830-STRIKEHONEST] the cap left the headline with the fraction.
       What this case really guards — that the number comes from the server —
       still holds, now on the rule line. */
    current.mockResolvedValue({ current: session({ strike_total: 2 }) });
    listSuspended.mockResolvedValue({
      suspended: [],
      policy: { suspend_at: 9, window_hours: 24 },
    });
    render(<StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear />);
    await waitFor(() =>
      expect(screen.getByTestId('strike-rule').textContent).toContain('9'),
    );
    expect(screen.getByTestId('strike-current-count').textContent).toContain('2');
  });

  it('states the RULE from the server policy — never a countdown', async () => {
    /* [FIX-20260830-STRIKEHONEST] supersedes "says how many are left". The
       countdown was computed from `strike_total`, a running total with no time
       window, while the lock counts events INSIDE the window — so it could read
       "0 left" for a customer who would never be locked (owner, 30/08). The
       screen now states the rule instead of promising an outcome, with both
       numbers straight from `policy` so env changes carry through. */
    render(<StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear />);
    await waitFor(() => screen.getByTestId('strike-rule'));
    const txt = screen.getByTestId('strike-rule').textContent ?? '';
    expect(txt).toContain('5'); // policy.suspend_at
    expect(txt).toContain('24'); // policy.window_hours
    expect(screen.queryByTestId('strike-remaining')).toBeNull();
    /* MUTATION NOTE: deleting the note below left this green — the rule line
       alone still does not say that the big number is NOT what gets counted,
       which is the whole misreading being fixed. Pinned separately. */
    expect(screen.getByTestId('strike-rule-note')).toBeTruthy();
  });

  it('a total ABOVE the ceiling is shown as-is, with no fraction to contradict it', async () => {
    /* the old case guarded a negative countdown; there is no countdown now, and
       the total is labelled as a total, so 12 is simply 12. */
    current.mockResolvedValue({ current: session({ strike_total: 12 }) });
    render(<StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear />);
    await waitFor(() => screen.getByTestId('strike-current-count'));
    const el = screen.getByTestId('strike-current-count');
    expect(el.textContent).toContain('12');
    expect(el.textContent).not.toContain('/');
  });

  it('⭐ turns the number dark red once locked, and says so', async () => {
    current.mockResolvedValue({
      current: session({ strike_total: 5, suspended_at: '2026-08-26T11:00:00Z' }),
    });
    render(<StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear />);
    await waitFor(() =>
      expect(screen.getByTestId('strike-current-count').className).toContain(
        'text-rose-800',
      ),
    );
    expect(screen.getByTestId('strike-locked-note')).toBeTruthy();
  });
});

describe('StrikeStatsModal — who may clear, and when', () => {
  it('⭐ no clear button while the customer is merely striking', async () => {
    /* Owner, 26/08: opening is always allowed, but the clear button waits for
       red. A customer at 2 of 5 has nothing to release.
       🔴 Mutation: drop `isLocked` from the render condition. */
    render(<StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear />);
    await waitFor(() => screen.getByTestId('strike-current-count'));
    expect(screen.queryByTestId('strike-clear-button')).toBeNull();
  });

  it('⭐ no clear button without strike.manage, even when locked', async () => {
    /* Reading is `ticket.manage`, clearing is `strike.manage`. Offering the
       button to everyone is a 403 waiting to happen.
       🔴 Mutation: drop `canClear` from the render condition. */
    current.mockResolvedValue({
      current: session({ strike_total: 5, suspended_at: '2026-08-26T11:00:00Z' }),
    });
    render(
      <StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear={false} />,
    );
    await waitFor(() => screen.getByTestId('strike-current-count'));
    expect(screen.queryByTestId('strike-clear-button')).toBeNull();
  });

  it('shows it only when BOTH hold — and the click alone calls NOTHING', async () => {
    /* [FEAT-20260827-CLEARCONSENT] the clear button stopped being a one-click
       danger: it now only OPENS the consent dialog, symmetric with Block.
       🔴 Mutation: put `void clear()` back on the button's onClick — this
       first assertion goes red. */
    current.mockResolvedValue({
      current: session({ strike_total: 5, suspended_at: '2026-08-26T11:00:00Z' }),
    });
    const onCleared = vi.fn();
    render(
      <StrikeStatsModal
        lineUserId="U1"
        onClose={() => {}}
        canClear
        onCleared={onCleared}
      />,
    );
    const btn = await screen.findByTestId('strike-clear-button');
    fireEvent.click(btn);
    expect(clearSession).not.toHaveBeenCalled();

    // tick + confirm — only then does the endpoint fire
    fireEvent.click(
      document.querySelector(
        '[data-testid="confirm-consent"] input',
      ) as HTMLInputElement,
    );
    fireEvent.click(
      screen
        .getAllByText('common.confirm')
        .find((el) => el.tagName === 'BUTTON') as HTMLButtonElement,
    );
    await waitFor(() => expect(clearSession).toHaveBeenCalledWith('s1', expect.any(String)));
    await waitFor(() => expect(onCleared).toHaveBeenCalled());
  });

  it('⭐ the clear confirm stays dead until the consent box is ticked', async () => {
    /* 🔴 Mutation: drop `confirmDisabled={!clearConsent}` on the clear dialog. */
    current.mockResolvedValue({
      current: session({ strike_total: 5, suspended_at: '2026-08-26T11:00:00Z' }),
    });
    render(<StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear />);
    fireEvent.click(await screen.findByTestId('strike-clear-button'));

    const confirm = screen
      .getAllByText('common.confirm')
      .find((el) => el.tagName === 'BUTTON') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(clearSession).not.toHaveBeenCalled();

    fireEvent.click(
      document.querySelector(
        '[data-testid="confirm-consent"] input',
      ) as HTMLInputElement,
    );
    expect(
      (
        screen
          .getAllByText('common.confirm')
          .find((el) => el.tagName === 'BUTTON') as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it('⭐ closing the clear dialog forgets the tick — reopening starts unticked', async () => {
    /* Same WebhookList warning as Block: a remembered tick makes the NEXT
       confirm a single click. 🔴 Mutation: drop `setClearConsent(false)` from
       the dialog's onClose. */
    current.mockResolvedValue({
      current: session({ strike_total: 5, suspended_at: '2026-08-26T11:00:00Z' }),
    });
    render(<StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear />);
    fireEvent.click(await screen.findByTestId('strike-clear-button'));
    const box = () =>
      document.querySelector(
        '[data-testid="confirm-consent"] input',
      ) as HTMLInputElement | null;
    fireEvent.click(box()!);
    expect(box()!.checked).toBe(true);

    const cancel = screen
      .getAllByText('common.cancel')
      .find((el) => el.tagName === 'BUTTON') as HTMLButtonElement;
    fireEvent.click(cancel);
    expect(box()).toBeNull();

    fireEvent.click(screen.getByTestId('strike-clear-button'));
    expect(box()!.checked).toBe(false);
  });
});

describe('StrikeStatsModal — what it costs', () => {
  it('⭐ a customer with no strikes still opens, and does not crash', async () => {
    /* `null` is the ordinary answer for almost every customer — the session is
       only created on the first strike. A modal that throws here would break the
       avatar click for everybody who has never been throttled. */
    current.mockResolvedValue({ current: null });
    sessions.mockResolvedValue({ sessions: [] });
    render(<StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear />);
    await waitFor(() =>
      expect(screen.getByTestId('strike-current-count').textContent).toContain(
        '0',
      ),
    );
    expect(screen.queryByTestId('strike-clear-button')).toBeNull();
  });

  it('survives a strike endpoint that is switched off', async () => {
    current.mockRejectedValue(new Error('404'));
    sessions.mockRejectedValue(new Error('404'));
    render(<StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear />);
    // it must reach a rendered state rather than throwing out of the tree
    await waitFor(() => expect(screen.getByTestId('strike-stats-modal')).toBeTruthy());
  });
});

/* ── [FEAT-20260827-ADMINBLOCK] the Block button — "Block จำกัดการคุย" ────────
   📖 PLAN: `omnidesk-api/todo/task/27082026/todo8_27082026_admin-block-suspend.md`

   The mirror of the clear rules above: same privilege (`strike.manage`, via the
   same `canClear` prop), OPPOSITE lock condition — block offers while the
   customer is NOT yet locked, clear offers once they are. And a consent
   checkbox stands between the click and the call, the webhook-delete way. */

describe('StrikeStatsModal — the Block button', () => {
  const consentBox = () =>
    document.querySelector(
      '[data-testid="confirm-consent"] input',
    ) as HTMLInputElement | null;
  const confirmBtn = () =>
    screen
      .getAllByText('common.confirm')
      .find((el) => el.tagName === 'BUTTON') as HTMLButtonElement | undefined;

  it('⭐ offers Block while unlocked — and only to strike.manage holders', async () => {
    /* 🔴 Mutation: drop `!isLocked` or `canClear` from the render condition. */
    render(<StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear />);
    expect(await screen.findByTestId('strike-block-button')).toBeTruthy();
  });

  it('no Block button once locked — clear takes its place', async () => {
    current.mockResolvedValue({
      current: session({ strike_total: 5, suspended_at: '2026-08-26T11:00:00Z' }),
    });
    render(<StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear />);
    await waitFor(() => screen.getByTestId('strike-clear-button'));
    expect(screen.queryByTestId('strike-block-button')).toBeNull();
  });

  it('no Block button without the permission', async () => {
    render(
      <StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear={false} />,
    );
    await waitFor(() => screen.getByTestId('strike-current-count'));
    expect(screen.queryByTestId('strike-block-button')).toBeNull();
  });

  it('⭐ the confirm stays dead until the consent box is ticked', async () => {
    /* 🔴 Mutation: drop `confirmDisabled={!blockConsent}` — the danger button
       becomes one habitual click, which is the failure the checkbox exists to
       stop (see ConfirmConsentCheck's header). */
    render(<StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear />);
    fireEvent.click(await screen.findByTestId('strike-block-button'));

    const btn = confirmBtn();
    expect(btn).toBeTruthy();
    expect(btn!.disabled).toBe(true);
    expect(suspendSession).not.toHaveBeenCalled();

    fireEvent.click(consentBox()!);
    expect(confirmBtn()!.disabled).toBe(false);
  });

  it('ticked + confirmed → calls the block endpoint and tells the caller', async () => {
    const onCleared = vi.fn();
    render(
      <StrikeStatsModal
        lineUserId="U1"
        onClose={() => {}}
        canClear
        onCleared={onCleared}
      />,
    );
    fireEvent.click(await screen.findByTestId('strike-block-button'));
    fireEvent.click(consentBox()!);
    fireEvent.click(confirmBtn()!);

    await waitFor(() =>
      expect(suspendSession).toHaveBeenCalledWith('U1', expect.any(String)),
    );
    /* the same refresh pipe the clear uses — the avatar mark and the header
       tray key off it, so a block must fire it too */
    await waitFor(() => expect(onCleared).toHaveBeenCalled());
  });

  it('⭐ closing the dialog clears the consent — reopening starts unticked', async () => {
    /* 🔴 The precedent's warning (WebhookList): a remembered tick makes the
       NEXT confirm a single click, more dangerous than having no checkbox. */
    render(<StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear />);
    fireEvent.click(await screen.findByTestId('strike-block-button'));
    fireEvent.click(consentBox()!);
    expect(consentBox()!.checked).toBe(true);

    // cancel = the second button in the dialog footer
    const cancel = screen
      .getAllByText('common.cancel')
      .find((el) => el.tagName === 'BUTTON') as HTMLButtonElement;
    fireEvent.click(cancel);
    expect(consentBox()).toBeNull();

    fireEvent.click(screen.getByTestId('strike-block-button'));
    expect(consentBox()!.checked).toBe(false);
  });

  it('⭐⭐ an ADMIN block shows the real 0 — the lock is explained, not faked', async () => {
    /* [FIX-20260830-STRIKEHONEST] supersedes [FIX-2708-MAXDISPLAY], which painted
       cap/cap while locked so "0/5 แต่บอทเงียบ" would not confuse. That confusion
       came FROM the fraction: it implied strikes caused the lock when an admin
       did. With no fraction, 0 is simply the truth, and the two labels already on
       screen say why the bot is silent. */
    current.mockResolvedValue({
      current: session({
        strike_total: 0,
        suspended_at: '2026-08-26T11:00:00Z',
        suspended_by: 'admin1',
      }),
    });
    render(<StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear />);
    await waitFor(() => screen.getByTestId('strike-current-count'));
    const big = screen.getByTestId('strike-current-count').textContent ?? '';
    expect(big).toContain('0');
    expect(big).not.toContain('/');
    expect(screen.getByTestId('strike-locked-note')).toBeTruthy();
    expect(screen.getByTestId('strike-blocked-by-admin')).toBeTruthy();
  });

  it('⭐ [MAXDISPLAY] แถวประวัติรายใบ: คงเลขจริง + ป้าย "Block โดยแอดมิน" เฉพาะใบที่โดน force', async () => {
    /* เจ้าของเคาะ: เลขประวัติห้ามโกหก (ใบ Block = 0 จริง) แต่ต้องอ่านออกว่า
       ใบนั้นเกิดจาก force block — ป้ายจิ๋ว seamless ใช้คีย์แปลเดิม */
    sessions.mockResolvedValue({
      sessions: [
        session({ _id: 's2', seq: 2, strike_total: 0, suspended_by: 'u-9' }),
        session({ _id: 's1', seq: 1, strike_total: 3 }),
      ],
    });
    render(<StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear />);
    await screen.findByTestId('strike-current-count');
    const tags = screen.getAllByTestId('strike-session-blocktag');
    expect(tags).toHaveLength(1);
    // เลขจริงยังอยู่ครบทั้งสองใบ
    expect(document.body.textContent).toContain('3');
  });

  it('says when the lock was an admin order, not the ceiling', async () => {
    current.mockResolvedValue({
      current: session({
        strike_total: 0,
        suspended_at: '2026-08-27T10:00:00Z',
        suspended_by: 'a0d00000000000000000000e',
      }),
    });
    render(<StrikeStatsModal lineUserId="U1" onClose={() => {}} canClear />);
    await waitFor(() =>
      expect(screen.getByTestId('strike-blocked-by-admin')).toBeTruthy(),
    );
  });
});
