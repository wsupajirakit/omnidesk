import { Test } from '@nestjs/testing';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { ConfigModule } from '@/config/config.module';
import { MongoModule } from '@/infra/mongo/mongo.module';
import {
  AutoReply,
  AutoReplySchema,
  Broadcast,
  BroadcastSchema,
  ImageStorage,
  ImageStorageSchema,
  Menu,
  MenuSchema,
  ObjectCategory,
  ObjectCategorySchema,
  ObjectImage,
  ObjectImageSchema,
  QuickReply,
  QuickReplyCategory,
  QuickReplyCategorySchema,
  QuickReplySchema,
} from '@/modules/content';
import {
  HandoffCallback,
  HandoffCallbackSchema,
  HandoffChain,
  HandoffChainRun,
  HandoffChainRunSchema,
  HandoffChainSchema,
  HandoffHookOverride,
  HandoffHookOverrideSchema,
  HandoffJob,
  HandoffJobSchema,
  HandoffResult,
  HandoffResultSchema,
  HandoffTarget,
  HandoffTargetSchema,
} from '@/modules/handoff';
import { SlipVerification, SlipVerificationSchema } from '@/modules/slip';
import { Ticket, TicketSchema } from '@/modules/tickets';

/**
 * Schema parity for the content, ticket, slip and handoff models.
 *
 * Companion to `schema-parity.e2e-spec.ts`, same contract: a ported schema
 * compiling proves nothing — it has to open the collections the legacy backend
 * wrote, under the same names, and hydrate their documents without dropping
 * fields. Reads only; never writes.
 *
 * Most handoff collections are empty on a local database because the module is
 * dormant until its feature flag is on. The hydration tests below early-return
 * on an empty collection, so they assert parity where there is data and stay
 * silent where there is none — the collection-name test still covers all of
 * them unconditionally.
 */
describe('Schema parity — content, tickets, slip, handoff (real data)', () => {
  let connection: Connection;
  let models: {
    menu: Model<Menu>;
    broadcast: Model<Broadcast>;
    autoReply: Model<AutoReply>;
    quickReply: Model<QuickReply>;
    quickReplyCategory: Model<QuickReplyCategory>;
    imageStorage: Model<ImageStorage>;
    objectCategory: Model<ObjectCategory>;
    objectImage: Model<ObjectImage>;
    ticket: Model<Ticket>;
    slipVerification: Model<SlipVerification>;
    handoffTarget: Model<HandoffTarget>;
    handoffJob: Model<HandoffJob>;
    handoffCallback: Model<HandoffCallback>;
    handoffResult: Model<HandoffResult>;
    handoffChain: Model<HandoffChain>;
    handoffChainRun: Model<HandoffChainRun>;
    handoffHookOverride: Model<HandoffHookOverride>;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        MongoModule,
        MongooseModule.forFeature([
          { name: Menu.name, schema: MenuSchema },
          { name: Broadcast.name, schema: BroadcastSchema },
          { name: AutoReply.name, schema: AutoReplySchema },
          { name: QuickReply.name, schema: QuickReplySchema },
          {
            name: QuickReplyCategory.name,
            schema: QuickReplyCategorySchema,
          },
          { name: ImageStorage.name, schema: ImageStorageSchema },
          { name: ObjectCategory.name, schema: ObjectCategorySchema },
          { name: ObjectImage.name, schema: ObjectImageSchema },
          { name: Ticket.name, schema: TicketSchema },
          { name: SlipVerification.name, schema: SlipVerificationSchema },
          { name: HandoffTarget.name, schema: HandoffTargetSchema },
          { name: HandoffJob.name, schema: HandoffJobSchema },
          { name: HandoffCallback.name, schema: HandoffCallbackSchema },
          { name: HandoffResult.name, schema: HandoffResultSchema },
          { name: HandoffChain.name, schema: HandoffChainSchema },
          { name: HandoffChainRun.name, schema: HandoffChainRunSchema },
          {
            name: HandoffHookOverride.name,
            schema: HandoffHookOverrideSchema,
          },
        ]),
      ],
    }).compile();

    connection = moduleRef.get<Connection>(getConnectionToken());
    models = {
      menu: connection.model<Menu>(Menu.name),
      broadcast: connection.model<Broadcast>(Broadcast.name),
      autoReply: connection.model<AutoReply>(AutoReply.name),
      quickReply: connection.model<QuickReply>(QuickReply.name),
      quickReplyCategory: connection.model<QuickReplyCategory>(
        QuickReplyCategory.name,
      ),
      imageStorage: connection.model<ImageStorage>(ImageStorage.name),
      objectCategory: connection.model<ObjectCategory>(ObjectCategory.name),
      objectImage: connection.model<ObjectImage>(ObjectImage.name),
      ticket: connection.model<Ticket>(Ticket.name),
      slipVerification: connection.model<SlipVerification>(
        SlipVerification.name,
      ),
      handoffTarget: connection.model<HandoffTarget>(HandoffTarget.name),
      handoffJob: connection.model<HandoffJob>(HandoffJob.name),
      handoffCallback: connection.model<HandoffCallback>(HandoffCallback.name),
      handoffResult: connection.model<HandoffResult>(HandoffResult.name),
      handoffChain: connection.model<HandoffChain>(HandoffChain.name),
      handoffChainRun: connection.model<HandoffChainRun>(HandoffChainRun.name),
      handoffHookOverride: connection.model<HandoffHookOverride>(
        HandoffHookOverride.name,
      ),
    };
  });

  afterAll(async () => {
    await connection?.close();
  });

  it('resolves every collection name the legacy backend uses', () => {
    // Getting one of these wrong creates a new empty collection beside the real
    // data instead of failing loudly, which is why it is asserted directly.
    expect(models.menu.collection.name).toBe('menus');
    expect(models.broadcast.collection.name).toBe('broadcasts');
    expect(models.autoReply.collection.name).toBe('auto_replies');
    expect(models.quickReply.collection.name).toBe('quick_replies');
    expect(models.quickReplyCategory.collection.name).toBe(
      'quick_reply_categories',
    );
    expect(models.imageStorage.collection.name).toBe('image_storages');
    expect(models.objectCategory.collection.name).toBe('object_categories');
    expect(models.objectImage.collection.name).toBe('object_images');
    expect(models.ticket.collection.name).toBe('tickets');
    expect(models.slipVerification.collection.name).toBe('slip_verifications');
    expect(models.handoffTarget.collection.name).toBe('handoff_targets');
    expect(models.handoffJob.collection.name).toBe('handoff_jobs');
    expect(models.handoffCallback.collection.name).toBe('handoff_callbacks');
    expect(models.handoffResult.collection.name).toBe('handoff_results');
    expect(models.handoffChain.collection.name).toBe('handoff_chains');
    expect(models.handoffChainRun.collection.name).toBe('handoff_chain_runs');
    expect(models.handoffHookOverride.collection.name).toBe(
      'handoff_hook_overrides',
    );
  });

  /**
   * Reads one real document straight from the driver, hydrates the same
   * document through the model, and fails if hydration lost a key. A field
   * missing from the schema is dropped silently by Mongoose, which is exactly
   * the failure this catches.
   */
  const expectNoDroppedFields = async (
    collectionName: string,
    model: Model<unknown>,
  ): Promise<void> => {
    const raw = await connection.collection(collectionName).findOne({});
    if (!raw) return; // empty collection — nothing to compare

    const hydrated = await model.findById(raw['_id']).lean();
    expect(hydrated).toBeTruthy();

    const dropped = Object.keys(raw).filter(
      (key) => !(key in (hydrated as object)),
    );
    expect(dropped).toEqual([]);
  };

  it('hydrates a real menu without losing fields', async () => {
    await expectNoDroppedFields('menus', models.menu as Model<unknown>);
  });

  it('hydrates a real broadcast without losing fields', async () => {
    await expectNoDroppedFields(
      'broadcasts',
      models.broadcast as Model<unknown>,
    );
  });

  it('hydrates a real auto-reply without losing fields', async () => {
    await expectNoDroppedFields(
      'auto_replies',
      models.autoReply as Model<unknown>,
    );
  });

  it('hydrates a real quick reply without losing fields', async () => {
    await expectNoDroppedFields(
      'quick_replies',
      models.quickReply as Model<unknown>,
    );
  });

  it('hydrates a real quick-reply category without losing fields', async () => {
    await expectNoDroppedFields(
      'quick_reply_categories',
      models.quickReplyCategory as Model<unknown>,
    );
  });

  it('hydrates a real image storage record without losing fields', async () => {
    await expectNoDroppedFields(
      'image_storages',
      models.imageStorage as Model<unknown>,
    );
  });

  it('hydrates a real object category without losing fields', async () => {
    await expectNoDroppedFields(
      'object_categories',
      models.objectCategory as Model<unknown>,
    );
  });

  it('hydrates a real object image without losing fields', async () => {
    await expectNoDroppedFields(
      'object_images',
      models.objectImage as Model<unknown>,
    );
  });

  it('hydrates a real ticket without losing fields', async () => {
    await expectNoDroppedFields('tickets', models.ticket as Model<unknown>);
  });

  it('hydrates a real slip verification without losing fields', async () => {
    await expectNoDroppedFields(
      'slip_verifications',
      models.slipVerification as Model<unknown>,
    );
  });

  it('hydrates a real handoff target without losing fields', async () => {
    await expectNoDroppedFields(
      'handoff_targets',
      models.handoffTarget as Model<unknown>,
    );
  });

  it('hydrates a real handoff job without losing fields', async () => {
    await expectNoDroppedFields(
      'handoff_jobs',
      models.handoffJob as Model<unknown>,
    );
  });

  it('hydrates a real handoff callback without losing fields', async () => {
    await expectNoDroppedFields(
      'handoff_callbacks',
      models.handoffCallback as Model<unknown>,
    );
  });

  it('hydrates a real handoff result without losing fields', async () => {
    await expectNoDroppedFields(
      'handoff_results',
      models.handoffResult as Model<unknown>,
    );
  });

  it('hydrates a real handoff chain without losing fields', async () => {
    await expectNoDroppedFields(
      'handoff_chains',
      models.handoffChain as Model<unknown>,
    );
  });

  it('hydrates a real handoff chain run without losing fields', async () => {
    await expectNoDroppedFields(
      'handoff_chain_runs',
      models.handoffChainRun as Model<unknown>,
    );
  });

  it('hydrates a real handoff hook override without losing fields', async () => {
    await expectNoDroppedFields(
      'handoff_hook_overrides',
      models.handoffHookOverride as Model<unknown>,
    );
  });

  /**
   * The rename fields must both survive hydration. Reading only the new name
   * would return undefined on documents written before the rename, and reading
   * only the old one breaks after the cutover — the port keeps both, so this
   * asserts neither was dropped.
   */
  it('keeps both names of the dual-written ticket reference fields', async () => {
    const raw = await connection.collection('tickets').findOne({
      line_oa_hook_id: { $ne: null },
    });
    if (!raw) return;

    const hydrated = await models.ticket.findById(raw['_id']).lean();
    expect(hydrated).toBeTruthy();
    expect(hydrated).toHaveProperty('line_oa_hook_id');
    expect(hydrated).toHaveProperty('hook_id');
  });

  /**
   * The slip carries the same rename on the sender field. Both names are stored
   * and must both hydrate.
   */
  it('keeps both names of the dual-written slip sender field', async () => {
    const raw = await connection.collection('slip_verifications').findOne({
      sender_member_user_id: { $exists: true },
    });
    if (!raw) return;

    const hydrated = await models.slipVerification.findById(raw['_id']).lean();
    expect(hydrated).toBeTruthy();
    expect(hydrated).toHaveProperty('sender_line_user_id');
    expect(hydrated).toHaveProperty('sender_member_user_id');
  });

  /**
   * `matching_tag` is Mixed in the legacy schema, not `[String]`. Narrowing it
   * would drop the single-string rows older code wrote, so this asserts the
   * stored value survives hydration unchanged whatever its shape.
   */
  it('preserves the Mixed matching_tag on an object image', async () => {
    const raw = await connection
      .collection('object_images')
      .findOne({ matching_tag: { $exists: true } });
    if (!raw) return;

    const hydrated = await models.objectImage.findById(raw['_id']).lean();
    expect(hydrated).toBeTruthy();
    expect((hydrated as { matching_tag: unknown }).matching_tag).toEqual(
      raw['matching_tag'],
    );
  });
});
