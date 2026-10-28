/**
 * [FIX-20260831-BCASTPROFILEGATE] the save-time gate: a plain job may not
 * carry a per-person card.
 * ===========================================================================
 * The failure this closes is SILENT and reaches customers: plain + a card
 * reading `{{profile.*}}` renders once per OA, the per-person tags are
 * pre-filled 'N/A' (so they never even reach `unknownTags`), and every
 * recipient gets a card of N/A values with no error anywhere.
 *
 * `checkProfileMatch` existed for exactly this and had ZERO callers — these
 * cases pin the wiring, not the pure function (broadcast-send-contracts.spec
 * already owns that).
 *
 * Harness mirrors broadcast-card-type.spec.ts: the service built positionally
 * with plain-object fakes. The flex model rides in LAST and OPTIONAL — most
 * cases omit it, and one case proves the gate degrades (not crashes) without it.
 */
import { BadRequestException } from '@nestjs/common';

import type { AuthenticatedUser } from '@/common';
import { BroadcastsService } from '@/modules/content';

const HOOK_ID = 'a0d000000000000000000029';
const FLEX_ID = 'a0d000000000000000000040';
const ID = 'a0d000000000000000000012';
const USER = {
  userId: 'admin-1',
  roleName: 'superadmin',
} as unknown as AuthenticatedUser;

const PROFILE_CARD = {
  type: 'bubble',
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [{ type: 'text', text: 'ทำแล้ว {{profile.act_done_fashion}}' }],
  },
};
const PLAIN_CARD = {
  type: 'bubble',
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [{ type: 'text', text: 'เข้าเว็บ {{hook_domain}}' }],
  },
};

const BASE = {
  name: 'promo',
  description: 'ทดสอบ',
  hook_ids: [HOOK_ID],
  send_kind: 'multicast' as const,
};

function makeService(
  opts: {
    stored?: Record<string, unknown>;
    /** the library body `findById(flex_id)` answers — omit = no flex model at all */
    libraryCard?: unknown;
  } = {},
) {
  const created: Record<string, unknown>[] = [];
  const row = {
    _id: ID,
    name: 'promo',
    status: 'draft',
    ...(opts.stored ?? {}),
  };
  const broadcastModel = {
    create: jest.fn((doc: Record<string, unknown>) => {
      created.push(doc);
      return Promise.resolve({ ...row, ...doc });
    }),
    findOne: jest.fn(() => ({ lean: () => Promise.resolve(row) })),
    findByIdAndUpdate: jest.fn((_id: unknown, u: Record<string, unknown>) => ({
      lean: () => Promise.resolve({ ...row, ...u }),
    })),
  };
  const hookFake = {
    find: jest.fn(() => ({
      select: jest.fn().mockResolvedValue([{ _id: HOOK_ID }]),
    })),
  } as never;
  const groupFake = {
    findById: jest.fn(() => ({ lean: () => Promise.resolve(null) })),
  } as never;
  const wlogFake = { create: jest.fn() } as never;
  const cryptoFake = { safeDecrypt: jest.fn((v: unknown) => v) } as never;
  const auditFake = {
    createAuditLog: jest.fn().mockResolvedValue({}),
  } as never;
  /* two explicit constructions, not a spread — TS checks the arity of a spread
     against the REQUIRED parameter count and refuses a maybe-short tuple */
  const service =
    opts.libraryCard === undefined
      ? new BroadcastsService(
          broadcastModel as never,
          hookFake,
          groupFake,
          wlogFake,
          cryptoFake,
          auditFake,
        )
      : new BroadcastsService(
          broadcastModel as never,
          hookFake,
          groupFake,
          wlogFake,
          cryptoFake,
          auditFake,
          undefined, // newSendPort — not under test here
          {
            findById: jest.fn(() => ({
              select: () => ({
                lean: () => ({
                  exec: () =>
                    Promise.resolve({ content_json: opts.libraryCard }),
                }),
              }),
            })),
          } as never,
        );
  return { service, created };
}

describe('create — the tick must agree with what the card reads', () => {
  it('⭐ THE GATE: plain + inline {{profile.*}} card → 400 naming the tag', async () => {
    const { service } = makeService();
    await expect(
      service.createBroadcast(USER, {
        ...BASE,
        message: { type: 'flex', flex_json: PROFILE_CARD },
      } as never),
    ).rejects.toThrow(/profile\.act_done_fashion/);
  });

  it('the same card with card_type personal saves', async () => {
    const { service, created } = makeService();
    await service.createBroadcast(USER, {
      ...BASE,
      card_type: 'personal',
      message: { type: 'flex', flex_json: PROFILE_CARD },
    } as never);
    expect(created).toHaveLength(1);
  });

  it('plain + a card of OA-wide tags only saves — hook_* is not per-person', async () => {
    const { service, created } = makeService();
    await service.createBroadcast(USER, {
      ...BASE,
      message: { type: 'flex', flex_json: PLAIN_CARD },
    } as never);
    expect(created).toHaveLength(1);
  });

  it('a TEXT message with {{member.*}} is caught too — tags are not a flex-only problem', async () => {
    const { service } = makeService();
    await expect(
      service.createBroadcast(USER, {
        ...BASE,
        message: { type: 'text', text: 'สวัสดี {{member.display_name}}' },
      } as never),
    ).rejects.toThrow(/member\.display_name/);
  });

  it('⭐ a flex_id-only card is judged by its LIBRARY body, fetched at save', async () => {
    const { service } = makeService({ libraryCard: PROFILE_CARD });
    await expect(
      service.createBroadcast(USER, {
        ...BASE,
        message: { type: 'flex', flex_id: FLEX_ID },
      } as never),
    ).rejects.toThrow(/profile\.act_done_fashion/);
  });

  it('without the flex model the gate degrades to what is inline — never crashes', async () => {
    // six-arg construction, exactly how every older spec builds the service
    const { service, created } = makeService();
    await service.createBroadcast(USER, {
      ...BASE,
      message: { type: 'flex', flex_id: FLEX_ID },
    } as never);
    expect(created).toHaveLength(1);
  });

  it('personal + a tag-free card still saves — wasteful is a log, never a 400', async () => {
    /* broadcast-card-type.spec pins "create stores a real choice" with exactly
       this pair; throwing here would break that contract and block a legal
       (just expensive) campaign. */
    const { service, created } = makeService();
    await service.createBroadcast(USER, {
      ...BASE,
      card_type: 'personal',
      message: { type: 'flex', flex_json: PLAIN_CARD },
    } as never);
    expect(created).toHaveLength(1);
  });
});

describe('update — history stays editable, the mismatch does not', () => {
  const MISMATCHED = {
    send_kind: 'multicast',
    message: { type: 'flex', flex_json: PROFILE_CARD },
    // no card_type key — stored as plain, the pre-gate shape
  };

  it('⭐ กันพัง: a rename-only update of an old mismatched job passes', async () => {
    const { service } = makeService({ stored: MISMATCHED });
    await expect(
      service.updateBroadcast(USER, ID, { name: 'promo renamed' }),
    ).resolves.toBeDefined();
  });

  it('touching the MESSAGE re-judges: swapping in a profile card on plain → 400', async () => {
    const { service } = makeService({ stored: { send_kind: 'multicast' } });
    await expect(
      service.updateBroadcast(USER, ID, {
        message: { type: 'flex', flex_json: PROFILE_CARD },
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('touching the TICK re-judges: clearing personal off a profile card → 400', async () => {
    const { service } = makeService({
      stored: { ...MISMATCHED, card_type: 'personal' },
    });
    await expect(
      service.updateBroadcast(USER, ID, { card_type: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('and fixing the pair the right way round passes', async () => {
    const { service } = makeService({ stored: MISMATCHED });
    await expect(
      service.updateBroadcast(USER, ID, { card_type: 'personal' }),
    ).resolves.toBeDefined();
  });

  it('a stored row with NO message at all never trips the gate', async () => {
    /* two existing update fixtures store rows without a message — the gate must
       read that as "no tags", not crash (collectTags(undefined) → []) */
    const { service } = makeService({ stored: { send_kind: 'multicast' } });
    await expect(
      service.updateBroadcast(USER, ID, { card_type: 'personal' }),
    ).resolves.toBeDefined();
  });
});
