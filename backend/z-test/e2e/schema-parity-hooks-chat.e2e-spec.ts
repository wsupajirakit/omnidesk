import { Test } from '@nestjs/testing';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { ConfigModule } from '@/config/config.module';
import { MongoModule } from '@/infra/mongo/mongo.module';
import {
  AssignHistory,
  AssignHistorySchema,
  ChatMessage,
  ChatMessageSchema,
  ChatRoom,
  ChatRoomNote,
  ChatRoomNoteSchema,
  ChatRoomSchema,
  CustomerTag,
  CustomerTagSchema,
  Member,
  MemberSchema,
  Tag,
  TagSchema,
} from '@/modules/chat';
import {
  CustomCurl,
  CustomCurlSchema,
  CustomTool,
  CustomToolSchema,
  DynamicTag,
  DynamicTagSchema,
  FlexMessage,
  FlexMessageSchema,
  Group,
  GroupSchema,
  Hook,
  HookAuditLog,
  HookAuditLogSchema,
  HookSchema,
  Mapping,
  MappingSchema,
} from '@/modules/hooks';

/**
 * Schema parity for the hooks and chat modules, against the real database.
 *
 * Same contract as the sibling parity suite: a schema compiling proves nothing.
 * It has to open the collections the legacy backend wrote, under the same
 * names, and hydrate their documents without dropping fields. Reads only.
 *
 * Kept in its own file so the two suites can be edited independently.
 */
describe('Schema parity — hooks and chat (real data)', () => {
  let connection: Connection;
  let models: {
    hook: Model<Hook>;
    group: Model<Group>;
    mapping: Model<Mapping>;
    customTool: Model<CustomTool>;
    customCurl: Model<CustomCurl>;
    dynamicTag: Model<DynamicTag>;
    hookAuditLog: Model<HookAuditLog>;
    flexMessage: Model<FlexMessage>;
    chatRoom: Model<ChatRoom>;
    chatMessage: Model<ChatMessage>;
    member: Model<Member>;
    tag: Model<Tag>;
    customerTag: Model<CustomerTag>;
    chatRoomNote: Model<ChatRoomNote>;
    assignHistory: Model<AssignHistory>;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        MongoModule,
        MongooseModule.forFeature([
          { name: Hook.name, schema: HookSchema },
          { name: Group.name, schema: GroupSchema },
          { name: Mapping.name, schema: MappingSchema },
          { name: CustomTool.name, schema: CustomToolSchema },
          { name: CustomCurl.name, schema: CustomCurlSchema },
          { name: DynamicTag.name, schema: DynamicTagSchema },
          { name: HookAuditLog.name, schema: HookAuditLogSchema },
          { name: FlexMessage.name, schema: FlexMessageSchema },
          { name: ChatRoom.name, schema: ChatRoomSchema },
          { name: ChatMessage.name, schema: ChatMessageSchema },
          { name: Member.name, schema: MemberSchema },
          { name: Tag.name, schema: TagSchema },
          { name: CustomerTag.name, schema: CustomerTagSchema },
          { name: ChatRoomNote.name, schema: ChatRoomNoteSchema },
          { name: AssignHistory.name, schema: AssignHistorySchema },
        ]),
      ],
    }).compile();

    connection = moduleRef.get<Connection>(getConnectionToken());
    models = {
      hook: connection.model<Hook>(Hook.name),
      group: connection.model<Group>(Group.name),
      mapping: connection.model<Mapping>(Mapping.name),
      customTool: connection.model<CustomTool>(CustomTool.name),
      customCurl: connection.model<CustomCurl>(CustomCurl.name),
      dynamicTag: connection.model<DynamicTag>(DynamicTag.name),
      hookAuditLog: connection.model<HookAuditLog>(HookAuditLog.name),
      flexMessage: connection.model<FlexMessage>(FlexMessage.name),
      chatRoom: connection.model<ChatRoom>(ChatRoom.name),
      chatMessage: connection.model<ChatMessage>(ChatMessage.name),
      member: connection.model<Member>(Member.name),
      tag: connection.model<Tag>(Tag.name),
      customerTag: connection.model<CustomerTag>(CustomerTag.name),
      chatRoomNote: connection.model<ChatRoomNote>(ChatRoomNote.name),
      assignHistory: connection.model<AssignHistory>(AssignHistory.name),
    };
  });

  afterAll(async () => {
    await connection?.close();
  });

  it('resolves every collection name the legacy backend uses', () => {
    // Getting one of these wrong creates a new empty collection beside the real
    // data instead of failing loudly, which is why it is asserted directly.
    // Note the renames: the Hook model reads `hooks` (was `line_chat_bot`) and
    // the Member model reads `members` (was `line_users`).
    expect(models.hook.collection.name).toBe('hooks');
    expect(models.group.collection.name).toBe('groups');
    expect(models.mapping.collection.name).toBe('mappings');
    expect(models.customTool.collection.name).toBe('custom_tools');
    expect(models.customCurl.collection.name).toBe('custom_curls');
    expect(models.dynamicTag.collection.name).toBe('dynamic_tags');
    expect(models.hookAuditLog.collection.name).toBe('hook_audit_logs');
    expect(models.flexMessage.collection.name).toBe('flex_messages');
    expect(models.chatRoom.collection.name).toBe('chat_rooms');
    expect(models.chatMessage.collection.name).toBe('chat_messages');
    expect(models.member.collection.name).toBe('members');
    expect(models.tag.collection.name).toBe('tags');
    expect(models.customerTag.collection.name).toBe('customer_tags');
    expect(models.chatRoomNote.collection.name).toBe('chat_room_notes');
    expect(models.assignHistory.collection.name).toBe('assign_histories');
  });

  /**
   * Asserts the schema declares every key that actually occurs in the
   * collection. A field missing from the schema is dropped silently by
   * Mongoose — exactly the failure this catches.
   *
   * The union of keys across ALL documents is used, not one sampled document:
   * fields added late in the legacy backend's life exist on only a handful of
   * rows, and sampling one document misses them. That is not hypothetical —
   * it is how `flex_messages.flex_ns_backup` (present on 6 of 41 cards, written
   * by a migration script outside the Mongoose model) was found.
   *
   * Returns early on an empty collection so a fresh database does not fail.
   */
  const expectNoDroppedFields = async <T>(
    collection: string,
    model: Model<T>,
  ): Promise<void> => {
    const all = await connection.collection(collection).find({}).toArray();
    if (all.length === 0) return; // empty collection — nothing to compare

    const storedKeys = new Set<string>();
    for (const doc of all) {
      for (const key of Object.keys(doc)) storedKeys.add(key);
    }

    // `__v` is Mongoose's own version key and is never a schema path.
    // Also include root keys for nested paths (e.g. 'hmac' from 'hmac.algorithm')
    const schemaKeys = new Set<string>();
    for (const pathKey of Object.keys(model.schema.paths)) {
      schemaKeys.add(pathKey);
      const rootKey = pathKey.split('.')[0];
      if (rootKey) schemaKeys.add(rootKey);
    }
    schemaKeys.add('__v');

    const undeclared = [...storedKeys].filter((key) => !schemaKeys.has(key));
    expect(undeclared).toEqual([]);

    // Hydration must also survive round-tripping a real document.
    const first = all[0];
    const hydrated = await model.findById(first!['_id']).lean();
    expect(hydrated).toBeTruthy();

    /* [FIX-20260822-PARITYSELECTFALSE] A PATH DECLARED `select: false` IS
       ABSENT ON PURPOSE, and this check must not read that as a loss.
       `findById().lean()` above does not select such a path, so the raw document
       carries the key and the hydrated one does not — which is the documented
       design, not a schema that lost a field. Seen 22/08 with
       `members.search` ([PERF-20260821-MEMBERSEARCH], `select: false` so that
       endpoints returning a member whole do not start carrying token buckets):
       the case only fails once a REAL row has been written since that deploy,
       which is why it passed for a day and then did not.
       ⚠️ DERIVED FROM THE SCHEMA, never a hardcoded field name — the day a path
       stops being `select: false` this check starts guarding it again by itself.
       The `undeclared` assertion above is untouched, so a key the schema does
       not know at all still fails exactly as before.
       select:false = ตั้งใจไม่ดึงมา ไม่ใช่ field หาย. */
    const unselected = new Set<string>();
    for (const [pathKey, pathDef] of Object.entries(model.schema.paths)) {
      const opts = (pathDef as { options?: { select?: unknown } }).options;
      if (opts && opts.select === false) {
        const rootKey = pathKey.split('.')[0];
        if (rootKey) unselected.add(rootKey);
      }
    }

    const dropped = Object.keys(first!).filter(
      (key) => !(key in (hydrated as object)) && !unselected.has(key),
    );
    expect(dropped).toEqual([]);

    /* ⭐ AND THE EXCLUSION ABOVE MUST EARN ITSELF. Skipping a key because the
       schema says `select: false` is only honest if the DATA IS STILL THERE —
       otherwise this check would wave through exactly the loss it exists to
       catch, on any path someone marks unselected. So every unselected key the
       real row carries is asked for EXPLICITLY, and must come back with a value
       that is not undefined. ข้ามได้ ต่อเมื่อพิสูจน์ว่าของยังอยู่. */
    const unselectedPresent = Object.keys(first!).filter((key) =>
      unselected.has(key),
    );
    for (const key of unselectedPresent) {
      const withKey = await model
        .findById(first!['_id'])
        .select(`+${key}`)
        .lean();
      expect(withKey).toBeTruthy();
      expect((withKey as Record<string, unknown>)[key]).not.toBeUndefined();
    }
  };

  it('hydrates a real hook without losing fields', async () => {
    await expectNoDroppedFields('hooks', models.hook);
  });

  it('hydrates a real group without losing fields', async () => {
    await expectNoDroppedFields('groups', models.group);
  });

  it('hydrates a real mapping without losing fields', async () => {
    await expectNoDroppedFields('mappings', models.mapping);
  });

  it('hydrates a real custom tool without losing fields', async () => {
    await expectNoDroppedFields('custom_tools', models.customTool);
  });

  it('hydrates a real custom curl without losing fields', async () => {
    await expectNoDroppedFields('custom_curls', models.customCurl);
  });

  it('hydrates a real dynamic tag without losing fields', async () => {
    await expectNoDroppedFields('dynamic_tags', models.dynamicTag);
  });

  it('hydrates a real hook audit log without losing fields', async () => {
    await expectNoDroppedFields('hook_audit_logs', models.hookAuditLog);
  });

  it('hydrates a real flex message without losing fields', async () => {
    await expectNoDroppedFields('flex_messages', models.flexMessage);
  });

  it('hydrates a real chat room without losing fields', async () => {
    await expectNoDroppedFields('chat_rooms', models.chatRoom);
  });

  it('hydrates a real chat message without losing fields', async () => {
    await expectNoDroppedFields('chat_messages', models.chatMessage);
  });

  it('hydrates a real member without losing fields', async () => {
    await expectNoDroppedFields('members', models.member);
  });

  it('hydrates a real tag without losing fields', async () => {
    await expectNoDroppedFields('tags', models.tag);
  });

  it('hydrates a real customer tag without losing fields', async () => {
    await expectNoDroppedFields('customer_tags', models.customerTag);
  });

  it('hydrates a real chat room note without losing fields', async () => {
    await expectNoDroppedFields('chat_room_notes', models.chatRoomNote);
  });

  it('hydrates a real assign history without losing fields', async () => {
    await expectNoDroppedFields('assign_histories', models.assignHistory);
  });

  it('keeps both names of each renamed field readable', () => {
    // The legacy backend dual-writes old and new names. Dropping either side
    // would make documents written under the other name unreadable, so the
    // schema must still declare both.
    const roomPaths = models.chatRoom.schema.paths;
    expect(roomPaths['line_user_id']).toBeDefined();
    expect(roomPaths['channel_user_id']).toBeDefined();

    const memberPaths = models.member.schema.paths;
    expect(memberPaths['line_user_id']).toBeDefined();
    expect(memberPaths['member_user_id']).toBeDefined();

    const mappingPaths = models.mapping.schema.paths;
    expect(mappingPaths['line_chatbot_ids']).toBeDefined();
    expect(mappingPaths['hook_ids']).toBeDefined();

    const hookPaths = models.hook.schema.paths;
    expect(hookPaths['line_oa_name']).toBeDefined();
    expect(hookPaths['display_name']).toBeDefined();
    expect(hookPaths['line_url']).toBeDefined();
    expect(hookPaths['oa_url']).toBeDefined();
  });
});
