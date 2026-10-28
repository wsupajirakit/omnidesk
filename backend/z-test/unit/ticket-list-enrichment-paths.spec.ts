/**
 * Guard for the schema paths the ticket LIST enrichment queries and populates.
 *
 * V14: `@Prop({ type: Types.ObjectId })` degrades the path to Mixed, which casts
 * nothing — a 24-hex string from a URL then never matches the stored ObjectId,
 * and `populate()` on a Mixed path is a no-op because Mongoose only follows a
 * ref on a real ObjectId path. The list enrichment builds `customer_tags` /
 * `assign_histories` / `attached_files` from these paths and four `populate()`
 * refs, so a silent Mixed reads as "this customer has no tags" rather than as a
 * bug — which is exactly how the defect this guards shipped.
 *
 * Asserted on `.instance` at runtime, never by reading the declaration — the
 * declaration is precisely what looks correct while being wrong. Every path is
 * reported in one array so the whole picture shows in a single failure.
 *
 * ตรวจที่ค่า runtime ไม่ใช่หน้าตาโค้ด — จุดนี้เคยพังแบบเงียบมาแล้ว
 */

import {
  AssignHistorySchema,
  ChatMessageSchema,
  ChatRoomSchema,
  CustomerTagSchema,
} from '@/modules/chat';
import { TicketSchema } from '@/modules/tickets';

interface PathProbe {
  path: (
    p: string,
  ) => { instance?: string; options?: { ref?: string } } | undefined;
}

const TARGETS: ReadonlyArray<readonly [string, PathProbe, string, string]> = [
  // customer_tags: matched by member_id, label/colour come through the tag ref
  ['CustomerTag', CustomerTagSchema, 'member_id', 'Member'],
  ['CustomerTag', CustomerTagSchema, 'tag_id', 'Tag'],
  // assign_histories: grouped by ticket_id, both actors populated
  ['AssignHistory', AssignHistorySchema, 'ticket_id', 'Ticket'],
  ['AssignHistory', AssignHistorySchema, 'assign_to', 'User'],
  ['AssignHistory', AssignHistorySchema, 'changed_by_id', 'User'],
  // attached_files: the room map is keyed by user_id|hook_id, then by room_id
  ['ChatRoom', ChatRoomSchema, 'user_id', 'Member'],
  ['ChatRoom', ChatRoomSchema, 'hook_id', 'Hook'],
  ['ChatMessage', ChatMessageSchema, 'room_id', 'ChatRoom'],
  ['ChatMessage', ChatMessageSchema, 'internal_content_id', 'ImageStorage'],
  // the scope filter, and the key the tag map is looked up by
  ['Ticket', TicketSchema, 'hook_id', 'Hook'],
  ['Ticket', TicketSchema, 'chat_user_id', 'Member'],
];

describe('ticket list enrichment — schema paths', () => {
  it('every queried and populated path is a real ObjectId, not Mixed', () => {
    // V3: prove the fixture is non-empty before asserting over it.
    expect(TARGETS.length).toBeGreaterThan(0);

    const actual = TARGETS.map(([label, schema, path]) => {
      const declared = schema.path(path);
      return `${label}.${path} instance=${declared?.instance ?? 'MISSING'} ref=${declared?.options?.ref ?? 'MISSING'}`;
    });
    const expected = TARGETS.map(
      ([label, , path, ref]) => `${label}.${path} instance=ObjectId ref=${ref}`,
    );

    expect(actual).toEqual(expected);
  });
});
