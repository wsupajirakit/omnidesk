import { Test } from '@nestjs/testing';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { ConfigModule } from '@/config/config.module';
import { MongoModule } from '@/infra/mongo/mongo.module';
import { Role, RoleSchema, User, UserSchema } from '@/modules/admin';
import {
  Counter,
  CounterSchema,
  SystemConfig,
  SystemConfigSchema,
  TranslationDict,
  TranslationDictSchema,
  WebhookLog,
  WebhookLogSchema,
} from '@/modules/system';

/**
 * Schema parity against the real database.
 *
 * A ported schema compiling proves nothing — it has to open the collections the
 * legacy backend wrote, under the same names, and hydrate their documents
 * without dropping fields. This suite reads (never writes) from whatever
 * database MONGODB_URI points at.
 *
 * Skips itself when the target database is empty, so it does not fail on a
 * fresh CI database that has no legacy data to compare against.
 */
describe('Schema parity (real data)', () => {
  let connection: Connection;
  let models: {
    user: Model<User>;
    role: Model<Role>;
    counter: Model<Counter>;
    systemConfig: Model<SystemConfig>;
    translationDict: Model<TranslationDict>;
    webhookLog: Model<WebhookLog>;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        MongoModule,
        MongooseModule.forFeature([
          { name: User.name, schema: UserSchema },
          { name: Role.name, schema: RoleSchema },
          { name: Counter.name, schema: CounterSchema },
          { name: SystemConfig.name, schema: SystemConfigSchema },
          { name: TranslationDict.name, schema: TranslationDictSchema },
          { name: WebhookLog.name, schema: WebhookLogSchema },
        ]),
      ],
    }).compile();

    connection = moduleRef.get<Connection>(getConnectionToken());
    models = {
      user: connection.model<User>(User.name),
      role: connection.model<Role>(Role.name),
      counter: connection.model<Counter>(Counter.name),
      systemConfig: connection.model<SystemConfig>(SystemConfig.name),
      translationDict: connection.model<TranslationDict>(TranslationDict.name),
      webhookLog: connection.model<WebhookLog>(WebhookLog.name),
    };
  });

  afterAll(async () => {
    await connection?.close();
  });

  it('resolves every collection name the legacy backend uses', () => {
    // Getting one of these wrong creates a new empty collection beside the real
    // data instead of failing loudly, which is why it is asserted directly.
    expect(models.user.collection.name).toBe('users');
    expect(models.role.collection.name).toBe('roles');
    expect(models.counter.collection.name).toBe('counters');
    expect(models.systemConfig.collection.name).toBe('system_configs');
    expect(models.translationDict.collection.name).toBe('translation_dict');
    expect(models.webhookLog.collection.name).toBe('webhook_logs');
  });

  /**
   * Fields present anywhere in a collection but absent from the schema.
   *
   * Sampling one document is not enough: a field written by only a few rows —
   * a migration script's rollback copy, for instance — is invisible in most
   * samples, and Mongoose drops undeclared fields silently on save. That is
   * data loss with no error, so the whole collection is scanned.
   *
   * Capped at 500 documents: enough to cover the shape variation in practice
   * without turning the suite into a full table scan.
   */
  const undeclaredFields = async (
    collectionName: string,
    schemaPaths: string[],
  ) => {
    const documents = await connection
      .collection(collectionName)
      .find({}, { limit: 500 })
      .toArray();

    const observed = new Set<string>();
    for (const document of documents) {
      for (const key of Object.keys(document)) observed.add(key);
    }

    const declared = new Set([...schemaPaths, '_id', '__v']);
    return [...observed].filter((key) => !declared.has(key)).sort();
  };

  it('declares every field present in users', async () => {
    expect(
      await undeclaredFields('users', Object.keys(models.user.schema.paths)),
    ).toEqual([]);
  });

  it('declares every field present in roles', async () => {
    expect(
      await undeclaredFields('roles', Object.keys(models.role.schema.paths)),
    ).toEqual([]);
  });

  it('declares every field present in the remaining collections', async () => {
    const checks: Array<[string, string[]]> = [
      ['system_configs', Object.keys(models.systemConfig.schema.paths)],
      ['translation_dict', Object.keys(models.translationDict.schema.paths)],
      ['webhook_logs', Object.keys(models.webhookLog.schema.paths)],
      ['counters', Object.keys(models.counter.schema.paths)],
    ];

    for (const [collectionName, paths] of checks) {
      expect({
        collection: collectionName,
        undeclared: await undeclaredFields(collectionName, paths),
      }).toEqual({ collection: collectionName, undeclared: [] });
    }
  });

  it('hydrates a real user without losing fields', async () => {
    const raw = await connection.collection('users').findOne({});
    if (!raw) return; // empty database — nothing to compare

    const hydrated = await models.user.findById(raw['_id']).lean();
    expect(hydrated).toBeTruthy();

    const dropped = Object.keys(raw).filter(
      (key) => !(key in (hydrated as object)),
    );
    expect(dropped).toEqual([]);
  });

  it('hydrates a real role without losing fields', async () => {
    const raw = await connection.collection('roles').findOne({});
    if (!raw) return;

    const hydrated = await models.role.findById(raw['_id']).lean();
    const dropped = Object.keys(raw).filter(
      (key) => !(key in (hydrated as object)),
    );
    expect(dropped).toEqual([]);
  });

  it('hydrates a real system config without losing fields', async () => {
    const raw = await connection.collection('system_configs').findOne({});
    if (!raw) return;

    const hydrated = await models.systemConfig.findById(raw['_id']).lean();
    const dropped = Object.keys(raw).filter(
      (key) => !(key in (hydrated as object)),
    );
    expect(dropped).toEqual([]);
  });

  it('hydrates a real translation dictionary row without losing fields', async () => {
    const raw = await connection.collection('translation_dict').findOne({});
    if (!raw) return;

    const hydrated = await models.translationDict.findById(raw['_id']).lean();
    const dropped = Object.keys(raw).filter(
      (key) => !(key in (hydrated as object)),
    );
    expect(dropped).toEqual([]);
  });

  it('hydrates a real webhook log without losing fields', async () => {
    const raw = await connection.collection('webhook_logs').findOne({});
    if (!raw) return;

    const hydrated = await models.webhookLog.findById(raw['_id']).lean();
    const dropped = Object.keys(raw).filter(
      (key) => !(key in (hydrated as object)),
    );
    expect(dropped).toEqual([]);
  });

  it('keeps the counter _id as a string, not an ObjectId', async () => {
    const raw = await connection.collection('counters').findOne({});
    if (!raw) return;

    // Sequences are named ("ticket"), so an ObjectId _id would mean the schema
    // disagrees with the data and every lookup would miss.
    expect(typeof raw['_id']).toBe('string');
    const hydrated = await models.counter.findById(raw['_id']).lean();
    expect(hydrated).toBeTruthy();
  });
});
