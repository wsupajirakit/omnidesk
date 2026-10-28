/**
 * [FIX-2708-DARKFILL-CASCADE] The quota gauge fill in dark theme — three earlier
 * "make the blue lighter" rounds changed nothing, because the problem was the
 * CASCADE, not the shade.
 * ===========================================================================
 * Owner, 27/08 (fourth round on this colour): the dark gauge must read as a light
 * blue, like the flex card.
 *
 * Real cause: `index.html` carries a site-wide dark repaint written with ATTRIBUTE
 * SUBSTRING selectors, e.g.
 *     html.theme-dark [class*="bg-blue-500/"] { background-color: rgba(59,130,246,0.16) !important }
 * Any element merely CARRYING the token `bg-blue-500/70` is repainted to a flat
 * 16%-alpha tint. That rule is `!important` and outranks Tailwind's
 * `.dark\:bg-sky-300:where(.theme-dark,…)` (0,2,1 vs 0,1,0), so the `dark:` utility
 * could never win, whatever shade it named.
 *
 * This test is the regression guard: no background class on the gauge bar may carry
 * a token that index.html traps. It reads BOTH real files and compares them (a
 * cross-file drift guard, same shape as noticeCardGate.value.test.ts) rather than
 * hardcoding the list of override rules.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const GAUGE = readFileSync(resolve(__dirname, '../components/chat/HeaderQuotaGauge.tsx'), 'utf8');
const INDEX_HTML = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

/** Every substring the dark rules in index.html use to trap an element. */
const darkTrapSubstrings = (): string[] => {
  const out = new Set<string>();
  const re = /html\.theme-dark\s*\[class\*="([^"]+)"\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(INDEX_HTML))) out.add(m[1]);
  return [...out];
};

/**
 * Background class literals actually shipped on the gauge bar.
 * Block comments are stripped FIRST — the source comment quotes the old class
 * names on purpose (that is the warning), and counting them would make this test
 * fail on its own documentation.
 */
const gaugeBarBgTokens = (): string[] => {
  const at = GAUGE.indexOf('data-testid="header-quota-bar"');
  expect(at, 'the gauge bar element must be findable').toBeGreaterThan(-1);
  const block = GAUGE.slice(at, GAUGE.indexOf('style={{ width:', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  return [...block.matchAll(/(?:^|[\s'`])((?:dark:)?bg-[^\s'`]+)/g)].map((m) => m[1]);
};

describe('[DARKFILL-CASCADE] the gauge bar must not carry a class index.html traps', () => {
  it('the trap rules still exist in index.html (if they were removed this guard is moot — we must be told)', () => {
    const traps = darkTrapSubstrings();
    expect(traps.length, 'index.html must still carry its [class*=] dark set').toBeGreaterThan(5);
    expect(traps, 'the rule that sank the blue fill').toContain('bg-blue-500/');
    expect(traps, 'the rule that sank the amber fill').toContain('bg-amber-500/');
  });

  it('no background class on the bar is captured by an !important override', () => {
    const traps = darkTrapSubstrings();
    const caught: string[] = [];
    for (const token of gaugeBarBgTokens()) {
      if (token.startsWith('dark:')) continue; // the dark: utility is the victim, not the trapped token
      for (const trap of traps) {
        if (token.includes(trap)) caught.push(`${token}  <- caught by [class*="${trap}"]`);
      }
    }
    expect(caught, `these would be repainted in dark, making dark: useless:\n${caught.join('\n')}`).toEqual([]);
  });

  it('dark stays sky-300, and light keeps the exact colour it had before', () => {
    const tokens = gaugeBarBgTokens();
    expect(tokens, 'light blue, as the owner chose').toContain('dark:bg-sky-300');
    /* #3080ffb3 is what Tailwind compiled for blue-500/70, #f99c00b3 for amber-500/70
       — the light theme must not shift while the dark one is repaired. */
    expect(tokens).toContain('bg-[#3080ffb3]');
    expect(tokens).toContain('bg-[#f99c00b3]');
    /* rose has no trap rule in index.html, so it keeps its original class (minimal diff). */
    expect(tokens).toContain('bg-rose-500/80');
  });
});
