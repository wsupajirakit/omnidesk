/**
 * [FEAT-20260824-STRIKESESSION] The plug — `StrikeService.recordFromVerdict`.
 *
 * This is the whole webhook integration, and it lives in the strike module
 * rather than in `webhook.service.ts` for two reasons the owner asked for:
 * the feature must be ready to plug in but NOT plugged in
 * (*"เทสแล้วเอาออกจากการเสียบจริงด้วย"*), and plugging it in later must be trivial
 * (*"ถอดเข้าถอดออกต้องง่ายที่สุด"*). Keeping the verdict→row translation here means
 * the webhook edit is one line per call site, and means this logic is under test
 * TODAY instead of on the day somebody wires it.
 *
 * The wiring itself is `docs/strike-plug-in.patch`; `strike-plug-patch.spec.ts`
 * proves it still applies and still reverts byte-identically.
 */
import { StrikeService } from '@/modules/strike';
import { fakeModel } from '../lib/strike-fakes';

const HOOK = 'a0d00000000000000000000d';
const USER = 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';
const LIMITED = { strikeAdded: true, level: 3, limit: 2, windowSeconds: 90 };

function harness() {
  const sessions = fakeModel('seq', 'line_user_id');
  const events = fakeModel('occurred_at');
  const service = new StrikeService(sessions as never, events as never, {
    enabled: true,
  });
  return { service, sessions, events };
}

describe('the plug', () => {
  it('records exactly what the limiter decided, unchanged', async () => {
    const { service, events } = harness();

    await service.recordFromVerdict(LIMITED, USER, HOOK, 'sticker');

    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({
      line_user_id: USER,
      level: 3,
      limit: 2,
      window_seconds: 90,
      message_type: 'sticker',
    });
  });

  it('stays silent for a message that was not blocked', async () => {
    const { service, events } = harness();
    await service.recordFromVerdict(
      { strikeAdded: false, level: 1, limit: 3, windowSeconds: 30 },
      USER,
      HOOK,
    );
    expect(events.rows).toHaveLength(0);
  });

  it('stays silent when the limiter returned nothing at all', async () => {
    const { service, events } = harness();
    await service.recordFromVerdict(null, USER, HOOK);
    await service.recordFromVerdict(undefined, USER, HOOK);
    expect(events.rows).toHaveLength(0);
  });

  it('skips rather than guesses when the customer or the OA is unknown', async () => {
    const { service, events } = harness();
    await service.recordFromVerdict(LIMITED, undefined, HOOK);
    await service.recordFromVerdict(LIMITED, USER, undefined);
    expect(events.rows).toHaveLength(0);
  });

  /**
   * An earlier draft defaulted a missing limit/window to 0, which the event
   * schema rejects (`min: 1`) — the log was refused while the counter had already
   * moved. Dropping the strike is the honest answer to a verdict that cannot be
   * described; inventing a zero is not.
   */
  it('drops a verdict with no usable limit instead of inventing one', async () => {
    const { service, sessions, events } = harness();
    await service.recordFromVerdict(
      { strikeAdded: true, level: 2, limit: 0, windowSeconds: 60 },
      USER,
      HOOK,
    );
    await service.recordFromVerdict(
      { strikeAdded: true, level: 2, limit: 3 },
      USER,
      HOOK,
    );
    expect(events.rows).toHaveLength(0);
    expect(sessions.rows).toHaveLength(0);
  });

  /**
   * ⚠️ THE ONE THAT PROTECTS THE WHOLE SERVICE. At the call site this is fired
   * with `void`, and a rejected promise nobody catches is an unhandled rejection
   * — which Node terminates the process for. A data-collection feature nobody has
   * switched on must never be able to take the webhook down with it.
   */
  it('never rejects, even when the store is broken', async () => {
    const exploding = {
      findOne: () => {
        throw new Error('mongo is on fire');
      },
    };
    const service = new StrikeService(
      exploding as never,
      fakeModel('occurred_at') as never,
      { enabled: true },
    );

    await expect(
      service.recordFromVerdict(LIMITED, USER, HOOK, 'text'),
    ).resolves.toBeUndefined();
  });
});
