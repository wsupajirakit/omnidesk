/**
 * [OBS-20260824-WHINFLIGHT] The webhook lane counts its background work.
 *
 * WHY THIS SPEC EXISTS: the controller answers 200 to LINE and then fires
 * `processWebhook` with no counter, no queue and no backpressure. Choosing a
 * ceiling needs a number nobody has, so this stage measures and refuses nothing.
 *
 * The cases below are almost all PINS. Only two assert the new counter; the
 * rest exist because "measure without changing anything" is a claim, and the
 * ways it could quietly stop being true are specific: the 200 could start
 * waiting on the work, an error could stop being logged with the string
 * runbooks grep for, or a rejected task could fail to decrement and strand the
 * counter high — which would make every later reading a lie.
 */
import type { Response } from 'express';

import { WebhookController } from '@/modules/webhook';

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (e: Error) => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness() {
  const sent: number[] = [];
  const calls: unknown[][] = [];
  const queue: Deferred[] = [];
  /* Order matters more than counts here: LINE retries a slow response, so the
     200 must be on the wire BEFORE any work starts. Recording what `sent` held
     at dispatch time is what makes a reordering fail rather than pass. */
  const sentWhenDispatched: number[][] = [];
  const service = {
    processWebhook: (...args: unknown[]) => {
      sentWhenDispatched.push([...sent]);
      calls.push(args);
      const d = deferred();
      queue.push(d);
      return d.promise;
    },
  };
  const controller = new WebhookController(service as never);
  const logged: string[] = [];
  // capture without silencing the rest of the suite's logger
  jest
    .spyOn(
      (controller as unknown as { logger: { error: (m: string) => void } })
        .logger,
      'error',
    )
    .mockImplementation((m: string) => {
      logged.push(m);
    });
  jest
    .spyOn(
      (controller as unknown as { logger: { log: (m: string) => void } })
        .logger,
      'log',
    )
    .mockImplementation(() => undefined);
  jest
    .spyOn(
      (controller as unknown as { logger: { warn: (m: string) => void } })
        .logger,
      'warn',
    )
    .mockImplementation(() => undefined);

  const res = {
    status: (code: number) => {
      sent.push(code);
      return { send: () => undefined };
    },
  } as unknown as Response;

  const req = () =>
    ({
      method: 'POST',
      path: '/webhook',
      originalUrl: '/webhook',
      ip: '1.2.3.4',
      protocol: 'https',
      get: () => 'example.invalid',
      headers: {},
      body: { events: [] },
      rawBody: Buffer.from('{}'),
    }) as never;

  return {
    controller,
    service,
    calls,
    queue,
    logged,
    sent,
    sentWhenDispatched,
    res,
    req,
  };
}

describe('[WHINFLIGHT] background webhook tasks are counted, and nothing else changes', () => {
  afterEach(() => jest.restoreAllMocks());

  it('(T1) the counter rises while work is in flight and returns to zero', async () => {
    const h = harness();
    expect(h.controller.backgroundInFlight).toBe(0);

    h.controller.handleWebhookDefault(h.req(), h.res);
    h.controller.handleWebhookDefault(h.req(), h.res);
    expect(h.controller.backgroundInFlight).toBe(2);

    h.queue[0]!.resolve();
    h.queue[1]!.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(h.controller.backgroundInFlight).toBe(0);
  });

  it('⭐ (T2) a task that REJECTS still decrements — otherwise every later reading is a lie', async () => {
    const h = harness();

    h.controller.handleWebhookDefault(h.req(), h.res);
    expect(h.controller.backgroundInFlight).toBe(1);

    h.queue[0]!.reject(new Error('boom'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(h.controller.backgroundInFlight).toBe(0);
  });

  it('(T3) the peak is remembered and never falls back', async () => {
    const h = harness();

    h.controller.handleWebhookDefault(h.req(), h.res);
    h.controller.handleWebhookDefault(h.req(), h.res);
    h.controller.handleWebhookDefault(h.req(), h.res);
    expect(h.controller.backgroundPeak).toBe(3);

    h.queue.forEach((d) => d.resolve());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(h.controller.backgroundInFlight).toBe(0);
    expect(h.controller.backgroundPeak).toBe(3);
  });

  it('⭐ (P1 PIN) the 200 still goes out BEFORE the work is dispatched', () => {
    // LINE retries on a slow or failed response. If the counter ever moved the
    // send below the dispatch, this is what would catch it.
    const h = harness();

    h.controller.handleWebhookDefault(h.req(), h.res);

    expect(h.sent).toEqual([200]);
    expect(h.calls).toHaveLength(1);
    // ⭐ the ordering assertion: the 200 was already sent when the work started.
    // Swapping the two lines in the controller turns this red; a count-only
    // assertion would not notice, because both happen in the same tick.
    expect(h.sentWhenDispatched[0]).toEqual([200]);
    // and the 200 does not wait for the task to settle
    expect(h.controller.backgroundInFlight).toBe(1);
  });

  it('⭐ (P2 PIN) a failing task is still logged with the exact string runbooks grep', async () => {
    const h = harness();

    h.controller.handleWebhookDefault(h.req(), h.res);
    h.queue[0]!.reject(new Error('upstream exploded'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(h.logged).toHaveLength(1);
    expect(h.logged[0]).toContain('[WEBHOOK BACKGROUND ERROR]');
    expect(h.logged[0]).toContain('upstream exploded');
  });

  it('⭐ (P3 PIN) NOTHING is refused — every dispatch reaches the service', () => {
    // This stage counts only. If shedding is ever added, this case is the one
    // that must be consciously changed, and the owner has to decide first:
    // the 200 is already sent, so LINE never redelivers a dropped event.
    const h = harness();

    for (let i = 0; i < 25; i += 1) {
      h.controller.handleWebhookDefault(h.req(), h.res);
    }

    expect(h.calls).toHaveLength(25);
    expect(h.controller.backgroundInFlight).toBe(25);
    expect(h.sent).toEqual(Array<number>(25).fill(200));
  });

  it('(P4 PIN) the aliased endpoint is counted the same way, and passes its alias through', () => {
    const h = harness();

    h.controller.handleWebhookAliased('omnideskdevoa', h.req(), h.res);

    expect(h.controller.backgroundInFlight).toBe(1);
    // processWebhook(body, hook, hookSource, alias, meta) — alias is the 4th
    expect(h.calls[0]![3]).toBe('omnideskdevoa');
  });
});
