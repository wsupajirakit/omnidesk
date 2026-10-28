/**
 * [FEAT-20260820-PLATE] `plates` — system-assigned labels a broadcast can query
 * ===========================================================================
 * Owner, 2026-08-20: "อนาคตเราจะทำ deposit tag กับ member และ tag อื่น ๆ · เราจะใช้
 * broadcast function หา member ทุกคนที่มี tag deposit แล้วมาไล่ยิง broadcast จาก
 * member line user id ที่คิวรี่ได้ ... additive seamless no migrate optional
 * ห้ามกระทบ" and then "seamless 100% นะ".
 *
 * WHY A NEW FIELD AND NOT THE TAG SYSTEM WE ALREADY HAVE. `tags` + `customer_tags`
 * already answer "which members carry label X", so this had to justify itself:
 *
 *   customer_tags — an ADMIN's label. It has an identity of its own (colour,
 *     group scope, use_count, renameable), and the answer costs two hops:
 *     customer_tags.find({tag_id}) → member_id[] → members.find({_id: {$in: […]}}).
 *     That `$in` grows with the audience, which is exactly the wrong shape for a
 *     broadcast.
 *   plates — a SYSTEM's label. No identity, just a word, and the answer is one
 *     indexed query: members.find({ plates: 'deposit' }).
 *
 * Different writer, different question, different cost. The word "plate" is the
 * owner's, chosen so it cannot be confused with the tag system beside it.
 *
 * ⚠️ THE MONGOOSE TRAP THIS FILE EXISTS TO PIN. An array path gets a default of
 * `[]` unless `default: undefined` is passed — mongoose's own source says so
 * (`lib/schema/array.js:110`: `if (!('defaultValue' in this) || …) this.default(…)`,
 * whose function returns `[]`). Without it EVERY new member would be written with
 * `plates: []`, `$exists` would be true for the whole collection, and the partial
 * index below would stop being partial. The array default is silent, which is why
 * it is asserted here and not trusted to a comment.
 * ไม่ใส่ default: undefined = mongoose ยัด [] ให้เอง แล้ว index จะกินทั้ง collection.
 *
 * revert: delete the prop and its index from `member.schema.ts`, delete this file.
 * No data has ever been written, so there is nothing to undo.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { model } from 'mongoose';

import { MemberSchema } from '@/modules/chat/schemas/member.schema';

const FIELD = 'plates';

const schemaSource = readFileSync(
  join(process.cwd(), 'src/modules/chat/schemas/member.schema.ts'),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

const Member = model('PlateProbeMember', MemberSchema);

describe('⭐ seamless: a member that was never plated carries no field at all', () => {
  it('a brand new document does NOT get the field', () => {
    /* THE load-bearing case. `[]` here would mean every future member matches
       `$exists: true` and the partial index becomes the collection.
       เอกสารใหม่ต้องไม่มี field นี้เลย. */
    const fresh = new Member({}).toObject() as unknown as Record<
      string,
      unknown
    >;
    expect(FIELD in fresh).toBe(false);
  });

  it('the prop is declared with `default: undefined`, which is what makes that true', () => {
    expect(schemaSource).toMatch(
      new RegExp(`type:\\s*\\[String\\][^}]*default:\\s*undefined`),
    );
  });

  it('an existing member document is unchanged by the schema knowing about it', () => {
    /* the 850 members already in the collection have no such key; reading one
       back through this schema must not invent one. แถวเดิมต้องไม่ถูกแตะ. */
    const legacy = new Member({
      line_user_id: 'U1',
      display_name: 'เก่า',
    }).toObject() as unknown as Record<string, unknown>;
    expect(FIELD in legacy).toBe(false);
  });

  it('but it stores what it is given, in order, when something does plate a member', () => {
    const doc = new Member({
      [FIELD]: ['deposit', 'withdraw'],
    }).toObject() as unknown as {
      plates?: string[];
    };
    expect(doc.plates).toEqual(['deposit', 'withdraw']);
  });

  it('and it is typed as strings — a number is cast, not stored raw', () => {
    const doc = new Member({ [FIELD]: [1] }).toObject() as unknown as {
      plates?: unknown[];
    };
    expect(doc.plates).toEqual(['1']);
  });
});

describe('⭐ the broadcast query is the reason it exists', () => {
  it('is indexed, partially, on $exists — so it holds only plated members', () => {
    /* a plain index would carry an entry for every member; this one grows with
       the plated few. Same shape as the follow-up indexes beside it. */
    const decl = schemaSource.slice(
      schemaSource.indexOf(`MemberSchema.index(\n  { ${FIELD}: 1 }`),
    );
    expect(decl.slice(0, 300)).toContain('partialFilterExpression');
    expect(decl.slice(0, 300)).toContain(`${FIELD}: { $exists: true }`);
    expect(decl.slice(0, 300)).toContain('background: true');
  });

  it('⭐ the index is NOT compounded with line_user_id — that would buy nothing', () => {
    /* a multikey index cannot cover a query (MongoDB's own rule), so adding
       `line_user_id` to it would enlarge the index without saving the document
       fetch. index ใหญ่ขึ้นฟรี ๆ = หนี้.
       ⚠️ the slice ends at this declaration's own `);` — a wider window ran into
       the mirror-pair hooks below, which mention `line_user_id` legitimately. */
    const from = schemaSource.indexOf(`MemberSchema.index(\n  { ${FIELD}: 1 }`);
    const decl = schemaSource.slice(from, schemaSource.indexOf('\n);', from));
    expect(from).toBeGreaterThan(-1);
    expect(decl).toContain(FIELD);
    expect(decl).not.toContain('line_user_id');
  });
});

describe('⭐ nothing writes it yet — on purpose', () => {
  it('no code outside the schema mentions it, so no behaviour can have changed', () => {
    /* the owner asked for the field ahead of the feature. If this ever goes red,
       a writer appeared and this spec should grow to cover what it writes.
       ยังไม่มีใครเขียน ⇒ พฤติกรรมวันนี้เปลี่ยนไม่ได้เลย. */
    const hits = execHits();
    expect(hits).toEqual([]);
  });
});

function execHits(): string[] {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { execSync } =
    require('node:child_process') as typeof import('node:child_process');
  const out = execSync(
    `grep -rln "\\b${FIELD}\\b" --include="*.ts" src/ || true`,
    { encoding: 'utf8' },
  ).trim();
  return out
    ? out.split('\n').filter((f) => !f.endsWith('member.schema.ts'))
    : [];
}
