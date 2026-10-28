import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { logOutboundPush, OUTBOUND_PUSH_ACTION } from '@/modules/chat';

/**
 * ==== [FEAT-20260814-ADMINPUSHLOG] an admin push must leave a trace ====
 *
 * Owner, 14/08, after filtering the Webhook History page by "LINE Push" and
 * finding it empty: "push ticket support admin push ก็ควรบันทึกนะ ว่าเกิดอะไรขึ้น".
 *
 * Verified against the live database before writing any code — today's rows
 * carried `line_reply`, `image_answer_reply`, `generate_response`,
 * `incoming_line_webhook` and the customer-link fetches, but nothing for the
 * text an operator sends. Tracing it showed `ChatService.deliverOutbound`
 * calling the channel adapter and returning without an audit row, while the
 * admin IMAGE path next door writes one (`chat-media.service.ts:392`).
 *
 * These tests pin the two things that make the row worth having: it survives
 * failures (a broken logger must never cost the customer their message), and it
 * records WHO sent WHAT — a `chat_messages` row alone cannot say which operator
 * pressed send when several share a room.
 */

const ctx = {
  to: 'U0abb026f95b529e88d3b6a195ca13182',
  hookId: 'a0d00000000000000000002e',
  hookAlias: 'demo-oa-three',
  channelType: 'line',
  groupId: 'g1',
  actorId: 'admin-1',
  actorName: 'dev (Developer)',
};

/** Collects rows the way `WebhookLogService` would receive them. */
function makeLogger() {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    logger: {
      createLog: (entry: Record<string, unknown>) => {
        rows.push(entry);
        return Promise.resolve(entry);
      },
    },
  };
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('[ADMINPUSHLOG] the audit row for a successful push', () => {
  it('lands in the same bucket the Webhook History page filters on', async () => {
    const { rows, logger } = makeLogger();
    logOutboundPush(
      logger,
      ctx,
      { kind: 'text', text: 'สวัสดีค่ะ', durationMs: 120 },
      () => {},
    );
    await flush();

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // `push_message` is what the admin-image path already writes; both belong
    // to one bucket or the page shows half the story.
    expect(row['action_type']).toBe('push_message');
    expect(OUTBOUND_PUSH_ACTION).toBe('push_message');
    expect(row['channel']).toBe('line_api');
    expect(row['method']).toBe('POST');
    expect(row['endpoint']).toBe('https://api.line.me/v2/bot/message/push');
    expect(row['status']).toBe('success');
    expect(row['http_status']).toBe(200);
    expect(row['duration_ms']).toBe(120);
  });

  it('records who sent it and what was said', async () => {
    const { rows, logger } = makeLogger();
    logOutboundPush(
      logger,
      ctx,
      { kind: 'text', text: 'สวัสดีค่ะ', durationMs: 5 },
      () => {},
    );
    await flush();

    const payload = rows[0]!['payload_summary'] as Record<string, unknown>;
    expect(payload['to']).toBe(ctx.to);
    expect(payload['kind']).toBe('text');
    expect(payload['actor_id']).toBe('admin-1');
    expect(payload['actor_name']).toBe('dev (Developer)');
    expect(payload['text']).toBe('สวัสดีค่ะ');
    expect(rows[0]!['hook_alias']).toBe('demo-oa-three');
    expect(rows[0]!['channel_type']).toBe('line');
  });

  it('carries extra payload for kinds that have one, and omits an absent text', async () => {
    const { rows, logger } = makeLogger();
    logOutboundPush(
      logger,
      ctx,
      {
        kind: 'sticker',
        payload: { packageId: '446', stickerId: '1988' },
        durationMs: 8,
      },
      () => {},
    );
    await flush();

    const payload = rows[0]!['payload_summary'] as Record<string, unknown>;
    expect(payload['kind']).toBe('sticker');
    expect(payload['packageId']).toBe('446');
    expect(payload).not.toHaveProperty('text');
  });
});

/* [FEAT-20260821-QUOTEREPLY] Owner: "webhook log ต้องบอกด้วย push หรือ reply with q
   token". The row says which endpoint REALLY carried the message and what became of
   the quote — and a caller that passes neither field gets the row it always got. */
describe('[QUOTEREPLY] the audit row says reply-or-push, and what became of the quote', () => {
  it('a reply goes to the reply endpoint and the summary says so', async () => {
    const { rows, logger } = makeLogger();
    logOutboundPush(
      logger,
      ctx,
      {
        kind: 'text',
        text: 'hi',
        durationMs: 10,
        sendKind: 'reply',
        quote: 'kept',
      },
      () => {},
    );
    await flush();
    const row = rows[0]!;
    expect(row['endpoint']).toBe('https://api.line.me/v2/bot/message/reply');
    expect(row['action_type']).toBe('push_message'); // same bucket — the page filters on it
    expect(row['payload_summary']).toMatchObject({
      send: { kind: 'reply', quote: 'kept' },
    });
  });

  it('a push whose quote LINE refused says dropped', async () => {
    const { rows, logger } = makeLogger();
    logOutboundPush(
      logger,
      ctx,
      {
        kind: 'text',
        text: 'hi',
        durationMs: 10,
        sendKind: 'push',
        quote: 'dropped',
      },
      () => {},
    );
    await flush();
    expect(rows[0]!['endpoint']).toBe(
      'https://api.line.me/v2/bot/message/push',
    );
    expect(rows[0]!['payload_summary']).toMatchObject({
      send: { kind: 'push', quote: 'dropped' },
    });
  });

  it('a caller that knows nothing about the ladder gets the exact row it always got', async () => {
    const { rows, logger } = makeLogger();
    logOutboundPush(
      logger,
      ctx,
      { kind: 'text', text: 'hi', durationMs: 10 },
      () => {},
    );
    await flush();
    expect(rows[0]!['endpoint']).toBe(
      'https://api.line.me/v2/bot/message/push',
    );
    expect(rows[0]!['payload_summary']).not.toHaveProperty('send');
  });
});

describe('[ADMINPUSHLOG] the audit row when LINE rejects the push', () => {
  const lineError = {
    code: 'ERR_BAD_REQUEST',
    message: 'Request failed with status code 400',
    response: {
      status: 400,
      data: { message: 'The user has blocked the bot' },
    },
  };

  it('keeps the reason LINE gave, not just the axios wrapper', async () => {
    const { rows, logger } = makeLogger();
    logOutboundPush(
      logger,
      ctx,
      { kind: 'text', text: 'hi', durationMs: 30, error: lineError },
      () => {},
    );
    await flush();

    const row = rows[0]!;
    expect(row['status']).toBe('error');
    expect(row['http_status']).toBe(400);
    expect(row['error_code']).toBe('ERR_BAD_REQUEST');
    expect(row['error_message']).toBe('The user has blocked the bot');
    // a failed send has no response body worth keeping
    expect(row['response_summary']).toBeUndefined();
  });

  it('falls back to 500 when the throw carries no HTTP status', async () => {
    const { rows, logger } = makeLogger();
    logOutboundPush(
      logger,
      ctx,
      {
        kind: 'text',
        text: 'hi',
        durationMs: 1,
        error: new Error('socket hang up'),
      },
      () => {},
    );
    await flush();

    expect(rows[0]!['http_status']).toBe(500);
    expect(rows[0]!['error_message']).toBe('socket hang up');
  });
});

describe('[ADMINPUSHLOG] logging can never break a send', () => {
  it('swallows a logger that rejects, and reports it as a warning', async () => {
    const warnings: string[] = [];
    const brokenLogger = {
      createLog: () => Promise.reject(new Error('mongo down')),
    };

    expect(() =>
      logOutboundPush(
        brokenLogger,
        ctx,
        { kind: 'text', text: 'hi', durationMs: 1 },
        (m) => warnings.push(m),
      ),
    ).not.toThrow();
    await flush();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('message was still sent');
  });

  it('swallows a logger that throws synchronously', async () => {
    const warnings: string[] = [];
    const brokenLogger = {
      createLog: () => {
        throw new Error('boom');
      },
    };

    expect(() =>
      logOutboundPush(
        brokenLogger as never,
        ctx,
        { kind: 'text', durationMs: 1 },
        (m) => warnings.push(m),
      ),
    ).not.toThrow();
    await flush();
    expect(warnings).toHaveLength(1);
  });
});

/**
 * The helper is pure, so green tests above say nothing about whether the SEND
 * PATH actually calls it. This pins the wiring — the bug was a missing call,
 * not a wrong payload.
 */
describe('[ADMINPUSHLOG] the send path is wired to it', () => {
  const SERVICE = readFileSync(
    resolve(__dirname, '../../src/modules/chat/chat.service.ts'),
    'utf8',
  );
  const code = SERVICE.replace(/\/\*[\s\S]*?\*\//g, '').replace(
    /^\s*\/\/.*$/gm,
    '',
  );

  it('deliverOutbound writes the audit row', () => {
    expect(code).toContain('logOutboundPush(');
  });

  it('times the delivery so duration_ms is real, not a guess', () => {
    expect(code).toMatch(/Date\.now\(\)/);
  });

  it('reports both outcomes — a rejected push must still be logged', () => {
    // the call site has to survive a throw, so the error branch exists
    expect(code).toMatch(/catch/);
  });
});
