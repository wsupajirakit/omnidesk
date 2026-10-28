/**
 * [FEAT-20260829-CLEARFEEDBACK] pressing Clear must SAY what happened.
 *
 * Owner, 29/08: "เวลากดเคลียร์ strike หน้า ticket panel ขวา ให้แสดงว่าสำเร็จหรือไม่
 * ถ้าสำเร็จปิด modal strike ให้ด้วย".
 *
 * Before this, `clear()` awaited the request and then did nothing visible: no
 * banner, and the confirm box stayed open exactly as it was. An admin could not
 * tell a success from a dead click, so the natural move was to press again — a
 * second clear on a session that was already cleared.
 *
 * ⚠️ THE PART THAT IS EASY TO GET WRONG: the confirm must close ONLY on success.
 * Closing it in a `finally` also dismisses it on failure, which hides the error
 * the admin needs and makes a failed clear look done. The cases below pin that
 * asymmetry, and the source census pins that the close really sits in the try.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The state machine `clear()` implements, isolated from the component. */
type Notice = 'ok' | 'failed' | null;
interface UI {
  notice: Notice;
  confirmOpen: boolean;
  consent: boolean;
}

const runClear = async (
  ui: UI,
  request: () => Promise<void>,
): Promise<UI> => {
  const next: UI = { ...ui, notice: null };
  try {
    await request();
    next.confirmOpen = false;
    next.consent = false;
    next.notice = 'ok';
  } catch {
    next.notice = 'failed';
  }
  return next;
};

const open: UI = { notice: null, confirmOpen: true, consent: true };
const ok = () => Promise.resolve();
const fail = () => Promise.reject(new Error('boom'));

describe('[CLEARFEEDBACK] a successful clear', () => {
  it('⭐ says it succeeded', async () => {
    expect((await runClear(open, ok)).notice).toBe('ok');
  });

  it('⭐⭐ closes the confirm box', async () => {
    expect((await runClear(open, ok)).confirmOpen).toBe(false);
  });

  it('forgets the consent tick, so the next clear must be re-confirmed', async () => {
    expect((await runClear(open, ok)).consent).toBe(false);
  });
});

describe('[CLEARFEEDBACK] a failed clear', () => {
  it('⭐ says it failed', async () => {
    expect((await runClear(open, fail)).notice).toBe('failed');
  });

  it('⭐⭐⭐ KEEPS the confirm box open — a failure must not look done', async () => {
    expect((await runClear(open, fail)).confirmOpen).toBe(true);
  });

  it('keeps the consent tick so the admin can just press again', async () => {
    expect((await runClear(open, fail)).consent).toBe(true);
  });
});

describe('[CLEARFEEDBACK] a stale outcome never misleads', () => {
  it('the previous result is wiped when a new clear starts', async () => {
    const after = await runClear({ ...open, notice: 'failed' }, ok);
    expect(after.notice).toBe('ok');
  });

  it('a success banner does not survive into the next attempt', async () => {
    const after = await runClear({ ...open, notice: 'ok' }, fail);
    expect(after.notice).toBe('failed');
  });
});

describe('[CLEARFEEDBACK] the component really implements it', () => {
  const src = () =>
    readFileSync(
      join(__dirname, '..', 'components/common/strike/StrikeStatsModal.tsx'),
      'utf8',
    );

  /** The body of `clear()`, so assertions cannot match `block()` by accident. */
  const clearBody = () => {
    const s = src();
    const start = s.indexOf('const clear = async');
    const end = s.indexOf('const block = async', start);
    expect(start).toBeGreaterThan(-1);
    return s.slice(start, end);
  };

  it('⭐⭐⭐ the confirm closes inside the TRY, never in a finally', () => {
    const body = clearBody();
    const close = body.indexOf('setClearOpen(false)');
    const cat = body.indexOf('} catch');
    expect(close).toBeGreaterThan(-1);
    expect(close).toBeLessThan(cat); // i.e. on the success path only
  });

  it('both outcomes are reported', () => {
    const body = clearBody();
    expect(body).toContain("setNotice('ok')");
    expect(body).toContain("setNotice('failed')");
  });

  it('opening the box wipes a stale outcome', () => {
    /* [FIX-20261019-STALEPIN] the pin counted indentation (18 spaces). Commit 9d8b049 (17/09) wrapped
       the button in a fragment, the same two lines gained two spaces and the case went red while
       the behaviour — clear the old outcome, THEN open the box — was untouched. Whitespace is no
       longer part of the assertion; the order still is. */
    expect(src()).toMatch(/setNotice\(null\);\s*setClearOpen\(true\);/);
  });

  it('the banner is rendered, with both wordings', () => {
    const s = src();
    expect(s).toContain("t('strike.clear_ok')");
    expect(s).toContain("t('strike.clear_failed')");
  });
});

describe('[CLEARFEEDBACK] every language has the wording', () => {
  it.each(['th', 'en', 'it', 'zh'])('%s carries both keys', (lang) => {
    const dict = JSON.parse(
      readFileSync(join(__dirname, '..', `i18n/translations/${lang}.json`), 'utf8'),
    ) as Record<string, string>;
    /* A missing key renders as the raw key on screen — "strike.clear_ok" is
       what the admin would read. */
    expect(dict['strike.clear_ok']?.trim()).toBeTruthy();
    expect(dict['strike.clear_failed']?.trim()).toBeTruthy();
  });
});
