/* [FEAT-20260821-IGNOREABANDON] the two ways an operator sets the switch
 * ===========================================================================
 * The column itself, the gate that reads it and the hook form are pinned by
 * `ignore-abandon-assist.spec.ts`. This file covers the two WRITE paths added
 * afterwards, and the two traps that come with them:
 *
 *   · `PATCH /hook/abandon/bulk` — a DEDICATED route rather than a fourth entry
 *     in `BULK_SETTING_FIELDS`. That whitelist is echoed back inside a rejection
 *     message which `hook-write.golden-spec.ts` compares with legacy BYTE FOR
 *     BYTE, and legacy's list cannot grow. A name added there would put every
 *     hook-write golden case into permanent disagreement over a field legacy has
 *     never heard of. The cases below pin the whitelist as UNCHANGED — that is
 *     the assertion, not an incidental detail.
 *
 *   · `PATCH /api/line-users/:id/ignore-abandon` — the per-customer switch,
 *     which must write the COLUMN and never the `config` bag.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// the same import shape the sibling hook specs in this folder already use
import { BULK_SETTING_FIELDS } from '@/modules/hooks/hook-write.helpers';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('⭐ the bulk whitelist is left exactly as legacy has it', () => {
  it('⭐ still the same three fields — adding a fourth breaks golden forever', () => {
    /* `hooks.service.ts` builds a 400 as
       `'field must be one of: ' + BULK_SETTING_FIELDS.join(', ')`, and
       `z-test/golden/hook-write.golden-spec.ts` asserts that body equals
       legacy's. เติมชื่อที่นี่ = ข้อความเปลี่ยน = golden ต่างตลอดกาล. */
    expect([...BULK_SETTING_FIELDS]).toEqual([
      'slip_check',
      'customer_link_enabled',
      'custom_tool_status',
    ]);
  });

  it('⭐ the switch is NOT in it', () => {
    expect(BULK_SETTING_FIELDS).not.toContain('ignore_abandon_assist');
  });
});

describe('⭐ the OA-wide switch has a route of its own', () => {
  const ctl = src('src/modules/hooks/hooks.controller.ts');
  const svc = src('src/modules/hooks/hooks.service.ts');

  it('the route exists and sits with its siblings', () => {
    expect(ctl).toContain("@Patch('abandon/bulk')");
    /* the house precedent this copies — both are dedicated routes for the same
       reason, and both say so in their own headers. */
    expect(ctl).toContain("@Patch('handoff/bulk')");
    expect(ctl).toContain("@Patch('payment/bulk')");
  });

  it('⭐ it refuses a non-boolean rather than coercing it', () => {
    /* `"false"` is a truthy STRING: coercing would switch the chase OFF for the
       OAs the operator was switching it back ON for. */
    const body = svc.slice(svc.indexOf('async bulkUpdateHookAbandon'));
    const upToWrite = body.slice(0, body.indexOf('loadBulkTargets'));
    expect(upToWrite).toContain("typeof body['value'] !== 'boolean'");
  });

  it('⭐ it evicts the hook cache — otherwise the gate keeps the old value', () => {
    /* the webhook resolves a hook from L1/L2 before it consults the gate, so
       without this the switch looks like it worked while customers keep being
       chased until the TTL expires. */
    const body = svc.slice(svc.indexOf('async bulkUpdateHookAbandon'));
    const method = body.slice(0, body.indexOf('async bulkUpdateHookPayment'));
    expect(method).toContain('this.hookCache.cacheHook(');
    expect(method).toContain('previousAlias');
  });

  it('it checks access before writing anything — all or nothing', () => {
    const body = svc.slice(svc.indexOf('async bulkUpdateHookAbandon'));
    const method = body.slice(0, body.indexOf('async bulkUpdateHookPayment'));
    expect(method.indexOf('loadBulkTargets')).toBeLessThan(
      method.indexOf('updateMany'),
    );
  });

  it('⭐ a row that predates the column counts as OFF when switching ON', () => {
    /* `.lean()` skips schema defaults, so an existing hook reads `undefined`.
       Comparing with `=== true` is what makes it a target of a switch-on. */
    const body = src('src/modules/hooks/hooks.service.ts');
    const method = body.slice(body.indexOf('async bulkUpdateHookAbandon'));
    expect(strip(method.slice(0, method.indexOf('updateMany')))).toContain(
      "h['ignore_abandon_assist'] === true",
    );
  });

  it('it audits only the hooks that actually moved', () => {
    const body = svc.slice(svc.indexOf('async bulkUpdateHookAbandon'));
    const method = body.slice(0, body.indexOf('async bulkUpdateHookPayment'));
    expect(method).toContain('this.auditBulk(');
    expect(method).toContain("field: 'ignore_abandon_assist'");
    /* `targets`, not `hooks` — a repeated call must leave no rows at all. */
    expect(method).toMatch(/this\.auditBulk\(\s*targets,/);
  });
});

describe('⭐ the per-customer switch writes the column, not the bag', () => {
  const svc = src('src/modules/chat/members.service.ts');
  const method = svc.slice(svc.indexOf('async updateIgnoreAbandon'));
  /* [FIX-20260829-ABANDONSLICE] cut at the NEXT class member, whatever it is
     called — not at `async getRawProfile`.
     🔴 The old boundary named the method that HAPPENED to follow, so it measured
        `updateIgnoreAbandon` **plus everything inserted after it**. On 29/08 a new
        member route (`setFollowUpStamp`, which legitimately writes a `follow_up`
        key through `writeMemberConfig`) landed in that gap and turned this suite
        red although `updateIgnoreAbandon` had not been touched at all.
     This boundary still fails if `updateIgnoreAbandon` itself ever reaches for the
     config bag — which is the thing the assertions below actually care about —
     and it no longer depends on who its neighbour is. */
  const nextMember = method.search(/\n {2}(public|private|protected)\b/);
  const body = method.slice(0, nextMember === -1 ? undefined : nextMember);

  it('⭐ it sets the top-level column', () => {
    expect(body).toContain('$set: { ignore_abandon_assist: value }');
  });

  it('⭐ it never reaches for the config bag or a follow_up path', () => {
    /* owner: "member column จริงไม่ใช่ config follow ไม่เกี่ยว" */
    expect(body).not.toMatch(/writeMemberConfig|readMemberConfig|follow_up/);
  });

  it('⭐ it checks room scope before writing — not any operator, any customer', () => {
    /* [FIX-20260818-MEMBERSCOPE] a member is reachable only through a room the
       caller shares with them. */
    expect(body.indexOf('ensureMemberInScope')).toBeGreaterThan(-1);
    expect(body.indexOf('ensureMemberInScope')).toBeLessThan(
      body.indexOf('findByIdAndUpdate'),
    );
  });

  it('⭐ the string "false" cannot switch the chase ON', () => {
    /* ⚠️ MEASURED, not reasoned. A first version used a DTO with `@IsBoolean()`
       and a live probe against the running server showed every one of these
       answering 200:
           'true' -> true   'yes' -> true   1 -> true
           'false' -> TRUE  0 -> false      '' -> false
       `main.ts:141` runs the global pipe with `enableImplicitConversion`, so
       class-transformer coerces the body BEFORE any validator runs, and
       `Boolean('false')` is `true`. The decorator could not have caught it.
       The fix is to take the body untyped — no metatype, so the pipe skips it
       — and let the service's own `typeof` be the real guard, which is how the
       three bulk routes already work. `"false"` เป็นสตริง truthy · pipe แปลงก่อน validator. */
    expect(body).toContain("typeof value !== 'boolean'");
    /* the raw body, not a validated DTO instance */
    expect(body).toContain("body?.['ignore_abandon_assist']");
  });

  it('⭐ no class-validator decorator guards this field — it would run too late', () => {
    const dto = src('src/modules/chat/dto/member.dto.ts');
    /* the declaration line itself — bounded at the semicolon, or the slice runs
       on into the next class and reads ITS decorators. */
    const from = dto.indexOf('export type UpdateMemberIgnoreAbandonBody');
    const decl = dto.slice(from, dto.indexOf(';', from) + 1);
    expect(decl).toContain('Record<string, unknown>');
    expect(decl).not.toMatch(/@Is[A-Za-z]+\(/);
    /* and the route must not re-introduce one by typing the body as a class */
    const ctl = src('src/modules/chat/members.controller.ts');
    const at = ctl.slice(ctl.indexOf("'api/line-users/:id/ignore-abandon'"));
    expect(at.slice(0, at.indexOf('public async') + 400)).toContain(
      '@Body() body: Record<string, unknown>',
    );
  });

  it('the route carries both id shapes and the same permission as its siblings', () => {
    const ctl = src('src/modules/chat/members.controller.ts');
    const at = ctl.slice(ctl.indexOf("'api/line-users/:id/ignore-abandon'"));
    expect(at).toContain("'api/channel-users/:id/ignore-abandon'");
    expect(at.slice(0, at.indexOf('public async'))).toContain(
      "@RequirePermissions('ticket.manage')",
    );
  });
});
