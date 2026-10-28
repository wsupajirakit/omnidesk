import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* eslint-disable-next-line no-restricted-imports --
   `hook-reply/` is deliberately NOT on the webhook barrel: other modules must not
   reach into it, and exporting it would make that reach legal for everyone. A test
   that pins this file's contract has to name the file. Same exemption the sibling
   `slip-flex-lock-duplicate-first.spec.ts` already carries. */
import { slipFlexReply } from '@/modules/webhook/hook-reply/reply-via-core';

/**
 * [FEAT-20260906-SLIPPUSH] A slip card must survive an expired reply token.
 * ===========================================================================
 * THE HOLE THIS CLOSES, and it cost a customer their answer rather than a
 * developer their afternoon. A slip card is answered on the REPLY token, which
 * LINE kills 60 seconds after the message arrives. The slip lane spends a paid
 * Swiftcheck verification AND a Gemini QR read before the card is built, so on a
 * slow turn the token is already refused when the send happens. The card was
 * then LOST — no retry, no push, and the customer who had just transferred
 * money saw nothing at all.
 *
 * The ladder for exactly this already existed: `replyThenPush`. The AI reply
 * (`reply-via-core.ts`) and the payment lane (`payment-send.ladder.ts`) both
 * use it. The slip lane did not — not because it opted out, but because
 * `slipFlexReply` had no parameter to name the recipient, and `flexReply` only
 * falls back to push when it is GIVEN a `userId`. So the fix is to pass one.
 * `[PUSHCORE-A2]` exists so the rule has one copy; this adds a caller to it,
 * not a second ladder.
 *
 * ⚠️ THE THROW IS PART OF THE CONTRACT, NOT AN ACCIDENT. `slip-flex.handler`'s
 * caller logs "Failed in result processing logic" and continues; without a throw
 * a refused card falls through as though it had been delivered. So the last case
 * below pins that BOTH legs failing still throws. A ladder that swallowed the
 * failure and returned a fake 200 would be worse than the bug it fixes.
 * ถอยไป push ได้ แต่ถ้าล้มทั้งคู่ต้องโยนเหมือนเดิม
 */
describe('[FEAT-20260906-SLIPPUSH] slip flex falls back to push', () => {
  const REFUSED = {
    ok: false as const,
    status: 400,
    reason: 'Invalid reply token',
    raw: undefined,
  };
  const OK = { ok: true as const, status: 200, data: { x: 1 } };

  /** Records every leg the ladder attempts, in order. */
  const spy = (answers: Record<string, unknown>[]) => {
    const legs: string[] = [];
    let i = 0;
    return {
      legs,
      send: (req: { kind: string }) => {
        legs.push(req.kind);
        return Promise.resolve(answers[i++] as never);
      },
    };
  };

  it('⭐ a refused reply token is retried as a push', async () => {
    const s = spy([REFUSED, OK]);
    const res = await slipFlexReply(
      s.send,
      'tok',
      'expired-reply-token',
      { type: 'bubble' },
      'สลิป',
      null,
      'U0000000000000000000000000000001',
    );
    expect(s.legs).toEqual(['reply', 'push']);
    expect(res.status).toBe(200);
  });

  it('does NOT push when the reply succeeded — one message, not two', async () => {
    /* The customer must not receive the card twice. The push leg is a recovery,
       not a duplicate send. ส่งสำเร็จแล้วห้ามยิงซ้ำ */
    const s = spy([OK]);
    await slipFlexReply(
      s.send,
      'tok',
      'good-token',
      { type: 'bubble' },
      'สลิป',
      null,
      'U0000000000000000000000000000001',
    );
    expect(s.legs).toEqual(['reply']);
  });

  it('without a userId it behaves exactly as before — reply only, then throws', async () => {
    /* The parameter is optional so every existing caller and test is unchanged.
       This case is the proof of that, not a description of it. */
    const s = spy([REFUSED]);
    await expect(
      slipFlexReply(
        s.send as never,
        'tok',
        'expired-reply-token',
        { type: 'bubble' },
        'สลิป',
        null,
      ),
    ).rejects.toThrow();
    expect(s.legs).toEqual(['reply']);
  });

  it('⭐ BOTH legs failing still THROWS — the handler depends on it', async () => {
    /* `slip-flex.handler`'s caller treats a throw as "the card did not arrive"
       and logs it. Returning a fake success here would mark a lost card as
       delivered, which is the one outcome worse than the original bug. */
    const s = spy([REFUSED, { ok: false, status: 500, reason: 'push failed' }]);
    await expect(
      slipFlexReply(
        s.send as never,
        'tok',
        'expired-reply-token',
        { type: 'bubble' },
        'สลิป',
        null,
        'U0000000000000000000000000000001',
      ),
    ).rejects.toThrow();
    expect(s.legs).toEqual(['reply', 'push']);
  });

  it('⭐ EVERY slip call site passes a userId — both of them', () => {
    /* The unit cases above prove the ladder works when it is given a userId. They
       cannot prove the SPINE gives it one — and that was the entire bug: the mechanism
       existed and nobody passed the argument. Read it off the source, because a missing
       argument cannot be seen any other way.
       กลไกมีอยู่แล้ว บั๊กคือไม่มีใครส่ง argument — เทสต้องอ่านจากซอร์ส

       🔴 [FIX-20260906-ASSISTSLIPPUSH] THIS CASE USED TO READ ONE FILE AND ASSERT ONE
       CALL SITE, on the strength of a comment claiming `turnDeps()` was "the single
       wiring site for the whole turn, so the fix lands once". That was false. The spine
       cut moved the assist half into `non-text/assist-bypass.ts`, which inlines its OWN
       slip deps — a SECOND binding, invisible to a scan of `webhook.service.ts`. It
       shipped without `userId` for as long as this test looked at one file, and the test
       stayed green throughout, while `dev` carried the argument at both of its sites.
       A guard that reads one of two sites guards nothing.
       เทสอ่านไฟล์เดียวจากสองไฟล์ = ไม่ได้เฝ้าอะไรเลย

       The files are listed explicitly rather than globbed, so a binding that appears in a
       third file FAILS this list and has to be added deliberately. */
    const SITES = [
      '../../src/modules/webhook/webhook.service.ts',
      '../../src/modules/webhook/non-text/assist-bypass.ts',
    ];
    const found: { file: string; args: string }[] = [];
    for (const rel of SITES) {
      const lines = readFileSync(join(__dirname, rel), 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (!l.includes('slipFlexReply(')) return;
        /* ⚠️ FROM the matching line, not after it. One site writes the call on ONE line
           (that file is `.prettierignore`d and the ratchet counts CODE lines) and the
           other wraps it over nine. A scan that started at `i + 1` read the next
           statement and reported the argument missing while it sat right there.
           รูปแบบโค้ดต่างกันสองที่ ตัววัดต้องครอบทั้งสองแบบ */
        found.push({ file: rel, args: lines.slice(i, i + 12).join('\n') });
      });
    }

    // one per file today; a third binding fails here and asks why
    expect(found).toHaveLength(2);
    for (const site of found) {
      expect(site.args).toMatch(/userId/);
    }
  });
});
