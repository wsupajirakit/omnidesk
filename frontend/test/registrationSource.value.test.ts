/**
 * [FEAT-20260819-REGSOURCE] "ลงทะเบียนโดย" — what the operator actually reads.
 *
 * The failure this guards against is not a crash: it is the panel confidently
 * saying "ลูกค้าลงทะเบียนเอง" about a registration an admin made, or blanking a
 * value the BE did send. Both look fine on screen and are wrong.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ticketChatPageWithPieces } from './ticketChatSource';
import { join } from 'node:path';

import { registrationText } from '../services/chat/registrationSource';

const fmt = (iso?: string | null) => (iso ? '19 ส.ค. 2026 @ 23:49' : '');
const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('registrationText', () => {
  it('an admin registration says แอดมิน, with the time', () => {
    expect(registrationText('admin', '2026-08-19T16:49:50Z', fmt)).toBe(
      'แอดมิน · 19 ส.ค. 2026 @ 23:49',
    );
  });

  it('the customer doing it themselves is NOT labelled as an admin', () => {
    const out = registrationText('member', '2026-08-19T16:49:50Z', fmt);
    expect(out).toContain('ลูกค้าลงทะเบียนเอง');
    expect(out).not.toContain('แอดมิน');
  });

  it('⭐ the OLD name `system` still reads the same as `member`', () => {
    /* [FEAT-20260820-MEMBERSOURCE] the BE renamed `system` → `member` and stopped
       writing the old word, but rows written before that day still hold it. If
       this map ever drops `system`, those customers render as the raw string
       `system` in the panel — a regression an operator sees and no compiler
       catches. แถวเก่าต้องอ่านออกเหมือนเดิม. */
    expect(registrationText('system', null, fmt)).toBe('ลูกค้าลงทะเบียนเอง');
    expect(registrationText('system', null, fmt)).toBe(
      registrationText('member', null, fmt),
    );
  });

  it('the reserved sources read properly the day the BE starts writing them', () => {
    /* `agent_auto` and `other` are accepted by the BE and written by nobody yet.
       Mapping them now means the first row that carries one is readable, instead
       of showing a code until somebody notices. */
    expect(registrationText('agent_auto', null, fmt)).toBe('ระบบทำให้อัตโนมัติ');
    expect(registrationText('other', null, fmt)).toBe('อื่น ๆ');
  });

  it('unknown source (never registered / legacy row) shows nothing, so the row reads "-"', () => {
    expect(registrationText(null, null, fmt)).toBeNull();
    expect(registrationText(undefined, '2026-08-19T16:49:50Z', fmt)).toBeNull();
    expect(registrationText('', null, fmt)).toBeNull();
  });

  it('a source with no time still shows the source — never a bare separator', () => {
    expect(registrationText('admin', null, fmt)).toBe('แอดมิน');
    expect(registrationText('admin', null, fmt)).not.toContain('·');
  });

  it('a source the dashboard has not learned yet renders as itself, not blank', () => {
    // the BE may add a source this file has not learned; swallowing it would
    // look like a bug, so the raw value is shown instead
    expect(registrationText('kiosk', null, fmt)).toBe('kiosk');
  });

  it('⭐ every value the BE can write has a label here', () => {
    /* The cross-repo guard. `REGISTERED_BY` in omnidesk-api is the source of
       truth; a value added there and not here shows the operator a raw code.
       Read from the BE file so the two cannot drift silently.
       ถ้า BE เพิ่มค่าใหม่แล้วลืมมาเพิ่มที่นี่ เทสตัวนี้แดง. */
    const beFile = readFileSync(
      join(
        process.cwd(),
        '../backend/src/modules/customer-link/registration-stamp.helper.ts',
      ),
      'utf8',
    );
    const block = beFile.slice(
      beFile.indexOf('export const REGISTERED_BY'),
      beFile.indexOf('] as const', beFile.indexOf('export const REGISTERED_BY')),
    );
    /* ⚠️ THE CHARACTER CLASS IS PART OF THE GUARD, and it is wider than the
       values currently need — on purpose.
       On 2026-08-21 the BE briefly reserved `semi-admin`, the first value with
       a hyphen. `[a-z_]` did not match it, so this test kept passing while
       checking one value fewer than the BE could write: five against a list of
       six, proven by running both expressions. The value was then renamed to
       `semi_admin` to match the other 260 underscore values in that repo — but
       the class stays widened, because the hole was never about that one value.
       Anything using a character outside this class vanishes from the loop
       below in silence. เพิ่มอักขระใหม่ในค่า = ต้องมาดูบรรทัดนี้ก่อน. */
    /* ONE expression, used twice on purpose — see the note above. It reads the
       BE list, and the very same object is then pointed at a sample the BE does
       not currently hold. Narrow the class and the second use fails, so the
       widening cannot be undone quietly just because today's values happen not
       to need it. A second regex literal would NOT do this: it would only
       assert about itself. เขียนสองตัวคือหลอกตัวเอง ต้องเป็นตัวเดียวกัน. */
    const VALUE_IN_LIST = /'([a-z_-]+)'/g;
    const readWith = (text: string) => {
      VALUE_IN_LIST.lastIndex = 0; // shared /g object — reset before each pass
      return [...text.matchAll(VALUE_IN_LIST)].map((m) => m[1]!);
    };

    const beValues = readWith(block);
    expect(beValues.length).toBeGreaterThan(0);
    expect(beValues).toContain('semi_admin');
    expect(beValues.length).toBe(new Set(beValues).size);
    /* the guard guarding itself: a hyphenated value must still be visible */
    expect(readWith(`['a-b', 'c_d']`)).toEqual(['a-b', 'c_d']);
    for (const v of beValues) {
      // a mapped value never renders as itself; an unmapped one does
      expect({ value: v, label: registrationText(v, null, fmt) }).not.toEqual({
        value: v,
        label: v,
      });
    }
  });

  it('⭐ semi_admin อ่านออกเป็นภาษาคน ไม่ใช่โค้ดดิบ', () => {
    /* Reserved 2026-08-21, written by nobody yet. The label exists BEFORE the
       first row does, so the day something writes it the panel already reads
       properly — which is the whole reason the BE reserves names in advance. */
    expect(registrationText('semi_admin', null, fmt)).toBe('แอดมินช่วยบางส่วน');
    expect(registrationText('semi_admin', null, fmt)).not.toBe('semi_admin');
  });

  it('uses the page clock passed in — no second date format on the same panel', () => {
    const spy = vi.fn().mockReturnValue('X');
    expect(registrationText('admin', '2026-08-19T16:49:50Z', spy)).toBe('แอดมิน · X');
    expect(spy).toHaveBeenCalledWith('2026-08-19T16:49:50Z');
  });
});

describe('the panel actually shows it', () => {
  // [REFACTOR-20261027-TCSPLIT] the page's markup moved into pages/chat/ticket-chat/ — read the
  // page with those pieces (test/ticketChatSource.ts); assertions unchanged
  const page = ticketChatPageWithPieces();

  it('the row exists in BOTH customer-info layouts, not just one', () => {
    // acme_category true and false render different row sets; a field added
    // to one only is invisible for half the OAs
    expect(page.split("label: 'ลงทะเบียนโดย'").length - 1).toBe(2);
  });

  it('it reads the fields the BE writes, spelled exactly', () => {
    expect(page).toContain('registrationText(modalUd?.link_registered_by, modalUd?.link_registered_at, formatRelative)');
  });
});
