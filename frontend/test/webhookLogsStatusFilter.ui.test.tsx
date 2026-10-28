/* [FIX-20260815-SUPPRESSEDFILTER] the Webhook Logs status filter must offer
 * every status the backend can store — right now it cannot offer `suppressed`.
 * ===========================================================================
 * THE GAP. `webhook_logs.status` accepts three values since omnidesk-api `40ac596`
 * widened the enum: `success`, `error`, `suppressed`. The badge already renders
 * all three (`[FIX-20260815-SUPPRESSEDBADGE]` gave `suppressed` its own amber
 * pill and label). The FILTER was never updated, so an operator can see a
 * suppressed row but cannot ask for one: the only way to reach it is "All
 * Statuses" and then read the table by eye.
 *
 * WHY IT MATTERS. `suppressed` is the row that says the bot CHOSE a card and
 * deliberately did not send it because the payment tool had already answered the
 * customer. Those are exactly the rows someone goes looking for when a customer
 * says "the bot said nothing" — and they are the ones the page makes hardest to
 * find.
 *
 * WHY THIS TEST IS SOURCE-LEVEL, not a render. `statusOptions` is built inside
 * the component from `t(...)` calls, and mounting the page pulls in the log
 * service, the date-range filter and three modals. The rule under test is
 * "the option list covers the enum", which is a property of the list itself, so
 * the list is what is read — the same style the repo already uses for
 * `WebhookLogs.tsx` elsewhere.
 *
 * ⚠️ THE ENUM IS READ FROM THE BACKEND SCHEMA, not copied here. If omnidesk-api
 * adds a fourth status and nobody updates this page, this goes red naming it.
 * The path is resolved relative to this repo; when the sibling checkout is not
 * present the case skips loudly rather than passing on a guess.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PAGE = join(process.cwd(), 'pages/hook/WebhookLogs.tsx');
const page = readFileSync(PAGE, 'utf8');

/** The `statusOptions` array as written in the page, comments stripped. */
const statusOptionValues = (): string[] => {
  const m = page.match(/const statusOptions[\s\S]*?\];/);
  if (!m) throw new Error('statusOptions not found in WebhookLogs.tsx');
  const body = m[0]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return [...body.matchAll(/value:\s*'([^']+)'/g)].map((x) => x[1]!);
};

/** The statuses the BE schema accepts, read from the sibling checkout. */
const backendStatuses = (): string[] | null => {
  for (const rel of [
    '../backend/src/modules/system/schemas/webhook-log.schema.ts',
    '../backend/src/modules/system/schemas/webhook-log.schema.ts',
  ]) {
    const p = join(process.cwd(), rel);
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/enum:\s*\[([^\]]+)\]/);
    if (m) return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
  }
  return null;
};

describe('[FIX-20260815-SUPPRESSEDFILTER] Webhook Logs status filter', () => {
  it('offers every status the backend can store, plus "all"', () => {
    const be = backendStatuses();
    if (!be) {
      throw new Error(
        'could not read the BE status enum — check out omnidesk-api beside this repo',
      );
    }
    const offered = statusOptionValues();

    expect(offered[0], 'the first option is the catch-all').toBe('all');
    for (const status of be) {
      expect(
        offered,
        `the filter cannot ask for rows the backend writes: '${status}'`,
      ).toContain(status);
    }
  });

  it('offers nothing the backend cannot store', () => {
    const be = backendStatuses()!;
    const bogus = statusOptionValues().filter(
      (v) => v !== 'all' && !be.includes(v),
    );
    // A filter value no row can hold returns an empty table, which reads as
    // "no logs" rather than "impossible filter" — the exact reason `pending`
    // was removed in [FEAT-20260729-ACTIONOPTS].
    expect({ bogus }).toEqual({ bogus: [] });
  });

  it('labels every option through i18n, never a hardcoded string', () => {
    const m = page.match(/const statusOptions[\s\S]*?\];/)![0];
    /* Only labels INSIDE an option object — `{ value: …, label: … }`. Matching a
       bare `label:` also caught the array's type annotation
       (`{ value: string; label: string }[] = [`) and failed on the word
       "string", which would have been a red test reporting nothing real. */
    const labels = [...m.matchAll(/value:\s*'[^']+',\s*label:\s*([^,\n}]+)/g)].map(
      (x) => x[1]!.trim(),
    );
    expect(labels.length).toBeGreaterThanOrEqual(4);
    for (const label of labels) {
      expect(label, `option label must come from t(): ${label}`).toMatch(
        /^t\('status\./,
      );
    }
  });
});
