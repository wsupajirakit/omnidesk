/**
 * [FEAT-20260829-MANUALFOLLOWSTAMP] pressing an `n/a` follow-up row records the time.
 *
 * Owner 29/08: on the customer panel, "ติดตามฝาก" / "ติดตามถอน" are pressable while
 * they read `n/a`; a clock icon marks them, each press is confirmed, and only these
 * two values may be stamped this way.
 *
 * The three things worth guarding, because each is easy to widen by accident:
 *   · only the two allowed rows are pressable — `FOLLOW_ROWS` and `ALERT_ROWS` can
 *     grow (`notice_payment_at`, `request_reg_at` are one uncommented line away)
 *     and those have their own writers and meanings;
 *   · only while EMPTY — a row that already carries a time is plain text, so a
 *     stale panel cannot overwrite a record other screens report on;
 *   · nothing is written until the confirm is accepted, and nothing is claimed on
 *     screen until the server says what it wrote.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/* `vi.mock` is hoisted above the imports, so the spy has to be created inside
   `vi.hoisted` — a plain `const` above would not exist yet when the factory runs. */
const { setFollowStamp } = vi.hoisted(() => ({ setFollowStamp: vi.fn() }));
vi.mock('../services/chat/followStampService', async () => {
  const actual = await vi.importActual<
    typeof import('../services/chat/followStampService')
  >('../services/chat/followStampService');
  return { ...actual, followStampService: { setFollowStamp } };
});

import { FollowUpCard } from '../components/member/follow-up/FollowUpCard';
import { stampKindForRow } from '../services/chat/followStampService';
import { I18nProvider } from '../i18n';

const MEMBER = 'a0d00000000000000000001e';

const roomWith = (line: Record<string, unknown>, memberId: string | null = MEMBER) =>
  ({
    _id: 'room1',
    user_data: { _id: memberId, config: { follow_up: { line } } },
  }) as never;

const openCard = (room: unknown) => {
  const view = render(
    <I18nProvider>
      <FollowUpCard room={room as never} />
    </I18nProvider>,
  );
  // the card ships collapsed
  fireEvent.click(screen.getByRole('button', { expanded: false }));
  return view;
};

beforeEach(() => {
  setFollowStamp.mockReset();
  setFollowStamp.mockResolvedValue({
    success: true,
    data: {
      kind: 'deposit',
      key: 'follow_up.line.notice_deposit_at',
      at: '2026-08-29T16:30:00.000Z',
    },
  });
});
afterEach(() => vi.clearAllMocks());

describe('the allow-list — only two rows may be stamped', () => {
  it('maps exactly the deposit and withdraw rows', () => {
    expect(stampKindForRow('notice_deposit_at')).toBe('deposit');
    expect(stampKindForRow('notice_withdraw_at')).toBe('withdraw');
  });

  it('refuses every other follow_up row', () => {
    expect(stampKindForRow('notice_payment_at')).toBeNull();
    expect(stampKindForRow('request_reg_at')).toBeNull();
    expect(stampKindForRow('abandon_at')).toBeNull();
    expect(stampKindForRow('')).toBeNull();
  });
});

describe('when the row is empty', () => {
  it('both rows become buttons', () => {
    openCard(roomWith({}));
    expect(screen.getByTestId('follow-stamp-notice_deposit_at')).toBeTruthy();
    expect(screen.getByTestId('follow-stamp-notice_withdraw_at')).toBeTruthy();
  });

  it('the button carries a clock icon and still shows n/a', () => {
    openCard(roomWith({}));
    const btn = screen.getByTestId('follow-stamp-notice_deposit_at');
    expect(btn.querySelector('svg')).toBeTruthy();
    expect(btn.textContent).toContain('n/a');
  });

  it('null and empty string count as empty, same as the display rule', () => {
    openCard(roomWith({ notice_deposit_at: null, notice_withdraw_at: '' }));
    expect(screen.getByTestId('follow-stamp-notice_deposit_at')).toBeTruthy();
    expect(screen.getByTestId('follow-stamp-notice_withdraw_at')).toBeTruthy();
  });
});

describe('when the row already has a time', () => {
  it('that row is NOT a button', () => {
    openCard(roomWith({ notice_deposit_at: '2026-08-22T16:30:00.000Z' }));
    expect(screen.queryByTestId('follow-stamp-notice_deposit_at')).toBeNull();
  });

  it('the OTHER row is still pressable — the two are independent', () => {
    openCard(roomWith({ notice_deposit_at: '2026-08-22T16:30:00.000Z' }));
    expect(screen.getByTestId('follow-stamp-notice_withdraw_at')).toBeTruthy();
  });
});

describe('without a member id there is nothing to write to', () => {
  it('no button is offered', () => {
    openCard(roomWith({}, null));
    expect(screen.queryByTestId('follow-stamp-notice_deposit_at')).toBeNull();
    expect(screen.queryByTestId('follow-stamp-notice_withdraw_at')).toBeNull();
  });
});

describe('the confirm step', () => {
  it('pressing does NOT write yet — it asks first', () => {
    openCard(roomWith({}));
    fireEvent.click(screen.getByTestId('follow-stamp-notice_deposit_at'));
    expect(setFollowStamp).not.toHaveBeenCalled();
    expect(screen.getByText('บันทึกเวลาติดตาม')).toBeTruthy();
  });

  it('cancelling writes nothing and leaves the row pressable', () => {
    openCard(roomWith({}));
    fireEvent.click(screen.getByTestId('follow-stamp-notice_deposit_at'));
    fireEvent.click(screen.getByText('ยกเลิก'));
    expect(setFollowStamp).not.toHaveBeenCalled();
    expect(screen.getByTestId('follow-stamp-notice_deposit_at')).toBeTruthy();
  });

  it('confirming sends THIS member and THIS kind', async () => {
    openCard(roomWith({}));
    fireEvent.click(screen.getByTestId('follow-stamp-notice_deposit_at'));
    fireEvent.click(screen.getByText('บันทึกเวลา'));
    await waitFor(() => expect(setFollowStamp).toHaveBeenCalledTimes(1));
    expect(setFollowStamp).toHaveBeenCalledWith(MEMBER, 'deposit');
  });

  it('the withdraw row sends the withdraw kind, not deposit', async () => {
    openCard(roomWith({}));
    fireEvent.click(screen.getByTestId('follow-stamp-notice_withdraw_at'));
    fireEvent.click(screen.getByText('บันทึกเวลา'));
    await waitFor(() => expect(setFollowStamp).toHaveBeenCalledTimes(1));
    expect(setFollowStamp).toHaveBeenCalledWith(MEMBER, 'withdraw');
  });
});

describe('after the server answers', () => {
  it('the row shows the recorded time and stops being a button', async () => {
    openCard(roomWith({}));
    fireEvent.click(screen.getByTestId('follow-stamp-notice_deposit_at'));
    fireEvent.click(screen.getByText('บันทึกเวลา'));
    await waitFor(() =>
      expect(screen.queryByTestId('follow-stamp-notice_deposit_at')).toBeNull(),
    );
    // 2026-08-29T16:30Z rendered in Bangkok is 29/08/2026 23:30
    expect(screen.getByText(/29\/08\/2026/)).toBeTruthy();
  });

  it('a failure leaves the row untouched and says so', async () => {
    setFollowStamp.mockRejectedValueOnce(new Error('This follow-up time is already recorded'));
    openCard(roomWith({}));
    fireEvent.click(screen.getByTestId('follow-stamp-notice_deposit_at'));
    fireEvent.click(screen.getByText('บันทึกเวลา'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('already recorded');
    expect(screen.getByTestId('follow-stamp-notice_deposit_at')).toBeTruthy();
  });

  it('an answer with no time claims nothing on screen', async () => {
    setFollowStamp.mockResolvedValueOnce({ success: true });
    openCard(roomWith({}));
    fireEvent.click(screen.getByTestId('follow-stamp-notice_deposit_at'));
    fireEvent.click(screen.getByText('บันทึกเวลา'));
    await waitFor(() => expect(setFollowStamp).toHaveBeenCalled());
    expect(screen.getByTestId('follow-stamp-notice_deposit_at')).toBeTruthy();
  });
});
