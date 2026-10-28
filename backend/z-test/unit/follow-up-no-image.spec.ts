/* [FIX-20260821-NOIMAGEFOLLOWUP] an image never enters the follow-up flow
 * ===========================================================================
 * FOUND ON A REAL CONVERSATION, 21/08/2026. A customer who had been asked to
 * register answered by sending a SCREENSHOT of their dashboard — name, account
 * number and phone all legible in the picture — and the bot replied with the
 * same request again. They had answered; the bot could not read it.
 *
 * WHY IT HAPPENED, and why it is not the sticker work's fault: level 1 does not
 * look at what the CUSTOMER sent. `abandon-trigger.rule.ts` decides purely on
 * whether the bot's last three messages carried the registration card, so ANY
 * inbound event reaching the flow qualifies. And an image reaches it —
 * `SILENT_MESSAGE_TYPES` is sticker/file/video/audio only, so an image travels
 * the main path, where the flow runs BEFORE the non-text branch.
 *
 * WHAT THESE CASES PIN:
 *   · an image is refused BEFORE the gate is consulted — not "the gate says no",
 *     but "the gate is never asked", so no history read happens either;
 *   · text and sticker are untouched, which is what makes this safe to ship;
 *   · the guard lives in the webhook, never in `./follow-up` — that folder's
 *     rule 1 forbids it knowing what a webhook message type is.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const noComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const WH = 'src/modules/webhook/webhook.service.ts';

describe('⭐ an image is turned away before the gate is asked anything', () => {
  /* [PROG-20260905-SPINESRC] SP23 moved the flow's body to gates/follow-up-flow.ts. The
     rule is unchanged and is the point of this describe: an image must be turned away
     BEFORE the gate is asked, because "never asked" and "asked and said no" look identical
     from outside and the second still costs a chat-history query on the live path. The
     slice now reads whichever file holds the body. */
  const FLOW_FILE = 'src/modules/webhook/gates/follow-up-flow.ts';
  const body = noComments(
    existsSync(join(process.cwd(), FLOW_FILE)) ? src(FLOW_FILE) : src(WH),
  );
  const flow = body.slice(
    Math.max(
      body.indexOf('const runFollowUpFlow'),
      body.indexOf('export async function runFollowUpFlow('),
    ),
  );
  const upToGate = flow.slice(0, flow.indexOf('runFollowUpGate('));

  it('⭐ the guard exists and matches only the image type', () => {
    expect(upToGate).toContain("event.message?.type === 'image'");
    expect(upToGate).toContain('return false');
  });

  it('⭐ it runs BEFORE the gate — no history read for an image', () => {
    /* "the gate is never asked" and "the gate says no" look the same from the
       outside and are not: the second still costs a chat-history query on the
       live path. ต้องไม่ถามเลย ไม่ใช่ถามแล้วตอบไม่. */
    const guard = upToGate.indexOf("=== 'image'");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(upToGate.length);
    expect(flow.indexOf("=== 'image'")).toBeLessThan(
      flow.indexOf('runFollowUpGate('),
    );
  });

  it('⭐ nothing else is turned away with it', () => {
    /* the guard must name ONE type. Widening it to `!== 'text'` would silently
       drop stickers, which the owner added on purpose. */
    const line = upToGate
      .split('\n')
      .find((l) => l.includes("event.message?.type === 'image'"));
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/\|\||&&/);
    for (const t of ['sticker', 'text', 'file', 'video', 'audio']) {
      expect(line).not.toContain(t);
    }
  });
});

describe('⭐ the sticker route is untouched', () => {
  const body = src(WH);

  it('⭐ a sticker still reaches the flow from the silent-type gate', () => {
    /* [FEAT-20260820-STICKERFOLLOWUP] the owner asked for this explicitly; the
       image fix must not take it with it. */
    expect(body).toContain('[FEAT-20260820-STICKERFOLLOWUP]');
    /* anchored on the silent-type gate itself, not on the tag — the tag appears
       twice, and the other one sits at the closure definition 13k characters
       away. ยึดที่บล็อกจริง ไม่ใช่ที่ tag เพราะ tag มีสองที่. */
    const silent = body.slice(body.indexOf("imgProbe('silent-type-return'"));
    expect(silent.slice(0, 1400)).toContain('runFollowUpFlow()');
    expect(silent.slice(0, 1400)).toContain('!followUpHasProfile');
  });

  it('an image is not in the silent list, which is why it took the main path', () => {
    const routing = src('src/modules/webhook/webhook-routing.ts');
    const line = routing
      .split('\n')
      .find((l) => l.includes('SILENT_MESSAGE_TYPES ='));
    expect(line).toBeTruthy();
    expect(line).not.toContain('image');
    expect(line).toContain('sticker');
  });
});

describe('⭐ the rule folder still knows nothing about message types', () => {
  it('⭐ no file in follow-up/ mentions an image or a message type', () => {
    /* folder rule 1: "NOTHING HERE KNOWS WHAT A WEBHOOK IS". Putting the check
       there would have been the shorter diff and the wrong place. */
    const dir = 'src/modules/webhook/follow-up/';
    for (const f of [
      'follow-up.gate.ts',
      'abandon-trigger.rule.ts',
      'abandon-trigger.helper.ts',
      'ignore-abandon.rule.ts',
    ]) {
      const code = noComments(src(dir + f));
      expect(code).not.toMatch(/message\?\.type|'image'|'sticker'/);
    }
  });

  it('level 1 still decides on the BOT history alone — that is the root cause', () => {
    /* documented so the next reader does not "fix" the rule instead: the rule is
       correct, it simply answers a different question. */
    const rule = noComments(
      src('src/modules/webhook/follow-up/abandon-trigger.rule.ts'),
    );
    expect(rule).toContain('CUSTOMER_HELPER_REPLY_TYPE');
    expect(rule).not.toMatch(/inbound|incoming/i);
  });
});
