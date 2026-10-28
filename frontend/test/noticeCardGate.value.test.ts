/* [FEAT-20260822-NOTICEMODE] the D6 card gate on the front end — and a guard
 * that it still says what the BACK END says.
 *
 * The pairs are duplicated by hand (the BE does not serve them), so the real
 * risk is not the logic — it is DRIFT. The last case reads the back end's own
 * source when this checkout sits beside it and compares the two lists field by
 * field; where the BE is not on disk it says so out loud instead of passing
 * quietly. เทสตัวสุดท้ายคือกันสองไฟล์เพี้ยนจากกัน.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  NOTICE_CARD_PAIRS,
  noticeCardViolations,
  readScope,
  readToggle,
  readFlex,
} from '../components/hook/form/noticeCardGate';

const CARD = 'a'.repeat(24);

describe('⭐ readers mirror the back end exactly', () => {
  it('a toggle is a real boolean — "true" the string is OFF', () => {
    expect(readToggle(true)).toBe(true);
    expect(readToggle('true')).toBe(false);
    expect(readToggle(1)).toBe(false);
    expect(readToggle(undefined)).toBe(false);
  });

  it('a scope is text unless it is exactly all or slip', () => {
    expect(readScope('slip')).toBe('slip');
    expect(readScope('all')).toBe('all');
    expect(readScope('text')).toBe('text');
    expect(readScope('SLIP')).toBe('text');
    expect(readScope(undefined)).toBe('text');
  });

  it('an empty card is null, whatever shape the emptiness has', () => {
    expect(readFlex('')).toBeNull();
    expect(readFlex(null)).toBeNull();
    expect(readFlex(undefined)).toBeNull();
    expect(readFlex(CARD)).toBe(CARD);
  });
});

describe('⭐ which cards a state still owes', () => {
  it('everything off = nothing owed', () => {
    expect(noticeCardViolations({})).toEqual([]);
    expect(
      noticeCardViolations({
        notice_deposit_status: false,
        notice_withdraw_status: false,
      }),
    ).toEqual([]);
  });

  it('⭐ deposit ON with scope text owes its two deposit cards — and no more', () => {
    const missing = noticeCardViolations({ notice_deposit_status: true });
    expect(missing.map((p) => p.flex)).toEqual([
      'notice_deposit_flex_id',
      'notice_deposit_offtime_flex_id',
    ]);
  });

  it('⭐ scope slip adds the two ALL cards, and only while it is slip', () => {
    const base = {
      notice_deposit_status: true,
      notice_deposit_flex_id: CARD,
      notice_deposit_offtime_flex_id: CARD,
    };
    expect(noticeCardViolations(base)).toEqual([]);
    const slip = noticeCardViolations({
      ...base,
      notice_deposit_scope: 'slip',
    });
    expect(slip.map((p) => p.flex)).toEqual([
      'notice_all_offtime_flex_id',
      'notice_all_disable_flex_id',
    ]);
    // switching the scope away releases them again
    expect(
      noticeCardViolations({ ...base, notice_deposit_scope: 'all' }),
    ).toEqual([]);
  });

  it('⭐ the withdraw side is judged independently', () => {
    const missing = noticeCardViolations({
      notice_withdraw_status: true,
      notice_withdraw_flex_id: CARD,
    });
    expect(missing.map((p) => p.flex)).toEqual([
      'notice_withdraw_offtime_flex_id',
    ]);
  });

  it('⭐ it reports EVERY violation, not just the first (that is the point)', () => {
    const missing = noticeCardViolations({
      notice_deposit_status: true,
      notice_withdraw_status: true,
      notice_deposit_scope: 'slip',
    });
    expect(missing).toHaveLength(6);
  });
});

describe('⭐ drift guard — the pairs must match the back end', () => {
  const BE = join(
    process.cwd(),
    '..',
    'backend',
    'src/modules/hooks/notice-settings/notice-settings.fields.ts',
  );

  it('⭐ same pairs, same order, as omnidesk-api NOTICE_CARD_PAIRS', () => {
    if (!existsSync(BE)) {
      /* not a silent pass: say which check did not run and why. */
      expect(`SKIPPED — back end not at ${BE}`).toContain('SKIPPED');
      return;
    }
    const src = readFileSync(BE, 'utf8');
    const block = src.slice(
      src.indexOf('export const NOTICE_CARD_PAIRS'),
      src.indexOf('export interface NoticeChange'),
    );
    const bePairs = [...block.matchAll(/status:\s*'([^']+)',\s*\n\s*flex:\s*'([^']+)'/g)]
      .map((m) => `${m[1]}→${m[2]}`);
    expect(bePairs.length).toBe(6);
    expect(NOTICE_CARD_PAIRS.map((p) => `${p.status}→${p.flex}`)).toEqual(
      bePairs,
    );
    // and the two scope-conditional ones are conditional there too
    const scoped = [...block.matchAll(/whenScope:\s*\{[^}]*value:\s*'([^']+)'/g)];
    expect(scoped).toHaveLength(2);
    expect(
      NOTICE_CARD_PAIRS.filter((p) => p.whenScope?.value === 'slip'),
    ).toHaveLength(2);
  });
});
