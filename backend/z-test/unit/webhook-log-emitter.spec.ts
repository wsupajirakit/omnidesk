import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Relative on purpose: the door is NOT exported from the webhook barrel (other
// modules must not reach it), and a deep `@/modules/*/*` import is a lint error.
// Same pattern as `bank-logo-code-map.spec.ts`.
import { WebhookLogEmitter } from '../../src/modules/webhook/logging';
import { spineCodeOnly } from '../lib/spine-sources';

/**
 * [FEAT-20260815-WLOGDOOR] The single exit for webhook_logs writes.
 *
 * TARGET suite for the door itself (the flow-level bytes are pinned by the
 * [RULER-20260815-WLOGGOLDEN] blocks in webhook-ingest-flow / webhook-flow-matrix).
 * Written BEFORE the module existed — first run failed on module-not-found,
 * which is this suite's red-first proof.
 *
 * The contract under test is exactly what `persistWebhookLog` has always done
 * before the sink call, no more:
 *   1. keys whose value is `undefined` are dropped;
 *   2. every other key/value — null, '', 0, false, deep objects — passes
 *      VERBATIM (byte-parity is the whole point of the refactor);
 *   3. one write = one sink call;
 *   4. a sink failure PROPAGATES — the caller owns the swallow, so the door
 *      cannot silently eat a row without the caller's error line firing.
 */
describe('[FEAT-20260815-WLOGDOOR] WebhookLogEmitter.write', () => {
  function makeSink(): {
    rows: Array<Record<string, unknown>>;
    sink: { createLog: (row: Record<string, unknown>) => Promise<unknown> };
  } {
    const rows: Array<Record<string, unknown>> = [];
    return {
      rows,
      sink: {
        createLog: (row: Record<string, unknown>) => {
          rows.push(row);
          return Promise.resolve(row);
        },
      },
    };
  }

  it('drops undefined-valued keys and nothing else', async () => {
    const { rows, sink } = makeSink();
    await new WebhookLogEmitter(sink).write({
      action_type: 'line_reply',
      gone: undefined,
      kept_null: null,
      kept_empty: '',
      kept_zero: 0,
      kept_false: false,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      action_type: 'line_reply',
      kept_null: null,
      kept_empty: '',
      kept_zero: 0,
      kept_false: false,
    });
    expect('gone' in rows[0]!).toBe(false);
  });

  it('passes nested values verbatim — same reference, zero re-shaping', async () => {
    const { rows, sink } = makeSink();
    const nested = { raw: { events: [{ id: 1 }] }, arr: [1, 2, 3] };
    await new WebhookLogEmitter(sink).write({
      action_type: 'incoming_line_webhook',
      payload_summary: nested,
    });
    // Reference equality: the door may not clone, wrap or re-order what it carries.
    expect(rows[0]!['payload_summary']).toBe(nested);
  });

  it('one write = exactly one sink call', async () => {
    const { rows, sink } = makeSink();
    const door = new WebhookLogEmitter(sink);
    await door.write({ action_type: 'a' });
    await door.write({ action_type: 'b' });
    expect(rows.map((r) => r['action_type'])).toEqual(['a', 'b']);
  });

  it('a sink failure propagates to the caller — the door never swallows', async () => {
    const door = new WebhookLogEmitter({
      createLog: () => Promise.reject(new Error('validation failed')),
    });
    await expect(door.write({ action_type: 'x' })).rejects.toThrow(
      'validation failed',
    );
  });
});

/* ════ [FIX-20260815-FAILEDSTATUS] the HANDLER files may not invent a status ═══
 *
 * Scope, deliberately narrow: `webhook.service.ts` is already owned by
 * `payment-reply-undelivered-status.spec.ts`, which reads the same enum from the
 * schema and checks every `log(action, status)` call in the payment sender by
 * action name. Repeating that here would be a second copy of one truth, so this
 * block covers only the three files that spec does not reach.
 *
 * THE BUG CLASS IT GUARDS: a writer inventing a word the schema does not know.
 * It has happened twice this month — `'suppressed'` (fixed by widening the enum
 * on 15/08) and `'failed'` on the undelivered payment row (0 rows stored, ever,
 * against 20 `payment_reply` and 25 `payment_push`). Both were silent: Mongoose
 * rejected the document and the door's catch swallowed it by design.
 *
 * ⚠️ THIS SCAN IS A BACKSTOP, NOT THE GUARD — established by mutation, not by
 * assumption. Restoring `'failed'` at the payment site did NOT turn it red: that
 * call passes the status positionally (`log(action, status, extra)`), which a
 * key-value regex cannot see. `tsc` caught it, because the parameter is typed.
 * The real defence is the typed door plus the case below. ด่านจริงคือ compiler.
 */
describe('[FIX-20260815-FAILEDSTATUS] the handler files write no unknown status', () => {
  /* [FIX-20260828-SKIPSTATUS] `skipped` เพิ่ม 28/08 — ดูเหตุผลที่ schema
     ⚠️ รายการนี้ถูกเทียบกับ enum ของ schema ในเคสถัดไป ⇒ ทั้งสองที่ต้องขยับพร้อมกัน
        เสมอ · นั่นคือสิ่งที่เคสนั้นมีไว้ตรวจ และมันฟ้องถูกต้องตอน enum ขยับ */
  const ALLOWED = ['success', 'error', 'suppressed', 'skipped'];

  /** The enum, read from the schema itself — never a second copy of the list. */
  it('the allowed list here still matches the schema enum', () => {
    const schema = readFileSync(
      join(__dirname, '../../src/modules/system/schemas/webhook-log.schema.ts'),
      'utf8',
    );
    const m = schema.match(/enum:\s*\[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const fromSchema = m![1]!
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);
    expect(fromSchema.sort()).toEqual([...ALLOWED].sort());
  });

  it.each([
    'webhook/assist/assist-notification.ts',
    'webhook/hook-reply/customer-register.handler.ts',
    'webhook/slip-flex/slip-flex.handler.ts',
  ])('%s writes no status the schema would reject', (rel) => {
    const src = readFileSync(join(__dirname, '../../src/modules', rel), 'utf8')
      // comments describe the OLD value on purpose — only real code counts
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /* `(^|[^_\w])status:` on purpose — a bare `status:` key only. Without the
       boundary this also matched `chat_status: 'bot'` and `http_status`, and the
       guard failed on a field that has nothing to do with the enum. A guard that
       cries wolf gets disabled by the next person. */
    const written = [
      ...src.matchAll(/(?:^|[^_\w])status:\s*'([a-z_]+)'/gm),
    ].map((m) => m[1]);
    const rogue = [...new Set(written)].filter((s) => !ALLOWED.includes(s!));
    // The failure message IS the finding: jest prints the array, so a rogue
    // value names itself instead of leaving the next person to grep for it.
    expect({ file: rel, rogue }).toEqual({ file: rel, rogue: [] });
  });
});

/* ════ [FEAT-20260815-WLOGDOOR] the door is the ONLY way out ═══════════════════
 *
 * The compiler can only check a call it can see the type of. Every webhook_logs
 * write inside the service now goes through `wlogEmit(event: WebhookLogEvent)`,
 * so a bad `channel`, a missing `endpoint` or an invented `status` is a build
 * error. A new site that called `persistWebhookLog` directly would take an
 * untyped `Record<string, unknown>` and walk straight past all of that — which
 * is exactly how `status: 'failed'` survived for weeks.
 *
 * This case is what makes the typed door load-bearing rather than optional.
 * When the last handler literal has moved across, `persistWebhookLog` itself can
 * go and this assertion becomes `0` everywhere. ประตูต้องเป็นทางเดียวจริง ๆ.
 */
describe('[FEAT-20260815-WLOGDOOR] no writer bypasses the typed door', () => {
  it('webhook.service.ts calls the typed door only — zero direct persistWebhookLog calls', () => {
    const src = readFileSync(
      join(__dirname, '../../src/modules/webhook/webhook.service.ts'),
      'utf8',
    );

    // the definition and the delegate inside `wlogEmit` are the only mentions left
    const directCalls = [...src.matchAll(/this\.persistWebhookLog\(\{/g)];
    expect({ directCalls: directCalls.length }).toEqual({ directCalls: 0 });
  });
});

/* ════ [PERF-20260824-WLOGVOID] the AI audit row must not block the reply ══════
 *
 * The `generate_response` row is the heaviest write on the webhook path — it
 * carries the whole model request and response — and it sits ~600 lines ABOVE
 * the send. Awaiting it put a Mongo round-trip in front of the customer's reply
 * for a row nobody reads synchronously, against a reply token that expires at
 * 60s. The inbound raw-payload row at the top of the same file has been
 * `void`-ed for exactly this reason since WLOGDOOR; this applies the same rule
 * to the row that costs the most.
 *
 * Safe because `wlogEmit` returns `Promise<void>` and swallows its own failure
 * into `this.logger.error` — there is no rejection to leak and no branch below
 * reads the result. Traded away: an audit row can be lost if the process dies
 * between the send and the write. Accepted — cheaper than a lost reply.
 *
 * Comments are stripped before matching, because the prose above names both
 * `await this.wlogEmit` and `void this.wlogEmit` and would otherwise satisfy or
 * break these assertions on its own. คอมเมนต์ต้องถูกตัดก่อน ไม่งั้นเทสหลอกตัวเอง.
 */
describe('[PERF-20260824-WLOGVOID] the generate_response audit row is fire-and-forget', () => {
  const strippedSource = () =>
    readFileSync(
      join(__dirname, '../../src/modules/webhook/webhook.service.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

  /**
   * The slice from the audit row's builder to the log call that writes it.
   *
   * [PROG-20260905-LADDER] The row MOVED — twice. SP31 took the literal into
   * `logging/ai-audit-row.ts`; this save point took the CALL into
   * `gates/ai-audit-row.step.ts`, where the emitter is reached as `deps.emitWlog` rather
   * than `this.wlogEmit`. Neither move touched the rule, which was never "this file
   * contains that spelling" — it is "the audit row is fire-and-forget". So the reader
   * follows the code (spine + the role directories a body may move to) and the call is
   * matched on either collaborator prefix, exactly as the slip-twin and room-preview pins
   * were converted before it. ตามโค้ดไป ไม่ใช่ตามไฟล์ · กฎเดิมไม่ได้เปลี่ยน
   */
  const auditSlice = (): string => {
    const src = spineCodeOnly(join(__dirname, '../..'), ['gates', 'logging']);
    const start = src.indexOf('buildAiAuditRow(');
    expect(start).toBeGreaterThan(-1);
    // walk BACKWARDS to the emit that wraps it — the builder is the row's identity.
    const before = src.slice(Math.max(0, start - 200), start);
    return before;
  };

  it('(T1 TARGET) that call is prefixed with void, not await', () => {
    const slice = auditSlice();
    expect(slice).toMatch(/void (this\.wlogEmit|deps\.emitWlog)\(/);
    expect(slice).not.toMatch(/await (this\.wlogEmit|deps\.emitWlog)\(/);
  });

  it('(P1 PIN) the inbound raw-payload row is still void — the precedent is intact', () => {
    const src = strippedSource();

    /* [PROG-20260905-INROW] This used to assert `toContain('void this.wlogEmit({')` and
       count the occurrences. Both survived the move of the inbound row's LITERAL into
       `logging/incoming-delivery-row.ts` — and that is exactly the problem: the surviving
       match was the OTHER row (generate_response), so the assertion would have stayed
       green while the inbound row was quietly changed to `await`. The rule was never
       "some row is voided"; it is "THIS row is voided". So it now names the site. */
    const call = src.indexOf('buildIncomingDeliveryRow(');
    expect(call).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, call - 120), call);
    expect(before).toContain('void this.wlogEmit(');
    expect(before).not.toContain('await this.wlogEmit(');

    /* Both rows void ⇒ at least two occurrences of the fire-and-forget form ACROSS the
       spine and its role directories. Counted over the same concatenation the audit slice
       reads, because the two rows no longer live in one file — counting only the spine
       would report the audit row's successful extraction as a lost rule. */
    const both = spineCodeOnly(join(__dirname, '../..'), ['gates', 'logging']);
    const voided = [
      ...both.matchAll(/void (this\.wlogEmit|deps\.emitWlog)\(/g),
    ];
    expect(voided.length).toBeGreaterThanOrEqual(2);
  });

  it('(P2 PIN) wlogEmit still swallows its own failure — that is what makes void safe', () => {
    const src = strippedSource();
    const def = src.indexOf('private async wlogEmit(');
    expect(def).toBeGreaterThan(-1);
    const body = src.slice(def, def + 800);
    expect(body).toContain('catch');
    expect(body).toContain('Webhook log persist failed');
  });
});
