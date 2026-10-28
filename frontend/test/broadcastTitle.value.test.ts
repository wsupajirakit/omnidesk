/**
 * [FEAT-20260823-BCASTTITLE] The save-time guard for the notification line.
 * ===========================================================================
 * ⚠️ This mirrors a BACKEND rule (`resolveTitle` in card-message.builder.ts).
 *    The backend always enforces it; this exists so an admin is told at save
 *    time instead of on a card that already went out. If the two drift, the
 *    backend wins and the form lies — so these cases are written to match its
 *    spec case for case. แก้ฝั่งเดียว = ฟอร์มโกหก.
 */
import { describe, expect, it } from 'vitest';

import {
  TITLE_DEFAULT,
  TITLE_MAX,
  checkBroadcastTitle,
} from '../utils/broadcastTitle';

describe('broadcast title — what an admin may type', () => {
  it('accepts Thai, English and digits', () => {
    for (const ok of ['Promotion 2026', 'โปรโมชั่น เดือนสิงหา', 'VIP 100']) {
      expect(checkBroadcastTitle(ok)).toBeNull();
    }
  });

  it('leaving it blank is not an error — the default line is used', () => {
    expect(checkBroadcastTitle('')).toBeNull();
    expect(checkBroadcastTitle(undefined)).toBeNull();
    expect(checkBroadcastTitle(null)).toBeNull();
    expect(TITLE_DEFAULT).toBe('line messages');
  });
});

describe('broadcast title — what the form must refuse', () => {
  it('🔴 a tag, and it says so by name', () => {
    /* A notification cannot be re-read for context: a tag resolving to N/A
       there reads as a broken app, and an unresolved one ships literal braces
       to a lock screen. หัวข้อไม่ใช่ที่ของ tag. */
    expect(checkBroadcastTitle('{{member.display_name}}')).toBe('has-tag');
    expect(checkBroadcastTitle('สวัสดี {{member.name}}')).toBe('has-tag');
  });

  it('🔴 reports `has-tag` rather than `bad-character` for a tag', () => {
    /* `{` is also a special character, so ORDER decides which message the admin
       reads. One is actionable; the other sends them hunting. */
    expect(checkBroadcastTitle('{{x}}')).toBe('has-tag');
  });

  it('a leading or trailing space', () => {
    expect(checkBroadcastTitle(' โปร')).toBe('edge-space');
    expect(checkBroadcastTitle('โปร ')).toBe('edge-space');
  });

  it('special characters, including emoji', () => {
    for (const bad of ['โปร!', 'sale-2026', '50% off', 'a@b', 'ดี 🎉', 'a_b']) {
      expect(checkBroadcastTitle(bad)).toBe('bad-character');
    }
  });

  it('whitespace only', () => {
    expect(checkBroadcastTitle('   ')).toBe('empty');
  });

  it('over the LINE limit', () => {
    expect(checkBroadcastTitle('ก'.repeat(TITLE_MAX + 1))).toBe('too-long');
    expect(checkBroadcastTitle('ก'.repeat(TITLE_MAX))).toBeNull();
  });
});

describe('broadcast title — the rule must not drift from the backend', () => {
  it('🔴 names the same problems the backend reports', () => {
    /* The backend returns these exact strings on `titleRejected`. A form that
       invents its own vocabulary cannot show what the backend actually said
       about a run that already happened. ต้องใช้คำเดียวกันกับ backend. */
    const problems = ['empty', 'has-tag', 'bad-character', 'edge-space', 'too-long'];
    const seen = [
      checkBroadcastTitle('   '),
      checkBroadcastTitle('{{a}}'),
      checkBroadcastTitle('!'),
      checkBroadcastTitle(' a'),
      checkBroadcastTitle('ก'.repeat(TITLE_MAX + 1)),
    ];
    expect(seen).toEqual(problems);
  });

  it('uses the same limit the backend uses', () => {
    expect(TITLE_MAX).toBe(400);
  });
});
