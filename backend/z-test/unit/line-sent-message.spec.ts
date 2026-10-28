/**
 * [FEAT-20260831-QUOTESRC] What LINE hands back after a successful send, read
 * once instead of thirteen times.
 *
 * The contract that matters is the EMPTY one: when LINE returned nothing usable
 * the result must carry no keys at all, so a call site that spreads it into
 * `logMessage({...})` produces the exact object it produces today. A `{ providerMsgId:
 * undefined }` would look harmless and would flip `provider_msg_id || null` — the
 * same value, but it would also wake the de-dup read. ไม่มีค่า = ไม่มีคีย์.
 */
import { sentMessageIds } from '@/infra/line';

describe('sentMessageIds — the two values, or nothing at all', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['no data', {}],
    ['data without sentMessages', { data: {} }],
    ['an empty sentMessages array', { data: { sentMessages: [] } }],
    ['a first entry with neither field', { data: { sentMessages: [{}] } }],
  ])('%s → an object with NO keys', (_name, res) => {
    expect(Object.keys(sentMessageIds(res as never))).toEqual([]);
  });

  it('reads the id and the quote token of the message LINE accepted', () => {
    expect(
      sentMessageIds({
        data: {
          sentMessages: [{ id: '628874250056892966', quoteToken: 'qt-abc' }],
        },
      }),
    ).toEqual({
      providerMsgId: '628874250056892966',
      quoteToken: 'qt-abc',
    });
  });

  it('an id without a token still yields the id — flex/template sends return no token', () => {
    expect(sentMessageIds({ data: { sentMessages: [{ id: '123' }] } })).toEqual(
      { providerMsgId: '123' },
    );
  });

  it('reads the FIRST entry — every reply this repo sends carries exactly one message', () => {
    expect(
      sentMessageIds({
        data: { sentMessages: [{ id: 'first' }, { id: 'second' }] },
      }),
    ).toEqual({ providerMsgId: 'first' });
  });

  it('a non-string id is not carried — the column is a String path', () => {
    expect(sentMessageIds({ data: { sentMessages: [{ id: 123 }] } })).toEqual(
      {},
    );
  });
});
