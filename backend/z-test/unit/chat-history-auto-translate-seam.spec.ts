/**
 * [FEAT-20260918-AUTOTRANS] The seam — proof that the storage path is unchanged
 * =============================================================================
 * The whole feature hangs off ONE optional argument on `ChatHistoryService`, the
 * funnel every message row goes through. Owner's condition for touching it at
 * all: *"ห้ามกระทบ flow เด็ดขาด ต้องทำงานเหมือนเดิม กรณีปิดการแปล หรือไม่มีการตั้งค่าเลย"*.
 *
 * "Unchanged" is measured here in the only way that means anything: the service
 * is constructed the way it was constructed before this feature existed — five
 * arguments, no sixth — and the row it writes plus the events it publishes are
 * compared against the plugged-in run. Anything the plug can do to that path
 * would show up as a difference.
 *
 * ⚠️ This is also the spec that keeps the feature REMOVABLE. If someone later
 *    makes the dependency required, the first block stops compiling or throws —
 *    which is the point.
 */

import { ChatHistoryService } from '@/modules/chat/chat-history.service';

type Row = Record<string, unknown>;

function harness(plug?: {
  onInboundMessage: (i: unknown) => Promise<unknown>;
}) {
  const rows: Row[] = [];
  const published: Array<{ type: string; data: unknown }> = [];
  const lean = (doc: unknown) => ({
    select: () => ({ lean: () => Promise.resolve(doc) }),
    lean: () => Promise.resolve(doc),
  });

  const hookModel = { findById: () => lean({ channel_type: 'line' }) };
  const memberModel = {
    findOne: () => Promise.resolve({ _id: 'm1' }),
    findOneAndUpdate: () => Promise.resolve({ _id: 'm1' }),
  };
  const chatRoomModel = {
    findOneAndUpdate: () => Promise.resolve({ _id: 'r1' }),
    updateOne: () => Promise.resolve({ matchedCount: 1, modifiedCount: 1 }),
    findById: () => lean({ _id: 'r1' }),
    db: { models: {} },
  };
  class MessageModel {
    static findOne = () => Promise.resolve(null);
    static db = { name: 'test' };
    _id = 'msg1';
    constructor(public readonly data: Row) {
      rows.push(data);
      Object.assign(this, data);
    }
    save = () => Promise.resolve(this);
    toObject = () => ({ ...this.data, _id: this._id });
  }

  const publisher = {
    publish: (type: string, data: unknown) => {
      published.push({ type, data });
      return Promise.resolve();
    },
  };

  /* The five-argument call is the "before" shape, on purpose — see the header. */
  const svc = plug
    ? new ChatHistoryService(
        chatRoomModel as never,
        MessageModel as never,
        memberModel as never,
        hookModel as never,
        publisher as never,
        plug as never,
      )
    : new ChatHistoryService(
        chatRoomModel as never,
        MessageModel as never,
        memberModel as never,
        hookModel as never,
        publisher as never,
      );

  return { svc, rows, published };
}

const inbound = {
  userId: 'Uabc',
  senderType: 'customer',
  messageType: 'text',
  content: 'ငွေသွင်းချင်ပါတယ်',
  hookId: 'h1',
  providerMsgId: '6253808349',
  replyToken: 'rt-1',
};

/** The publish block is fire-and-forget; let the microtasks drain. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('[FEAT-20260918-AUTOTRANS] nothing plugged in ⇒ nothing changes', () => {
  it('constructs and stores with five arguments, exactly as before', async () => {
    const { svc, rows } = harness();

    const msg = await svc.logMessage(inbound);
    await settle();

    expect(msg).toBeTruthy();
    expect(rows).toHaveLength(1);
    expect(rows[0]!['content']).toBe(inbound.content);
    // The row carries no translation — the feature did not exist for this run.
    expect(rows[0]!['translations']).toBeUndefined();
  });

  it('writes the same row and publishes the same events as with the plug', async () => {
    const off = harness();
    const on = harness({ onInboundMessage: () => Promise.resolve('th') });

    await off.svc.logMessage(inbound);
    await on.svc.logMessage(inbound);
    await settle();

    // The stored row is what the customer sees the consequences of. Identical.
    expect(on.rows[0]).toEqual(off.rows[0]);
    // And the realtime fan-out — same events, same order.
    expect(on.published.map((p) => p.type)).toEqual(
      off.published.map((p) => p.type),
    );
  });
});

describe('[FEAT-20260918-AUTOTRANS] plugged in ⇒ called once, after the publish', () => {
  it('hands the plug the ids and the text, once', async () => {
    const seen: unknown[] = [];
    const { svc } = harness({
      onInboundMessage: (i) => {
        seen.push(i);
        return Promise.resolve('th');
      },
    });

    await svc.logMessage(inbound);
    await settle();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      messageId: 'msg1',
      roomId: 'r1',
      hookId: 'h1',
      text: inbound.content,
      senderType: 'customer',
      messageType: 'text',
    });
  });

  it('is not called for the admin’s own outbound row', async () => {
    const seen: unknown[] = [];
    const { svc } = harness({
      onInboundMessage: (i) => {
        seen.push(i);
        return Promise.resolve(null);
      },
    });

    await svc.logMessage({ ...inbound, senderType: 'admin' });
    await settle();

    expect(seen).toEqual([]);
  });

  it('🔴 a plug that rejects never reaches the caller — the row still returns', async () => {
    const { svc, rows } = harness({
      onInboundMessage: () => Promise.reject(new Error('vendor exploded')),
    });

    const msg = await svc.logMessage(inbound);
    await settle();

    expect(msg).toBeTruthy();
    expect(rows[0]!['content']).toBe(inbound.content);
  });

  it('🔴 a plug that throws synchronously does not break the write either', async () => {
    const { svc, rows } = harness({
      onInboundMessage: () => {
        throw new Error('exploded before returning a promise');
      },
    });

    const msg = await svc.logMessage(inbound);
    await settle();

    expect(msg).toBeTruthy();
    expect(rows).toHaveLength(1);
  });
});
