/* [FIX-20260815-UNDELIVEREDSTATUS] the undelivered row must be storable
 * ===========================================================================
 * THE BUG. `sendPaymentReply` writes `payment_reply_undelivered` when BOTH the
 * reply token and the push failed — the money has already moved and the customer
 * was told nothing. It wrote `status:'failed'`, which `webhook-log.schema.ts:99`
 * does not accept (`['success','error','suppressed']`). Mongoose rejected the
 * document, `persistWebhookLog` swallowed the rejection by design (a log write
 * must never fail a customer reply), and the row vanished.
 *
 * Counted on the live database 15/08/2026, and this is what made it undeniable:
 *     payment_reply              20 rows   ('success' — in the enum)
 *     payment_push               25 rows   ('success' — in the enum)
 *     payment_reply_undelivered   0 rows   ('failed'  — NOT in the enum)
 *     status:'failed' anywhere in webhook_logs: 0
 *
 * WHAT THIS PINS
 *   1. every status this file writes is a value the schema accepts — the guard
 *      is derived FROM the schema, so adding a value there without adding it to
 *      the writers (or the reverse) turns this red
 *   2. the undelivered row specifically uses 'error', not a bespoke string
 *   3. the success rows are untouched
 *
 * ⚠️ WHY NOT ADD 'failed' TO THE ENUM INSTEAD — checked, not assumed: the
 * Webhook Logs filter offers only error/success (`WebhookLogs.tsx:13-21`, whose
 * own comment records a fourth value being REMOVED because it always returned an
 * empty table), and `webhook-stats.service.ts:112` counts 'error' as
 * `count_failed`. A bespoke status would leave a delivery failure invisible on
 * the dashboard — the opposite of why the row exists.
 *
 * Source-level on purpose: the failure branch needs both LINE legs to throw, and
 * the defect is a literal that a mock would happily accept. Reading the file
 * catches it wherever it is written from.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src/modules/webhook/webhook.service.ts');
const SCHEMA = join(
  process.cwd(),
  'src/modules/system/schemas/webhook-log.schema.ts',
);

const src = readFileSync(SRC, 'utf8');
const schema = readFileSync(SCHEMA, 'utf8');

/** The statuses the schema actually accepts, read from the schema itself. */
const allowedStatuses = (): string[] => {
  const m = schema.match(/enum:\s*\[([^\]]+)\]/);
  if (!m) throw new Error('could not read the status enum from the schema');
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
};

/** Every `await log('<action>', '<status>'` call in the reply sender. */
const logCalls = (): Array<{ action: string; status: string }> =>
  [...src.matchAll(/await log\(\s*'([^']+)',\s*'([^']+)'/g)].map((m) => ({
    action: m[1]!,
    status: m[2]!,
  }));

describe('[UNDELIVEREDSTATUS] payment reply rows use a status the schema accepts', () => {
  it('the schema still declares exactly the known statuses', () => {
    // If this changes, the assertions below are reading a moved target.
    /* [FIX-20260828-SKIPSTATUS] `skipped` เพิ่มเข้ามา 28/08 — OA ที่ถูกข้ามตั้งแต่
       ตอนวางแผนเคยถูกบันทึกเป็น `error` ⇒ "ถูกข้าม" กับ "พัง" อ่านเป็นเรื่องเดียวกัน
       ⚠️ เคสนี้ทำหน้าที่ของมันถูกต้อง: enum ขยับแล้วมันฟ้องทันที · อัปเดตรายการ
          ที่นี่ **เท่านั้น** — เคสข้างล่างที่ตรวจว่าตัวส่ง payment ใช้แต่สถานะที่
          schema รับ ยังต้องเป็นเรื่องเดิมและไม่ถูกผ่อน */
    expect(allowedStatuses().sort()).toEqual([
      'error',
      'skipped',
      'success',
      'suppressed',
    ]);
  });

  it('finds the four log calls it is meant to guard', () => {
    const calls = logCalls();
    expect(calls).toHaveLength(4);
    expect(calls.map((c) => c.action)).toEqual([
      'payment_reply',
      'payment_push',
      'payment_reply_undelivered',
      'payment_reply_undelivered',
    ]);
  });

  /* THE REGRESSION. With `status:'failed'` restored, this goes red. */
  it('every status written is one the schema accepts', () => {
    const allowed = allowedStatuses();
    for (const { action, status } of logCalls()) {
      expect({ action, status, allowed }).toEqual({
        action,
        status: expect.stringMatching(new RegExp(`^(${allowed.join('|')})$`)),
        allowed,
      });
    }
  });

  it('the undelivered row is an error, so the dashboard counts it', () => {
    const undelivered = logCalls().filter(
      (c) => c.action === 'payment_reply_undelivered',
    );

    expect(undelivered).toHaveLength(2);
    for (const c of undelivered) expect(c.status).toBe('error');
  });

  it('the delivered rows are untouched', () => {
    const delivered = logCalls().filter((c) =>
      ['payment_reply', 'payment_push'].includes(c.action),
    );

    expect(delivered).toHaveLength(2);
    for (const c of delivered) expect(c.status).toBe('success');
  });

  /* The literal that caused it must not come back anywhere in this file. */
  it("no log call passes 'failed' any more", () => {
    expect(src).not.toMatch(/await log\(\s*'[^']+',\s*'failed'/);
  });

  /* The type is what makes the mistake impossible to repeat silently. */
  it('the log helper takes the enum, not a bare string', () => {
    expect(src).toMatch(
      /status:\s*'success'\s*\|\s*'error'\s*\|\s*'suppressed'/,
    );
    expect(src).not.toMatch(/const log = \([\s\S]{0,80}status: string,/);
  });
});
