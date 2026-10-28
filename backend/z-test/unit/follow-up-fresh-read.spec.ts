/* [FEAT-20260830-FOLLOWUPFRESH] reading a member's follow-up stamps live
 * ===========================================================================
 * Owner 30/08 asked whether the close-case dialog checks follow-up in realtime.
 * It did not: it read `selectedRoom`, loaded when the admin opened the room and
 * never refreshed. Between opening a room and pressing "ปิดเคส" the stamps can
 * move — the notice runtime writes them after a card goes out, a multicast
 * clears them, another admin presses the clock button on the panel. The dialog
 * then offers a choice about a stamp that is gone, the back end correctly does
 * nothing, and the admin walks away believing they acted.
 *
 * This file pins the READ side of the fix. The rule for "is this empty" must be
 * the SAME one the writer and the screen use, or the three can disagree about
 * what `n/a` means — which is the whole class of bug being closed here.
 */
import {
  readRegistrationPair,
  readStoredStamp,
  stampIsEmpty,
} from '@/modules/chat';

const member = (line: Record<string, unknown>) => ({
  _id: 'm1',
  config: { follow_up: { line } },
});

describe('the registration pair needs BOTH stamps', () => {
  it('both present ⇒ true', () => {
    expect(
      readRegistrationPair(
        member({ abandon_trigger_at: new Date(), request_reg_at: new Date() }),
      ),
    ).toBe(true);
  });

  it('only one ⇒ false, because the dialog would offer a choice the BE drops', () => {
    expect(
      readRegistrationPair(member({ abandon_trigger_at: new Date() })),
    ).toBe(false);
    expect(readRegistrationPair(member({ request_reg_at: new Date() }))).toBe(
      false,
    );
  });

  it('null and empty string do not count as carrying the stamp', () => {
    expect(
      readRegistrationPair(
        member({ abandon_trigger_at: null, request_reg_at: new Date() }),
      ),
    ).toBe(false);
    expect(
      readRegistrationPair(
        member({ abandon_trigger_at: '', request_reg_at: new Date() }),
      ),
    ).toBe(false);
  });

  it('a member with no config at all is simply false, never a crash', () => {
    [
      null,
      undefined,
      {},
      { config: {} },
      { config: { follow_up: {} } },
    ].forEach((m) => expect(readRegistrationPair(m)).toBe(false));
  });

  it('🔴 it reads the pair the BE actually decides on', () => {
    /* `patch-after-close.helper.ts:145` checks `abandon_trigger_at` and
       `request_reg_at`. Reading a different pair here would show a section the
       BE then refuses to act on — silently, which is the original bug. */
    expect(
      readRegistrationPair(
        member({
          notice_deposit_at: new Date(),
          notice_withdraw_at: new Date(),
        }),
      ),
    ).toBe(false);
  });
});

describe('the deposit/withdraw stamps use the shared emptiness rule', () => {
  it('a stored date reads back', () => {
    const at = new Date('2026-08-29T17:18:03.439Z');
    expect(readStoredStamp(member({ notice_deposit_at: at }), 'deposit')).toBe(
      at,
    );
    expect(stampIsEmpty(member({ notice_deposit_at: at }), 'deposit')).toBe(
      false,
    );
  });

  it('missing / null / empty all read as no stamp', () => {
    [{}, { notice_deposit_at: null }, { notice_deposit_at: '' }].forEach(
      (l) => {
        expect(stampIsEmpty(member(l), 'deposit')).toBe(true);
        expect(readStoredStamp(member(l), 'deposit')).toBeNull();
      },
    );
  });

  it('the two kinds stay independent', () => {
    const m = member({ notice_deposit_at: new Date() });
    expect(stampIsEmpty(m, 'deposit')).toBe(false);
    expect(stampIsEmpty(m, 'withdraw')).toBe(true);
  });
});

describe('the route is wired and reachable', () => {
  const ctl = require('fs').readFileSync(
    require('path').resolve(
      process.cwd(),
      'src/modules/chat/members.controller.ts',
    ),
    'utf8',
  ) as string;

  it('it is a GET, so opening the dialog cannot change anything', () => {
    expect(ctl).toMatch(
      /@Get\(\[\s*'api\/line-users\/:id\/follow-up-stamp',\s*'api\/channel-users\/:id\/follow-up-stamp',\s*\]\)/,
    );
  });

  it('it carries the same permission as its siblings', () => {
    const at = ctl.indexOf('public async getFollowUpStamps');
    const before = ctl.slice(Math.max(0, at - 400), at);
    expect(before).toContain("@RequirePermissions('ticket.manage')");
  });

  it('the WRITE path on the same name is still a PATCH', () => {
    // a GET and a PATCH share the path; losing the PATCH would break stamping
    expect(ctl).toMatch(
      /@Patch\(\[\s*'api\/line-users\/:id\/follow-up-stamp',/,
    );
  });
});
