import {
  ensureRoomOnEvent,
  shouldBootstrapRoom,
  LINE_DUMMY_USER,
  type EnsureRoomArgs,
} from '@/modules/webhook/room-bootstrap/ensure-room-on-event';

/**
 * [TEST-20260813-ROOMBOOT-UNIT] the eager-room gate + wrapper, in isolation.
 * The flow-level behaviour lives in room-bootstrap-before-pack.spec.ts; this
 * file pins the pure decisions and the two safety properties that the pack
 * cannot see from outside: the throw-swallow and the exact args forwarded.
 */

const okArgs = (over: Partial<EnsureRoomArgs> = {}): EnsureRoomArgs => ({
  event: { replyToken: 'rt-normal-1', source: { userId: 'U1' } },
  userId: 'Uuser000000000000000000000000001',
  hookId: 'a0d000000000000000000014',
  channelId: 'chan-1',
  channelType: 'line',
  ...over,
});

describe('[ROOMBOOT] shouldBootstrapRoom — the gate', () => {
  it('passes a normal customer event', () => {
    expect(shouldBootstrapRoom(okArgs())).toBe(true);
  });

  it('rejects a missing / empty userId', () => {
    expect(shouldBootstrapRoom(okArgs({ userId: undefined }))).toBe(false);
    expect(shouldBootstrapRoom(okArgs({ userId: '' }))).toBe(false);
    expect(shouldBootstrapRoom(okArgs({ userId: '   ' }))).toBe(false);
  });

  it('rejects a missing hookId — a null-hook room is an invisible orphan', () => {
    expect(shouldBootstrapRoom(okArgs({ hookId: undefined }))).toBe(false);
    expect(shouldBootstrapRoom(okArgs({ hookId: null }))).toBe(false);
    expect(shouldBootstrapRoom(okArgs({ hookId: '' }))).toBe(false);
  });

  it('rejects the community dummy user (hand-crafted test payloads)', () => {
    expect(shouldBootstrapRoom(okArgs({ userId: LINE_DUMMY_USER }))).toBe(
      false,
    );
  });

  it('rejects all-zero / all-f dummy reply tokens', () => {
    expect(
      shouldBootstrapRoom(
        okArgs({ event: { replyToken: '0'.repeat(32), source: {} } }),
      ),
    ).toBe(false);
    expect(
      shouldBootstrapRoom(
        okArgs({ event: { replyToken: 'f'.repeat(32), source: {} } }),
      ),
    ).toBe(false);
  });

  it('does NOT reject a short real-looking token that happens to be zeros-ish', () => {
    // length < 32 never matches the dummy pattern — a real token is long.
    expect(
      shouldBootstrapRoom(okArgs({ event: { replyToken: '000', source: {} } })),
    ).toBe(true);
  });

  it("rejects LINE module handover `mode: 'standby'`", () => {
    expect(
      shouldBootstrapRoom(
        okArgs({ event: { mode: 'standby', replyToken: 'rt-x', source: {} } }),
      ),
    ).toBe(false);
  });
});

describe('[ROOMBOOT] ensureRoomOnEvent — the wrapper', () => {
  it('forwards the EXACT args — hookId and channelType explicit, {} profile', async () => {
    const calls: unknown[][] = [];
    await ensureRoomOnEvent(
      {
        getOrCreateRoom: (...a) => {
          calls.push(a);
          return Promise.resolve({ _id: 'r1' });
        },
        logError: () => undefined,
      },
      okArgs(),
    );
    expect(calls).toEqual([
      [
        'Uuser000000000000000000000000001',
        {},
        'chan-1',
        'a0d000000000000000000014',
        'line',
      ],
    ]);
  });

  it("null channelId and missing channelType degrade to (null, 'line') — never undefined", async () => {
    const calls: unknown[][] = [];
    await ensureRoomOnEvent(
      {
        getOrCreateRoom: (...a) => {
          calls.push(a);
          return Promise.resolve({ _id: 'r1' });
        },
        logError: () => undefined,
      },
      okArgs({ channelId: null, channelType: undefined }),
    );
    expect(calls[0]?.[2]).toBeNull();
    expect(calls[0]?.[4]).toBe('line');
  });

  it('swallows a thrown getOrCreateRoom and logs — the pipeline must never die here', async () => {
    const logged: string[] = [];
    await expect(
      ensureRoomOnEvent(
        {
          getOrCreateRoom: () => Promise.reject(new Error('E11000 dup key')),
          logError: (m) => {
            logged.push(m);
          },
        },
        okArgs(),
      ),
    ).resolves.toBeUndefined();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('[EAGERROOM]');
    expect(logged[0]).toContain('E11000');
  });

  it('gated-out events never touch the DB at all', async () => {
    const calls: unknown[][] = [];
    await ensureRoomOnEvent(
      {
        getOrCreateRoom: (...a) => {
          calls.push(a);
          return Promise.resolve({ _id: 'r1' });
        },
        logError: () => undefined,
      },
      okArgs({ userId: LINE_DUMMY_USER }),
    );
    expect(calls).toEqual([]);
  });
});
