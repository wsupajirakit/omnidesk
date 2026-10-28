/**
 * [FIX-20260901-AUDITFROMTO] An audit row has to STORE the before and after,
 * not merely be handed them.
 *
 * Every other audit test in this repo asserts on what the service PASSES to
 * `createAuditLog`. That is why this defect survived: the object services passed
 * `old_value`/`new_value` faithfully, the mocks recorded them faithfully, the
 * tests went green — and Mongoose discarded both keys on the way to the
 * database, because the sub-schema declares only `field`/`from`/`to`. The stored
 * row said which field moved and never from what to what.
 *
 * So these cases run the real `AuditChangedField` schema and assert on the
 * document AFTER Mongoose has validated and cast it. No database is touched: a
 * `Model` hydrates and applies its schema in memory, which is exactly the step
 * that was dropping the data.
 */
import { Schema, model } from 'mongoose';

import { AuditChangedField } from '@/modules/hooks';
import { SchemaFactory } from '@nestjs/mongoose';

/** The real sub-schema, wrapped in a throwaway parent so it can be hydrated. */
const ChangedFieldSchema = SchemaFactory.createForClass(AuditChangedField);
const ProbeModel = model(
  'AuditFromToProbe',
  new Schema({ changed_fields: [ChangedFieldSchema] }),
);

/** What the collection would receive, after schema casting. */
const stored = (
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> =>
  new ProbeModel({ changed_fields: rows }).toObject()
    .changed_fields as unknown as Array<Record<string, unknown>>;

/** First stored row — asserted on directly, so a dropped row fails loudly. */
const first = (rows: Array<Record<string, unknown>>) => {
  const out = stored(rows);
  expect(out).toHaveLength(1);
  return out[0] as Record<string, unknown>;
};

describe('changed_fields survive the schema', () => {
  it('from/to reach the document', () => {
    expect(stored([{ field: 'api_key', from: 'k1', to: 'k2' }])).toEqual([
      { field: 'api_key', from: 'k1', to: 'k2' },
    ]);
  });

  /* The defect, pinned. If someone reintroduces legacy's key names, this is the
     test that says the values will vanish — rather than a green suite and an
     audit log that answers nothing. */
  it('old_value/new_value are DROPPED — the row keeps only the field name', () => {
    expect(
      stored([{ field: 'api_key', old_value: 'k1', new_value: 'k2' }]),
    ).toEqual([{ field: 'api_key' }]);
  });

  it('arrays survive, so a scope change records both id lists', () => {
    const row = first([
      { field: 'group_providers', from: ['g1'], to: ['g1', 'g2'] },
    ]);

    expect(row.from).toEqual(['g1']);
    expect(row.to).toEqual(['g1', 'g2']);
  });

  /* `status` moving false→true must not be mistaken for "nothing recorded".
     Mixed keeps booleans, including the falsy one. */
  it('booleans survive, including false', () => {
    const row = first([{ field: 'status', from: true, to: false }]);

    expect(row.from).toBe(true);
    expect(row.to).toBe(false);
  });

  it('an empty string is stored, not silently turned into absent', () => {
    expect(first([{ field: 'api_key', from: 'k1', to: '' }]).to).toBe('');
  });
});
