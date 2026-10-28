/**
 * [FIX-20260910-DOCLABELS] Every clonable field's label is a key the dashboard
 * can actually translate, and no two different columns wear the same words.
 * ===========================================================================
 * Two failures the clone modal showed the owner on 10/09, both invisible to
 * every existing test because a missing translation is not a crash:
 *
 *   1. THE SAME WORDS THREE TIMES. `suggestion_text`,
 *      `suggestion_company_text` and `suggestion_text_no_profile` all resolved
 *      to `hook_form.suggestion_text` — "Training Document" — so the expanded
 *      list showed three identical rows and ticking one was a coin toss.
 *
 *   2. RAW KEYS ON SCREEN. The reasoning columns fell through to the default
 *      `hook_form.<field>`, and the dashboard had no such key, so the operator
 *      read `hook_form.deepseek_reasoning_effort_translate` verbatim.
 *
 * 🔴 THIS FILE READS THE DASHBOARD'S OWN th.json. The BE cannot translate
 *    anything — it emits a key and trusts the FE to have it — so "the key
 *    exists" is a claim about two repos at once, and the only honest way to
 *    check it is to open the other one. The path is resolved from this repo's
 *    parent, and the case SKIPS (never fails) when the dashboard is not checked
 *    out beside it: a missing sibling is not a broken label.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FIELD_TAB, SENSITIVE_FIELD, labelKeyOf } from '@/modules/hooks';

const DASHBOARD_TH = join(
  process.cwd(),
  '..',
  'omnidesk-console-chattrans',
  'i18n',
  'translations',
  'th.json',
);

const dict = (): Record<string, string> | null =>
  existsSync(DASHBOARD_TH)
    ? (JSON.parse(readFileSync(DASHBOARD_TH, 'utf8')) as Record<string, string>)
    : null;

describe('[CLONE] every field label is translatable, and distinct', () => {
  it('⭐⭐⭐ the three Training Document boxes do NOT share a label', () => {
    const keys = [
      'suggestion_text',
      'suggestion_company_text',
      'suggestion_text_no_profile',
    ].map(labelKeyOf);
    expect(new Set(keys).size).toBe(3);
  });

  it('⭐⭐⭐ EVERY clonable field resolves to a key the dashboard can translate', () => {
    /* 🔴 No allowlist. There was one for a few minutes — 14 fields from other
       features that had never had a label — and the owner's answer was to read
       the real form and translate them, not to record the gap. So the assertion
       is the whole set, and a new field with no label goes red the day it is
       added rather than the day an operator squints at a raw key. */
    const d = dict();
    if (!d) return; // sibling checkout absent — see the header
    const missing = [...Object.keys(FIELD_TAB), ...Object.keys(SENSITIVE_FIELD)]
      .filter((f) => !(labelKeyOf(f) in d))
      .sort();
    expect(missing).toEqual([]);
  });

  it('⭐⭐ no two fields wear the same label — a clone list of duplicates is a coin toss', () => {
    /* The Training Document trio was the case that started this; the six notice
       flags would have been the next one, since the form disambiguates them with
       a section heading a flat list does not have. */
    const keys = [
      ...Object.keys(FIELD_TAB),
      ...Object.keys(SENSITIVE_FIELD),
    ].map(labelKeyOf);
    const seen = new Map<string, number>();
    for (const k of keys) seen.set(k, (seen.get(k) ?? 0) + 1);
    const shared = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    expect(shared).toEqual([]);
  });
});
