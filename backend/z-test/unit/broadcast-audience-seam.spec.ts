/**
 * [FEAT-20260823-BCASTAUDFE] 🔌 THE AUDIENCE SEAM, from the backend side.
 * ===========================================================================
 * เจ้าของสั่ง 23/08: *"fe+be ตรงสวมท่อต้องบอกกันตลอด จะได้อัพเดทเงื่อนไขจริงให้ทัน
 * ป้องกัน error / ตกหล่น ส่งผิดค่า"*
 *
 * The dashboard has the mirror of this file
 * (`omnidesk-console/test/audienceSeamDrift.value.test.ts`). BOTH exist on
 * purpose: each repo can be cloned and tested alone, so a guard that lives
 * only on one side is absent exactly when that side is the one being changed.
 *
 * 🔴 WHAT THIS PINS: the shape that LEAVES this service. The registry's own
 *    contents are deliberately NOT pinned — adding a field is meant to be one
 *    entry and nothing else, and a test listing the keys would turn every
 *    addition into a two-file edit. ปักหมุดสัญญา ไม่ใช่รายการ.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AUDIENCE_SOURCES } from '@/modules/content';

const SRC = join(__dirname, '..', '..', 'src', 'modules', 'content');

/** Comments stripped: a rule must be asserted against code, never prose. */
const readCode = (rel: string): string =>
  readFileSync(join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[^\n'"`]*\/\/.*$/gm, (l) => l.slice(0, l.indexOf('//')));

describe('🔌 audience seam — what the dashboard is allowed to rely on', () => {
  it('🔴 every source is sent with the SAME set of wire fields', () => {
    /* A source that quietly lacks one would reach the form as `undefined` and
       be treated as "false"/"fast", with no error. ทุกแถวต้องมีฟิลด์ครบเท่ากัน. */
    const rows = Object.values(AUDIENCE_SOURCES);
    expect(rows.length).toBeGreaterThan(0);
    for (const s of rows) {
      expect(typeof s.key).toBe('string');
      expect(s.key).not.toBe('');
      expect(typeof s.label_th).toBe('string');
      expect(typeof s.label_en).toBe('string');
      expect(Array.isArray(s.ops)).toBe(true);
      expect(s.ops.length).toBeGreaterThan(0);
      expect(typeof s.scope_by_hook).toBe('boolean');
      expect(typeof s.indexed).toBe('boolean');
    }
  });

  it('🔴 the map key and the entry`s own `key` never disagree', () => {
    /* `getAudienceSource()` looks up by the MAP key while the job stores the
       entry's `key`. If they diverge, a saved job stops resolving and the
       filter is refused — the campaign simply stops sending. */
    for (const [mapKey, s] of Object.entries(AUDIENCE_SOURCES)) {
      expect(s.key).toBe(mapKey);
    }
  });

  it('🔴 no source on `members` claims it can scope itself by OA', () => {
    /* `members` carries no `hook_id` at all — the ids must be narrowed through
       `chat_rooms`. A `true` here would skip that narrowing and reach members
       of OTHER OAs. ส่งข้าม OA คือความผิดที่กู้ไม่ได้. */
    for (const s of Object.values(AUDIENCE_SOURCES)) {
      if (s.scope_by_hook) {
        // A source may only claim this if it reads a collection storing the OA.
        expect(s.path).not.toMatch(/^(display_name|full_name|phone_number)$/);
      }
    }
  });

  it('🔴 `exists` is offered by no source — it destroys a covered read', () => {
    for (const s of Object.values(AUDIENCE_SOURCES)) {
      expect(s.ops).not.toContain('exists');
    }
  });
});

describe('🔌 audience seam — the rename must stay deliberate', () => {
  /**
   * ⚠️ READS BOTH HALVES OF THE SERVICE. `listAudienceSources` moved to
   * `broadcasts-read.service.ts` on 23/08 when the class was split at the line
   * ratchet, and a guard pinned to one FILENAME goes red for an ordinary move
   * — noise that teaches people to ignore it. The property is where the rename
   * happens, not which file holds it.
   * ผูกกับพฤติกรรม ไม่ใช่กับชื่อไฟล์.
   */
  const service =
    readCode('broadcasts.service.ts') + readCode('broadcasts-read.service.ts');

  it('🔴 `scope_by_hook` leaves as `requires_hook_scope`', () => {
    /* The dashboard reads the WIRE name. Renaming either side without the
       other reads `undefined` for every source, with no error anywhere — the
       dashboard's mirror test pins the same line from its side.
       เปลี่ยนชื่อฝั่งเดียว = อีกฝั่งอ่านได้ undefined เงียบ ๆ. */
    expect(service).toContain('requires_hook_scope: s.scope_by_hook');
  });

  it('🔴 `deprecated` is forwarded, or retiring a source does nothing', () => {
    /* The registry says to set `deprecated` instead of deleting an entry live
       jobs reference. That instruction only means something if the flag
       reaches the form — otherwise a retired field keeps being offered.
       ตั้งธงแล้วไม่ส่งออกไป = ไม่มีผลอะไรเลย. */
    expect(service).toMatch(/deprecated\?: boolean/); // declared…
    expect(service).toMatch(/\{ deprecated: true \}/); // …AND actually sent
  });
});
