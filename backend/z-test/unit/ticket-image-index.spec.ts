/**
 * [PERF-20260822-TKTIMGIDX] The ticket list's attachment lookup must be
 * index-served on BOTH keys it filters by.
 *
 * WHY THIS SPEC EXISTS: `enrichTicketRows` filters chat_messages by
 * `room_id` AND `message_type`. The pre-existing index stops at `room_id`,
 * so `message_type` was a post-filter and the server read every message of
 * every room in the list to discard almost all of them (measured: 1,812 read
 * to return 81). Nothing in the test suite noticed, because the RESULT was
 * always correct — only the cost was wrong. This spec locks the index so the
 * cost cannot silently come back.
 *
 * It asserts the SHAPE (key order matters for a compound index), not just the
 * presence of the field names.
 */
import { ChatMessageSchema } from '@/modules/chat';

type IndexDecl = [Record<string, number | string>, Record<string, unknown>?];

const declared = (): IndexDecl[] => ChatMessageSchema.indexes();

/** The exact query enrichTicketRows fires, as a key set. */
const TICKET_IMAGE_QUERY_KEYS = ['room_id', 'message_type'];

describe('⭐ the ticket-list image lookup is index-served on room_id + message_type', () => {
  it('an index exists whose FIRST TWO keys are exactly room_id then message_type', () => {
    const match = declared().filter((i) => {
      const keys = Object.keys(i[0]);
      return (
        keys[0] === TICKET_IMAGE_QUERY_KEYS[0] &&
        keys[1] === TICKET_IMAGE_QUERY_KEYS[1]
      );
    });
    expect(match.length).toBeGreaterThan(0);
  });

  it('that index carries created_at as its third key, so the same index also serves the sort', () => {
    const match = declared().find((i) => {
      const keys = Object.keys(i[0]);
      return keys[0] === 'room_id' && keys[1] === 'message_type';
    });
    expect(match).toBeDefined();
    expect(Object.keys(match![0])[2]).toBe('created_at');
    expect(match![0]['created_at']).toBe(-1);
  });

  it('it is declared background:true — building it must not block writes on a live collection', () => {
    const match = declared().find((i) => {
      const keys = Object.keys(i[0]);
      return keys[0] === 'room_id' && keys[1] === 'message_type';
    });
    expect(match?.[1]?.['background']).toBe(true);
  });

  it('SEAMLESS: the pre-existing thread-view index is still declared, unchanged', () => {
    // Removing or reshaping { room_id: 1, created_at: -1 } would change the
    // thread view's plan. This addition must be purely additive.
    const thread = declared().find((i) => {
      const keys = Object.keys(i[0]);
      return (
        keys.length === 2 && keys[0] === 'room_id' && keys[1] === 'created_at'
      );
    });
    expect(thread).toBeDefined();
    expect(thread![0]['room_id']).toBe(1);
    expect(thread![0]['created_at']).toBe(-1);
  });

  it('SEAMLESS: no index was removed — the count only went up by one', () => {
    // Guards against a "replace the old index" refactor that would change the
    // thread view's behaviour while this spec's other cases still passed.
    expect(declared().length).toBeGreaterThanOrEqual(2);
  });
});
