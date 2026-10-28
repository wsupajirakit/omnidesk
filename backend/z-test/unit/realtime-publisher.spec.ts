import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Test } from '@nestjs/testing';

import { realtimeConfig } from '@/config/app.config';
import { RealtimePublisherService } from '@/infra/realtime/realtime-publisher.service';
import { RedisService } from '@/infra/redis/redis.service';

/**
 * The realtime contract is shared with a websocket gateway that this repo does
 * not own. These tests pin the wire format so a refactor here cannot silently
 * break every dashboard connected to it.
 */
describe('RealtimePublisherService', () => {
  const published: Array<{ channel: string; payload: string }> = [];

  const redisStub = {
    publish: jest.fn((channel: string, payload: string) => {
      published.push({ channel, payload });
      return Promise.resolve(true);
    }),
  };

  const build = async (wsEnv: string, prodWsChannel?: string) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RealtimePublisherService,
        { provide: RedisService, useValue: redisStub },
        { provide: realtimeConfig.KEY, useValue: { wsEnv, prodWsChannel } },
      ],
    }).compile();

    return moduleRef.get(RealtimePublisherService);
  };

  beforeEach(() => {
    published.length = 0;
    redisStub.publish.mockClear();
  });

  it('publishes the {type, data, ts} envelope the gateway expects', async () => {
    const service = await build('dev');

    await service.publish('ticket:created', {
      hook_id: 'hook-1',
      ticket_id: 't-9',
    });

    expect(published).toHaveLength(1);
    const envelope = JSON.parse(published[0]!.payload) as Record<
      string,
      unknown
    >;

    // Exactly these three keys — the gateway forwards the envelope verbatim.
    expect(Object.keys(envelope).sort()).toEqual(['data', 'ts', 'type']);
    expect(envelope['type']).toBe('ticket:created');
    expect(envelope['data']).toEqual({ hook_id: 'hook-1', ticket_id: 't-9' });
    expect(typeof envelope['ts']).toBe('number');
  });

  it('derives the channel from the environment so dev events never reach prod', async () => {
    const dev = await build('dev');
    expect(dev.getChannel()).toBe('ticket_events_dev');

    const prod = await build('prod');
    expect(prod.getChannel()).toBe('ticket_events_prod');

    const override = await build('prod', 'custom_prod_channel');
    expect(override.getChannel()).toBe('custom_prod_channel');
  });

  it('drops events without hook_id instead of fanning out to every tenant', async () => {
    const service = await build('dev');

    // Cast through unknown: the type system already forbids this shape, but a
    // plain-JS caller (or a JSON body) could still produce it at runtime.
    await service.publish('ticket:created', { ticket_id: 't-9' } as unknown as {
      hook_id: string;
    });

    expect(redisStub.publish).not.toHaveBeenCalled();
  });

  it('never throws when redis is unavailable — realtime is best effort', async () => {
    redisStub.publish.mockRejectedValueOnce(new Error('redis down'));
    const service = await build('dev');

    await expect(
      service.publish('message:new', { hook_id: 'hook-1' }),
    ).resolves.toBeUndefined();
  });
});

/**
 * [FIX-20260818-PUBSUBTRUTH · plan §7.3 = C5 = T3-6 of fix_plan_18_aug]
 *
 * WHY THIS EXISTS. The class docstring used to promise "Never carry PII", and it
 * was the only place in the repo making that claim — so a reader adding a field
 * concluded the channel was already clean and never asked the question. The
 * payload has carried a customer's words (`preview`) and display name
 * (`sender_name`) all along.
 *
 * These cases read the SOURCE off disk rather than exercising behaviour, because
 * nothing observable changed: the fix is the comment. `tsconfig.json` sets
 * `removeComments: true`, so the compiled output is byte-identical — the only
 * way a mutation can be caught is by reading the text that the mutation edits.
 * That makes this a documentation guard, and it is written as one on purpose:
 * it fails when the promise and the payload disagree again.
 */
describe('[PUBSUBTRUTH] the docstring must not out-promise the payload', () => {
  const SRC = join(
    process.cwd(),
    'src/infra/realtime/realtime-publisher.service.ts',
  );
  const source = readFileSync(SRC, 'utf8');

  it('⭐ the false promise is gone AS A RULE (a historical quote is fine)', () => {
    // Precision matters here. The docstring deliberately QUOTES the old wording
    // to explain what changed and why — deleting that context would cost the
    // next reader the whole lesson. What must never come back is the RULE form:
    // the numbered, bolded promise the file makes about itself. Asserting on the
    // bold marker separates "we used to claim X" from "we claim X".
    expect(source).not.toContain('**Never carry PII.**');
    expect(source).toContain('used to read'); // the history is kept on purpose
  });

  it('⭐ the docstring names what actually rides on the wire', () => {
    // Each name below is really published today — see chat-history.service.ts
    // (message:new) and the customer/ticket publishers. If a future edit removes
    // a field from the payload, this list is the reminder to update the prose.
    for (const carried of ['sender_name', 'preview', 'channel_user_id']) {
      expect(source).toContain(carried);
    }
  });

  it('states WHY it is acceptable (scope), not that the payload is empty', () => {
    expect(source).toContain('hook_id');
    expect(source.toLowerCase()).toContain('scope');
  });

  it('keeps the two rules the class actually guarantees', () => {
    // Rule 1 is true and load-bearing: publish() swallows and logs, never throws.
    expect(source).toContain('Never throw');
    expect(source).toContain('ScopedEventData');
  });
});
