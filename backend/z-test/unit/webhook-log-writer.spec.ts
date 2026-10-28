/**
 * ==== [FEAT-20260827-WLOGONEDOOR] the door forwards VERBATIM ====
 *
 * WHY THIS FILE EXISTS — it was added because a mutation escaped:
 * `webhook-log-door-parity.spec.ts` captures rows AT the door, so it proves the
 * eleven migrated call sites still build the same payload. It cannot see what
 * the door does NEXT. Teaching `persist` to strip `undefined` keys — the exact
 * normalisation `WebhookLogEmitter.write` performs one layer up — left all eight
 * parity cases green while changing what Mongo receives, because an absent key
 * takes the schema default while an explicit `undefined` does not.
 *
 * So this pins the OTHER end: what reaches `logModel.create`. Between the two
 * files the whole path is covered — call site → door → model.
 * ประตูต้องส่งต่อดิบ ๆ ห้ามแต่งค่าใด ๆ
 */
import { WebhookLogWriter } from '@/modules/system';

function makeWriter() {
  const created: unknown[] = [];
  const model = {
    create: jest.fn((row: unknown) => {
      created.push(row);
      return Promise.resolve({ _id: 'wl-1' });
    }),
  };
  return {
    writer: new WebhookLogWriter(model as never),
    created,
    model,
  };
}

describe('[FEAT-20260827-WLOGONEDOOR] WebhookLogWriter.persist', () => {
  it('(W1) 🔴 hands the row to the model with NOTHING added or removed', async () => {
    const { writer, created } = makeWriter();
    const row = {
      channel: 'customer_link',
      action_type: 'customer_link_link',
      http_status: 200,
      raw_request: { nested: { deep: true } },
    };

    await writer.persist(row);

    expect(created).toHaveLength(1);
    expect(created[0]).toStrictEqual(row);
    // the SAME object, not a copy — a copy would mean something reshaped it
    expect(created[0]).toBe(row);
  });

  it('(W2) 🔴 keeps keys whose value is `undefined` — they decide schema defaults', async () => {
    const { writer, created } = makeWriter();

    await writer.persist({
      channel: 'line_api',
      error_message: undefined,
      retries: undefined,
    });

    // toStrictEqual, not toEqual: `toEqual` cannot tell these two apart.
    expect(created[0]).toStrictEqual({
      channel: 'line_api',
      error_message: undefined,
      retries: undefined,
    });
    expect(Object.keys(created[0] as object)).toEqual([
      'channel',
      'error_message',
      'retries',
    ]);
  });

  it('(W3) returns whatever the model returned, so callers can read `_id`', async () => {
    const { writer } = makeWriter();
    const doc = await writer.persist({ channel: 'webhook' });
    expect((doc as unknown as { _id: string })._id).toBe('wl-1');
  });

  it('(W4) 🔴 does NOT swallow a failed write — the caller owns its catch', async () => {
    const model = {
      create: jest.fn().mockRejectedValue(new Error('mongo down')),
    };
    const writer = new WebhookLogWriter(model as never);

    await expect(writer.persist({ channel: 'webhook' })).rejects.toThrow(
      'mongo down',
    );
  });
});
