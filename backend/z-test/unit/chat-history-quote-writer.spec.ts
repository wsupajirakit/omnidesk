/**
 * [FEAT-20260821-QUOTEREPLY] `logMessage` is the ONE door that writes a chat
 * message row. This pins that it copies the two quote fields through — and that
 * it writes NOTHING for them when the caller passes nothing, which is the
 * seamless contract every legacy webhook caller relies on (they do not know the
 * new inputs exist, and their rows must stay byte-identical).
 *
 * Drives the REAL ChatHistoryService; the four models are minimal fakes, the
 * message model captures its constructor argument. No Mongo.
 */
import { ChatHistoryService } from '@/modules/chat';

type Row = Record<string, unknown>;

function harness(): { svc: ChatHistoryService; rows: Row[] } {
  const rows: Row[] = [];
  const lean = <T>(v: T) => ({
    select: () => ({ lean: () => Promise.resolve(v) }),
    lean: () => Promise.resolve(v),
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
  const svc = new ChatHistoryService(
    chatRoomModel as never,
    MessageModel as never,
    memberModel as never,
    hookModel as never,
    { publish: () => Promise.resolve() } as never,
  );
  return { svc, rows };
}

const base = {
  userId: 'Uabc',
  senderType: 'customer',
  messageType: 'text',
  content: 'hello',
  hookId: 'h1',
  providerMsgId: '6253808349',
  replyToken: 'rt-1',
};

describe('[FEAT-20260821-QUOTEREPLY] logMessage — the quote fields go through the one door', () => {
  it('copies quoteToken → quote_token and quotedProviderMsgId → quoted_provider_msg_id', async () => {
    const { svc, rows } = harness();
    await svc.logMessage({
      ...base,
      quoteToken: 'qt-1',
      quotedProviderMsgId: '111',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      quote_token: 'qt-1',
      quoted_provider_msg_id: '111',
    });
  });

  it('a caller that knows nothing about quotes produces a row with NEITHER key', async () => {
    const { svc, rows } = harness();
    await svc.logMessage(base);
    expect(rows).toHaveLength(1);
    const row = rows[0] as Row;
    // absent, not null — `null` would be a key on every legacy row and in every ws payload
    expect('quote_token' in row).toBe(false);
    expect('quoted_provider_msg_id' in row).toBe(false);
  });

  it('an empty string is treated as "no token" — never persisted', async () => {
    const { svc, rows } = harness();
    await svc.logMessage({ ...base, quoteToken: '', quotedProviderMsgId: '' });
    const row = rows[0] as Row;
    expect('quote_token' in row).toBe(false);
    expect('quoted_provider_msg_id' in row).toBe(false);
  });
});
