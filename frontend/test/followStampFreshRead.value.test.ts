/**
 * [FEAT-20260830-FOLLOWUPFRESH] reading the follow-up stamps live.
 *
 * 🔴 Owner 30/08 asked whether the close-case dialog checks follow-up in
 *    realtime. It did not — it read `selectedRoom`, loaded when the admin opened
 *    the room and never refreshed. Between opening a room and pressing "ปิดเคส"
 *    the stamps can move: the notice runtime writes them after a card goes out,
 *    a multicast clears them, another admin presses the clock button. The dialog
 *    then offered a choice about a stamp that was gone, the BE correctly did
 *    nothing, and the admin walked away believing they had acted.
 *
 * This file covers the two pure pieces: the request the reader makes, and the
 * translation from the snapshot back into the shape the dialog already
 * understands. Wiring it into the dialog is a separate change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  readFollowStamps,
  snapshotToRoomShape,
  type FollowStampSnapshot,
} from '../services/chat/followStampService';
import { closeCaseTopicsFor } from '../components/member/follow-up/CloseCaseSections';

const MEMBER = 'a0d00000000000000000001e';
const D = '2026-08-29T17:18:03.439Z';

const snap = (over: Partial<FollowStampSnapshot> = {}): FollowStampSnapshot => ({
  member_id: MEMBER,
  line_user_id: 'Ufire29aug',
  deposit: null,
  withdraw: null,
  registration_pair: false,
  ...over,
});

describe('the request it makes', () => {
  afterEach(() => vi.unstubAllGlobals());

  /* typed as the real `fetch` so `mock.calls[0]` is `[input, init]` rather than
     the empty tuple an untyped `vi.fn()` infers — tsc caught that, not the run */
  const stub = (payload: unknown, status = 200) => {
    const spy = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(payload), { status }),
    );
    vi.stubGlobal('fetch', spy);
    return spy;
  };

  it('is a GET — opening the dialog must not change anything', async () => {
    const spy = stub({ success: true, data: snap() });
    await readFollowStamps(MEMBER);
    expect(spy).toHaveBeenCalledTimes(1);
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('GET');
  });

  it('asks about THIS member, on the route the BE registered', async () => {
    const spy = stub({ success: true, data: snap() });
    await readFollowStamps(MEMBER);
    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain(`/api/line-users/${MEMBER}/follow-up-stamp`);
  });

  it('returns the data half, not the envelope', async () => {
    stub({ success: true, data: snap({ deposit: D }) });
    const out = await readFollowStamps(MEMBER);
    expect(out.deposit).toBe(D);
    expect((out as unknown as { success?: boolean }).success).toBeUndefined();
  });

  it('🔴 throws on a failed read instead of pretending it is fresh', async () => {
    // falling back to stale data here would silently restore the original bug
    stub({ message: 'nope' }, 500);
    await expect(readFollowStamps(MEMBER)).rejects.toBeTruthy();
  });
});

describe('the snapshot feeds the SAME rule the dialog already uses', () => {
  /** targetStatus 2 = closing; that is the only case the dialog asks about. */
  const topicsOf = (s: FollowStampSnapshot) =>
    closeCaseTopicsFor(snapshotToRoomShape(s) as never, 2);

  it('no stamps ⇒ no sections ⇒ closing stays a plain confirm', () => {
    expect(topicsOf(snap())).toEqual([]);
  });

  it('a deposit stamp ⇒ the deposit section only', () => {
    expect(topicsOf(snap({ deposit: D }))).toEqual(['deposit']);
  });

  it('a withdraw stamp ⇒ the withdraw section only', () => {
    expect(topicsOf(snap({ withdraw: D }))).toEqual(['withdraw']);
  });

  it('both ⇒ both, in the order the dialog renders them', () => {
    expect(topicsOf(snap({ deposit: D, withdraw: D }))).toEqual([
      'deposit',
      'withdraw',
    ]);
  });

  it('the registration pair ⇒ the registration section', () => {
    expect(topicsOf(snap({ registration_pair: true }))).toContain('registration');
  });

  it('🔴 registration_pair false ⇒ NO registration section', () => {
    /* the BE drops a "stop" from a member without both stamps, so showing it
       would offer a choice that silently does nothing — the original bug */
    expect(topicsOf(snap({ registration_pair: false }))).not.toContain(
      'registration',
    );
  });

  it('everything at once ⇒ all three sections', () => {
    const t = topicsOf(snap({ deposit: D, withdraw: D, registration_pair: true }));
    expect(t).toEqual(['registration', 'deposit', 'withdraw']);
  });
});

describe('the translated shape', () => {
  it('omits a key entirely when there is no stamp — never writes null', () => {
    const line = snapshotToRoomShape(snap()).user_data.config.follow_up.line;
    expect(Object.keys(line)).toEqual([]);
  });

  it('carries the member id, so the caller can write back to the right member', () => {
    expect(snapshotToRoomShape(snap()).user_data._id).toBe(MEMBER);
  });

  it('keeps the real stamp values, not placeholders', () => {
    const line = snapshotToRoomShape(snap({ deposit: D })).user_data.config
      .follow_up.line;
    expect(line.notice_deposit_at).toBe(D);
  });

  it('writes BOTH registration stamps together or neither', () => {
    const on = snapshotToRoomShape(snap({ registration_pair: true })).user_data
      .config.follow_up.line;
    expect(on.abandon_trigger_at).toBeTruthy();
    expect(on.request_reg_at).toBeTruthy();
    const off = snapshotToRoomShape(snap({ registration_pair: false })).user_data
      .config.follow_up.line;
    expect(off.abandon_trigger_at).toBeUndefined();
    expect(off.request_reg_at).toBeUndefined();
  });
});
