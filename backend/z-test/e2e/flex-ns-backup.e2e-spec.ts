import { type INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Model } from 'mongoose';

import { AppModule } from '@/app.module';
import { FlexMessage, type FlexMessageDocument } from '@/modules/hooks';

import { bindTestServer } from '../lib/bind-test-server';

/**
 * `flex_ns_backup` must survive a write — lesson V2.
 *
 * The field exists on only 6 of 41 rows in `flex_messages`. It was written by a
 * migration script through the raw driver, so it is absent from the legacy
 * Mongoose model, and it is the ONLY rollback copy of those documents' original
 * `content_json`.
 *
 * Mongoose drops undeclared fields silently on save. If this port's schema
 * omitted it, the first time an admin edited one of those six cards the only
 * copy of the original content would be gone — no error, nothing in a log.
 *
 * Reading a document is NOT sufficient evidence: an undeclared field still
 * appears in a `.lean()` read, because lean bypasses hydration entirely. The
 * only test that answers the question is hydrate → save → read back, which is
 * what this does.
 *
 * ⚠️ It writes to a real collection, so it operates on a document it creates
 * itself and deletes in `afterAll` — it never touches one of the six real rows.
 */
describe('flex_messages.flex_ns_backup survives a write', () => {
  let app: INestApplication;
  let flexModel: Model<FlexMessageDocument>;
  const probeName = `zz_golden_probe_ns_backup_${Date.now()}`;
  let probeId: unknown;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await bindTestServer(app);
    flexModel = app.get<Model<FlexMessageDocument>>(
      getModelToken(FlexMessage.name),
    );
  }, 60_000);

  afterAll(async () => {
    // Hard delete, not the soft delete the endpoint does — this row must leave
    // no trace that a later comparison could trip over.
    if (probeId) await flexModel.deleteOne({ _id: probeId });
    await app?.close();
  });

  it('declares the field on the schema at all', () => {
    // Cheap, but it is the thing that actually prevents the data loss: an
    // undeclared path is what makes Mongoose drop the value.
    expect(flexModel.schema.path('flex_ns_backup')).toBeDefined();
  });

  it('keeps flex_ns_backup through hydrate → save → read', async () => {
    const backup = {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: [] },
      _probe: 'original content, pre-migration',
    };

    const created = await flexModel.create({
      name: probeName,
      content_json: { type: 'bubble', _probe: 'migrated content' },
      flex_ns_backup: backup,
    });
    probeId = created._id;

    // The write path that would destroy it: load as a document (not lean), so
    // every field passes through the schema, change something unrelated, save.
    const hydrated = await flexModel.findById(probeId);
    expect(hydrated).not.toBeNull();
    hydrated!.set('callback_detail', 'touched by the ns-backup probe');
    await hydrated!.save();

    const after = await flexModel.findById(probeId).lean();
    expect(after).not.toBeNull();

    const raw = after as unknown as Record<string, unknown>;
    // Non-empty check first — comparing against an absent field would pass
    // trivially if the create above had silently dropped it (V3).
    expect(raw['flex_ns_backup']).toBeDefined();
    expect(raw['flex_ns_backup']).toEqual(backup);
    // And the unrelated edit really did happen, so the save was not a no-op.
    expect(raw['callback_detail']).toBe('touched by the ns-backup probe');
  }, 30_000);

  /**
   * The union-of-keys check V2 actually asks for: every key present on ANY real
   * document must be declared, not just the keys on the one row someone
   * sampled. Read-only.
   */
  it('declares every key present across all real rows', async () => {
    const rows = await flexModel.collection
      .find({}, { projection: { content_json: 0, flex_ns_backup: 0 } })
      .limit(500)
      .toArray();

    // A broken query returning nothing would make the loop below vacuous (V3).
    expect(rows.length).toBeGreaterThan(0);

    const unionOfKeys = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) unionOfKeys.add(key);
    }

    const undeclared = [...unionOfKeys].filter(
      (key) =>
        key !== '_id' &&
        key !== '__v' &&
        !flexModel.schema.path(key) &&
        !flexModel.schema.pathType(key).includes('real'),
    );

    expect(undeclared).toEqual([]);
  }, 30_000);
});
