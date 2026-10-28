/**
 * [PERF-20260821-MEMBERSEARCH] The member schema carries the buckets through the
 * same two doors `mirrorPair` uses — save/validate and the update family — and
 * the legacy row is untouched. Real Mongoose model, no database.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { model } from 'mongoose';

import { MemberSchema } from '@/modules/chat';

const schemaSource = readFileSync(
  join(process.cwd(), 'src/modules/chat/schemas/member.schema.ts'),
  'utf8',
);

const Member = model('MemberSearchSpec', MemberSchema);

describe('⭐ seamless: a row written without searchable values carries no `search` key', () => {
  it('a document with NO searchable value at all gets NO `search` key — even after validate', async () => {
    const doc = new Member({ picture_url: 'x' });
    await doc.validate().catch(() => undefined); // required-field errors are irrelevant here
    expect('search' in (doc.toObject() as object)).toBe(false);
  });
  it('…but the LINE id alone IS searchable (the ticket search reads member_user_id), so it gets its bucket', async () => {
    const doc = new Member({ line_user_id: 'U1', member_user_id: 'U1' });
    await doc.validate();
    const s = (doc.toObject() as { search?: Record<string, string[]> }).search;
    expect(s?.member_user_id).toEqual(['u1']);
    expect(s?.full_name).toEqual([]);
  });
  it('the prop is select:false — a member returned whole never carries the buckets (review finding)', () => {
    const path = MemberSchema.path('search') as unknown as {
      options?: { select?: boolean };
    };
    expect(path.options?.select).toBe(false);
  });
  it('the prop is declared WITHOUT a default', () => {
    const path = MemberSchema.path('search') as unknown as {
      defaultValue?: unknown;
      options?: { default?: unknown };
    };
    expect(path).toBeDefined();
    expect(path.defaultValue).toBeUndefined();
    expect(path.options?.default).toBeUndefined();
  });
});

describe('the validate door (save / create)', () => {
  it('validate() derives every bucket from the document (validateSync does not run middleware — by design)', async () => {
    const doc = new Member({
      line_user_id: 'U1',
      display_name: 'Sz',
      full_name: 'สมชาย ใจดี',
      phone_number: '0875550016',
    });
    await doc.validate();
    const s = (doc.toObject() as { search?: Record<string, string[]> }).search;
    expect(s?.display_name).toEqual(['sz']);
    expect(s?.full_name).toEqual(['สมชาย ใจดี', 'สมชาย', 'ใจดี']);
    expect(s?.phone_number).toEqual([
      '0875550016',
      '75550016',
      '550016',
      '0016',
    ]);
    expect(s?.profile).toEqual([]);
  });
});

describe('the update door (findOneAndUpdate / updateOne / updateMany)', () => {
  /* Query middleware only runs inside exec(), which needs a connection; the
     derivation itself is pinned in member-search-tokens.spec.ts, and the live
     round trip (real updateOne → read the row) is recorded in the task note.
     What is pinned HERE is the WIRING: the helper is registered on exactly the
     three update verbs, the same three mirrorPair uses. */
  it('applySearchBucketsToUpdate is registered on the update family', () => {
    const at = schemaSource.indexOf('applySearchBucketsToUpdate(update');
    expect(at).toBeGreaterThan(-1);
    const before = schemaSource.slice(Math.max(0, at - 600), at);
    expect(before).toContain("['findOneAndUpdate', 'updateOne', 'updateMany']");
    expect(before).toContain('this.getUpdate()');
  });
  it('searchBucketsForDoc is registered on validate', () => {
    const at = schemaSource.indexOf('searchBucketsForDoc(this)');
    expect(at).toBeGreaterThan(-1);
    expect(schemaSource.slice(Math.max(0, at - 200), at)).toContain(
      "pre('validate'",
    );
  });
});

describe('the index', () => {
  it('ONE wildcard index over search.$** — every bucket, multikey, prefix-regex-servable', () => {
    const idx = MemberSchema.indexes().map(([k]) => JSON.stringify(k));
    expect(idx).toContain(JSON.stringify({ 'search.$**': 1 }));
    expect(idx.filter((k) => k.includes('search.'))).toHaveLength(1);
  });
});
