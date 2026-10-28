/* [FEAT-20260830-AUDITLINEID] what the audit note actually says
 * ===========================================================================
 * Owner 30/08 asked for this exact wording:
 *
 *   หยุดติดตามฝาก/ถอน — เคลียร์ตอนปิดเคส #<ticket> · Channel LINE user <id>
 *
 * WHY IT IS PINNED. The note is the ONLY part of an audit row a person reads
 * without expanding it, and it is the only place the customer is named at all —
 * `ref_id` holds a Mongo `_id` that nobody recognises. A silent reword makes
 * every future row answer a slightly different question from every past one,
 * and nothing else in the suite would notice.
 *
 * Both builders are pure functions taking their inputs as arguments, so these
 * are real calls — no Nest container, no fake audit writer.
 */
import { buildClearFollowUpNote } from '@/modules/tickets/patch-after-close.helper';
import { buildFollowStampNote } from '@/modules/chat';

const LINE_ID = 'Ucbf2e07a9876382beee480619b453eac';
const TICKET = 'a0d000000000000000000027';

describe('clearing the follow-up stamps when a case is closed', () => {
  it('reads exactly as the owner asked', () => {
    expect(buildClearFollowUpNote(TICKET, LINE_ID)).toBe(
      `หยุดติดตามฝาก/ถอน — เคลียร์ตอนปิดเคส #${TICKET} · Channel LINE user ${LINE_ID}`,
    );
  });

  it('names the channel, not just "LINE user"', () => {
    expect(buildClearFollowUpNote(TICKET, LINE_ID)).toContain(
      'Channel LINE user',
    );
  });

  it('carries the ticket so the row can be traced back', () => {
    expect(buildClearFollowUpNote(TICKET, LINE_ID)).toContain(`#${TICKET}`);
  });

  it('says nothing about an id it does not have — never prints undefined', () => {
    [undefined, null, '', '   '].forEach((v) => {
      const note = buildClearFollowUpNote(TICKET, v);
      expect(note).toBe(`หยุดติดตามฝาก/ถอน — เคลียร์ตอนปิดเคส #${TICKET}`);
      expect(note).not.toMatch(/undefined|null|Channel/);
    });
  });

  it('trims a padded id rather than embedding the padding', () => {
    expect(buildClearFollowUpNote(TICKET, `  ${LINE_ID}  `)).toBe(
      `หยุดติดตามฝาก/ถอน — เคลียร์ตอนปิดเคส #${TICKET} · Channel LINE user ${LINE_ID}`,
    );
  });
});

/* [FIX-20260901-NOTESAYSWHAT] the note must name what was actually cleared.
 * Before this, every row said "ฝาก/ถอน" — including rows that cleared only the
 * withdraw stamp, and rows that cleared only the three registration stamps.
 * The five cases above still pass unchanged: with no keys the sentence falls
 * back to the original wording, which is what an older caller produces. */
describe('the note names the follow-up that was actually stopped', () => {
  const DEP = 'follow_up.line.notice_deposit_at';
  const WD = 'follow_up.line.notice_withdraw_at';
  const ABANDON = 'follow_up.line.abandon_trigger_at';
  const REQ = 'follow_up.line.request_reg_at';
  const HELPER = 'follow_up.line.customer_helper_trigger_at';
  const subject = (keys?: readonly string[]) =>
    buildClearFollowUpNote(TICKET, null, keys).split(' — ')[0];

  it('deposit only says deposit', () => {
    expect(subject([DEP])).toBe('หยุดติดตามฝาก');
  });

  it('withdraw only says withdraw — the row that exposed the bug', () => {
    expect(subject([WD])).toBe('หยุดติดตามถอน');
  });

  it('both sides read as the familiar pair, not a list', () => {
    expect(subject([DEP, WD])).toBe('หยุดติดตามฝาก/ถอน');
    expect(subject([WD, DEP])).toBe('หยุดติดตามฝาก/ถอน');
  });

  it('the three registration stamps collapse to one subject', () => {
    expect(subject([ABANDON, REQ, HELPER])).toBe('หยุดติดตามการสมัคร');
  });

  it('a mixed plan names both subjects', () => {
    expect(subject([DEP, ABANDON])).toBe('หยุดติดตามฝาก และ การสมัคร');
  });

  it('no keys, an empty list, or an unknown key keep the old wording', () => {
    expect(subject(undefined)).toBe('หยุดติดตามฝาก/ถอน');
    expect(subject([])).toBe('หยุดติดตามฝาก/ถอน');
    expect(subject(['follow_up.line.something_new'])).toBe('หยุดติดตามฝาก/ถอน');
  });

  it('still carries the ticket and the channel id', () => {
    const note = buildClearFollowUpNote(TICKET, LINE_ID, [WD]);
    expect(note).toBe(
      `หยุดติดตามถอน — เคลียร์ตอนปิดเคส #${TICKET} · Channel LINE user ${LINE_ID}`,
    );
  });
});

describe('stamping a follow-up time by hand', () => {
  it('deposit reads as the owner asked', () => {
    expect(buildFollowStampNote('deposit', LINE_ID)).toBe(
      `ติดตามสถานะฝาก — stamped by hand from the customer panel · Channel LINE user ${LINE_ID}`,
    );
  });

  it('withdraw names the withdraw side, not the deposit one', () => {
    const note = buildFollowStampNote('withdraw', LINE_ID);
    expect(note).toContain('ติดตามสถานะถอน');
    expect(note).not.toContain('ติดตามสถานะฝาก');
  });

  it('names the channel here too — both paths must read alike', () => {
    expect(buildFollowStampNote('deposit', LINE_ID)).toContain(
      'Channel LINE user',
    );
    expect(buildFollowStampNote('withdraw', LINE_ID)).toContain(
      'Channel LINE user',
    );
  });

  it('says nothing about an id it does not have', () => {
    [undefined, null, '', '   '].forEach((v) => {
      const note = buildFollowStampNote('deposit', v);
      expect(note).toBe(
        'ติดตามสถานะฝาก — stamped by hand from the customer panel',
      );
      expect(note).not.toMatch(/undefined|null|Channel/);
    });
  });
});

describe('the two notes stay consistent with each other', () => {
  it('both use the same separator and the same phrase', () => {
    const a = buildClearFollowUpNote(TICKET, LINE_ID);
    const b = buildFollowStampNote('deposit', LINE_ID);
    expect(a).toContain(` · Channel LINE user ${LINE_ID}`);
    expect(b).toContain(` · Channel LINE user ${LINE_ID}`);
  });

  it('the id appears exactly once in each', () => {
    const count = (s: string) => s.split(LINE_ID).length - 1;
    expect(count(buildClearFollowUpNote(TICKET, LINE_ID))).toBe(1);
    expect(count(buildFollowStampNote('withdraw', LINE_ID))).toBe(1);
  });
});
