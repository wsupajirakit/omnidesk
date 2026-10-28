/* [FIX-20260821-MUIDINDEX] the new-name column finally gets an index
 * ===========================================================================
 * `[FIX-20260808-DUALWRITE]` cut READS over to `member_user_id` while leaving
 * the unique constraint on `line_user_id` until the rename cuts over. The index
 * never followed the reads, so five `findOne({ member_user_id })` calls on the
 * LIVE WEBHOOK PATH have been collection scans ever since.
 *
 * Measured on a throwaway collection, worst case (the match is the last row):
 *     1,000 rows → scanned 1,000 (0ms) · 50,000 → 50,000 (9ms)
 *   200,000 rows → scanned 200,000 (39ms) · with the index, 1 document, 0ms.
 *
 * What these cases hold in place:
 *   1. the index exists and is NOT unique — a unique one would fail to build
 *      the day two legacy rows carry no value, since both would collide on null;
 *   2. it is sparse, so those rows stay out of it entirely;
 *   3. the mirror that fills the column still runs on BOTH hooks — the index is
 *      only useful because every row really carries the value.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const noComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const SCHEMA = 'src/modules/chat/schemas/member.schema.ts';
const code = () => noComments(src(SCHEMA));

describe('⭐ member_user_id is indexed, and indexed correctly', () => {
  it('⭐ the index is declared', () => {
    expect(code()).toMatch(
      /MemberSchema\.index\(\{\s*member_user_id:\s*1\s*\}/,
    );
  });

  it('⭐ it is NOT unique — a unique one would break the build on legacy rows', () => {
    /* the @Prop says the constraint stays on line_user_id until cutover; two
       rows with no value would collide on `null` and the build would fail. */
    const line = code()
      .split('\n')
      .find((l) => l.includes('MemberSchema.index({ member_user_id'));
    expect(line).toBeTruthy();
    expect(line).not.toContain('unique');
  });

  it('⭐ it is sparse, so rows the mirror missed stay out of it', () => {
    const line = code()
      .split('\n')
      .find((l) => l.includes('MemberSchema.index({ member_user_id'));
    expect(line).toContain('sparse: true');
  });

  it('it matches the shape of its neighbours', () => {
    /* phone_number / full_name / display_name are all background+sparse. */
    const line = code()
      .split('\n')
      .find((l) => l.includes('MemberSchema.index({ member_user_id'));
    expect(line).toContain('background: true');
  });
});

describe('⭐ the column it indexes is still filled on every write', () => {
  it('⭐ the mirror runs on validate AND on the update hooks', () => {
    /* an index over a column that stops being written is worse than none: it
       costs writes and answers nothing. */
    const c = code();
    expect(c).toMatch(/pre\('validate'/);
    expect(c).toContain("mirrorPair(this, 'line_user_id', 'member_user_id')");
    expect(c).toMatch(
      /pre\(\s*\[\s*'findOneAndUpdate',\s*'updateOne',\s*'updateMany'\s*\]/,
    );
    expect(c).toContain("'line_user_id',\n      'member_user_id',");
  });

  it('⭐ nothing writes members past the mirror', () => {
    /* `bulkWrite`, `insertMany` and the raw driver all skip Mongoose middleware.
       If one appears, rows can be created without the value and this index
       silently stops covering them. */
    const hits = String(
      execSync(
        "grep -rnE 'memberModel\\.(bulkWrite|insertMany)|memberModel\\.collection\\.(insert|update|bulkWrite)' --include='*.ts' src || true",
        { encoding: 'utf8' },
      ),
    )
      .split('\n')
      .filter(Boolean);
    expect(hits).toEqual([]);
  });
});

describe('⭐ the reads this index exists for are still there', () => {
  it('⭐ the live-path callers still query by member_user_id', () => {
    /* if these all moved back to line_user_id the index is dead weight and
       should be dropped rather than left to cost writes. */
    const callers = [
      'src/modules/webhook/webhook.service.ts',
      'src/modules/webhook/assist/assist-notification.ts',
      'src/modules/chat/chat-history.service.ts',
      'src/modules/chat/chat.service.ts',
    ];
    const without = callers.filter(
      (f) => !/findOne\(\{\s*member_user_id/.test(noComments(src(f))),
    );
    expect(without).toEqual([]);
  });
});
