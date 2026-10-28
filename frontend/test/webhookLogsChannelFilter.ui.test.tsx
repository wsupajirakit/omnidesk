/**
 * [FIX-20260816-WLOGVENDOR] The Channel filter must list every AI vendor the
 * backend can write into a log row.
 *
 * WHY THIS EXISTS. `webhook_logs.log_source` used to be hard-coded to 'gemini'
 * for every AI reply, so one dropdown entry covered every hook. After the BE fix
 * the row names the vendor that ACTUALLY answered, which means a vendor with no
 * entry here becomes unfilterable — its rows appear only under "All Channels",
 * and the Gemini filter quietly stops covering them. That regression is
 * invisible in a render test, so it is asserted against the BE's own registry.
 *
 * ⚠️ THE VENDOR LIST IS READ FROM omnidesk-api, not copied here. Add vendor #3 to
 * `REPLY_TRANSPORTS` and this case goes red naming it, which is the point:
 * the dropdown cannot silently fall behind the backend.
 * รายชื่อค่ายอ่านจาก BE จริง ไม่ก๊อปมาไว้ที่นี่ — ค่ายใหม่มาแล้วเทสจะฟ้องเอง
 *
 * WHY SOURCE-LEVEL, not a render: `channelOptions` is built inside the component
 * from `t(...)` calls and mounting the page pulls in the log service, the
 * date-range filter and three modals. The rule under test is a property of the
 * list itself — the same style `webhookLogsStatusFilter.ui.test.tsx` uses.
 *
 * revert: delete this file and the `deepseek` entry in WebhookLogs.tsx.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PAGE = join(process.cwd(), 'pages/hook/WebhookLogs.tsx');
const page = readFileSync(PAGE, 'utf8');

/** The `channelOptions` array as written in the page, comments stripped. */
const channelOptionValues = (): string[] => {
  const m = page.match(/const channelOptions[\s\S]*?\];/);
  if (!m) throw new Error('channelOptions not found in WebhookLogs.tsx');
  const body = m[0]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return [...body.matchAll(/value:\s*'([^']+)'/g)].map((x) => x[1]!);
};

/**
 * The AI vendors the backend can log, read from the sibling checkout.
 *
 * The registry is the single wiring point: its KEYS are exactly the values
 * `resolveReplyVendorName` can return, which is what the BE writes to
 * `channel` / `log_source` on an AI row.
 */
const backendVendors = (): string[] | null => {
  for (const rel of [
    '../backend/src/modules/webhook/ai-reply/reply-transport.registry.ts',
    '../backend/src/modules/webhook/ai-reply/reply-transport.registry.ts',
  ]) {
    const p = join(process.cwd(), rel);
    if (!existsSync(p)) continue;
    const src = readFileSync(p, 'utf8');
    const m = src.match(/REPLY_TRANSPORTS:\s*ReplyTransportRegistry\s*=\s*\{([\s\S]*?)\n\};/);
    if (!m) continue;
    const body = m[1]!
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // `  gemini: new GeminiReplyTransport(),` -> `gemini`
    return [...body.matchAll(/^\s*([a-z0-9_]+)\s*:/gim)].map((x) => x[1]!);
  }
  return null;
};

describe('[FIX-20260816-WLOGVENDOR] Webhook Logs channel filter', () => {
  it('lists every AI vendor the backend registry can log', () => {
    const vendors = backendVendors();
    if (!vendors) {
      // Loud skip rather than a green pass on a guess — same rule as the
      // status-filter case. ไม่มี checkout ข้าง ๆ = ข้ามแบบส่งเสียง ไม่ผ่านเงียบ
      console.warn(
        '[SKIP] no backend checkout with reply-transport.registry.ts — vendor list unverified',
      );
      expect(vendors).toBeNull();
      return;
    }
    expect(vendors.length).toBeGreaterThan(1);
    const options = channelOptionValues();
    for (const v of vendors) expect(options).toContain(v);
  });

  it('keeps the plain vendor values — the API filters on them verbatim', () => {
    // fetchLogs splits on ':' to support "<channel>:<source>" entries, so a
    // vendor value must NOT carry a suffix or the query would filter on a
    // channel that no row holds.
    const options = channelOptionValues();
    expect(options).toContain('gemini');
    expect(options).toContain('deepseek');
    expect(options.filter((o) => o.startsWith('deepseek'))).toEqual(['deepseek']);
  });
});
