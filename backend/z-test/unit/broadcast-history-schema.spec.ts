/**
 * [FEAT-20260823-BCASTHISTSCHEMA] The stored shape, where a default can lie.
 * ===========================================================================
 * `history-row.ts` decides what a row SAYS; this file guards what the schema
 * lets a row say at all. They can disagree silently — an audit measured
 * exactly that through a real Mongoose model, and the schema won.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = 'src/modules/content/schemas/broadcast-history.schema.ts';
const src = readFileSync(join(__dirname, '..', '..', SCHEMA), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** The `@Prop(...)` that immediately precedes a field, and nothing earlier. */
function declOf(field: string): string {
  const at = code.indexOf(`${field}`);
  const propStart = code.lastIndexOf('@Prop(', at);
  return code.slice(propStart, at + field.length + 2);
}

describe('images_replaced — absent and zero are different answers', () => {
  it('🔴 has NO default, or the "not measured" state is erased on write', () => {
    /* `history-row.ts` OMITS the field when nothing looked at the pictures — a
       preview renders nothing, so it measured nothing. `default: 0` filled the
       gap straight back in, so every dry-run row and every broadcast-pipe row
       read as "every picture was fine": the exact lie the omission exists to
       prevent. ไม่มี field = ไม่ได้วัด · เป็น 0 = วัดแล้วไม่มีปัญหา. */
    const decl = declOf('images_replaced');
    expect(decl).not.toMatch(/default:\s*0/);
    expect(decl).toMatch(/images_replaced\?/);
  });

  it('🔴 the comment no longer claims 0 means every picture was usable', () => {
    // It used to. A reader trusting that sentence would read "nobody looked" as
    // "nothing was wrong" — and the sentence sat directly above the default
    // that made the two indistinguishable.
    expect(src).toMatch(/absent = nobody looked/);
  });

  it('counters that are ALWAYS measured keep their default', () => {
    /* Only `images_replaced` carries a "did anyone look?" question. `sent` and
       `failed` are counted on every path, so removing THEIR defaults would be a
       different change with a different justification. */
    for (const field of ['sent', 'failed', 'requests_made']) {
      expect(declOf(field)).toMatch(/default:\s*0/);
    }
  });
});
