/**
 * [FEAT-20260830-STRIKEWORD] the owner standardised the blocked wording.
 *
 * Owner 30/08: "ล็อก = บล็อค" everywhere, the tray title gains the (บล็อค)
 * qualifier, and the row counter reads "โดนลิมิตแล้ว N ครั้ง Blocked".
 *
 * Split out of `suspendedMuteAlert.value.test.tsx` on the same day: the mute
 * switch and this wording are separate pieces of work shipped in separate
 * commits, and a test file that asserts both cannot go green in either commit
 * alone. Same assertions, moved verbatim.
 */
import { describe, it, expect } from 'vitest';

describe('wording — the owner standardised on บล็อค', () => {
  const th = JSON.parse(
    require('fs').readFileSync(
      require('path').resolve(__dirname, '../i18n/translations/th.json'),
      'utf8',
    ),
  ) as Record<string, string>;

  it('the tray title carries the (บล็อค) qualifier', () => {
    expect(th['suspended.title']).toBe('ลูกค้าที่บอทหยุดตอบแล้ว (บล็อค)');
  });

  it('🔴 the suspended/strike strings say บล็อค, never ล็อก', () => {
    /* ⚠️ the naive /ล็อก|ล็อค/ test matched บ+ล็อค inside the CORRECT new word
       and reported a false positive. The check is the bare word with no บ. */
    const strays = Object.entries(th)
      .filter(([k]) => k.startsWith('suspended.') || k.startsWith('strike.'))
      .filter(([, v]) => typeof v === 'string' && /(^|[^บ])ล็อ[กค]/.test(v));
    expect(strays).toEqual([]);
  });

  it('the strike counter reads "โดนลิมิตแล้ว … ครั้ง Blocked"', () => {
    expect(th['suspended.strikes']).toBe('โดนลิมิตแล้ว');
    expect(th['suspended.strikes_unit']).toBe('ครั้ง');
    expect(th['suspended.strikes_blocked']).toBe('Blocked');
  });

  it('⭐ the number stays row.strike_total — the same value the modal shows big', () => {
    /* owner 30/08, asked and answered: "เลขเดิม". `SuspendedRow` renders the
       suspended session's own strike_total, which is exactly what
       StrikeStatsModal reads into its large counter (`current.strike_total`).
       Deliberately NOT the modal's `shownUsed` (cap/cap while locked) and NOT
       `lifetime` (all sessions summed). */
    const row = require('fs').readFileSync(
      require('path').resolve(__dirname, '../components/common/suspended/SuspendedRow.tsx'),
      'utf8',
    ) as string;
    expect(row).toContain('{row.strike_total}');
    expect(row).not.toContain('shownUsed');
    expect(row).not.toContain('lifetime');
  });
});
