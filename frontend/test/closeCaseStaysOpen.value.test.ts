/**
 * [FIX-20260830-CLOSESTAYOPEN] a blocked confirm must leave the dialog OPEN.
 *
 * 🔴 Owner 30/08: "กดยืนยันแล้ว modal มันปิดไปเลย". The guard was working —
 *    it blocked the close and raised the red state — but `ConfirmModal`
 *    defaults `closeOnConfirm` to true and calls `onClose()` straight after
 *    `onConfirm()`, whether or not the handler returned early. The dialog
 *    vanished with the warning inside it, so the admin believed the case had
 *    closed. The caller owns the closing now.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const PAGE = strip(read('../pages/chat/TicketChat.tsx'));
const MODAL = strip(read('../components/modals/ConfirmModal.tsx'));

describe('the modal no longer closes itself on confirm', () => {
  it('⭐ the close-case dialog opts out of the auto-close', () => {
    expect(PAGE).toMatch(/closeOnConfirm=\{false\}/);
  });

  it('the auto-close it opts out of really exists — otherwise this pin is vacuous', () => {
    expect(MODAL).toMatch(/onConfirm\(\);\s*if \(closeOnConfirm\) onClose\(\)/);
    expect(MODAL).toMatch(/closeOnConfirm = true/);
  });
});

describe('the caller closes it only on the success path', () => {
  const handler = (): string => {
    const at = PAGE.indexOf('onConfirm={() => {');
    expect(at).toBeGreaterThan(-1);
    return PAGE.slice(at, PAGE.indexOf('title={confirmAction', at));
  };

  it('⭐ the blocked branch returns BEFORE anything closes the dialog', () => {
    const h = handler();
    /* [FIX-20260830-SHAKEEVERYTIME] the guard became a multi-line block when it
       gained the attempt counter, so the pin is the RETURN itself — the thing
       that must come before any close — not the old one-line spelling. */
    const guard = h.indexOf('setFollowUpMissing(true);');
    const close = h.indexOf('setConfirmAction(null)');
    expect(guard).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(close);
    // and the early return still sits between them
    const ret = h.indexOf('return;', guard);
    expect(ret).toBeGreaterThan(guard);
    expect(ret).toBeLessThan(close);
  });

  it('⭐ the loading branch also returns before it', () => {
    const h = handler();
    expect(h.indexOf('if (freshLoading) return;')).toBeLessThan(
      h.indexOf('setConfirmAction(null)'),
    );
  });

  it('the success path still closes and clears the answers', () => {
    const h = handler();
    expect(h).toContain('executeAction(confirmAction.ticket, confirmAction.targetStatus)');
    expect(h).toContain('setConfirmAction(null)');
    expect(h).toContain('setCloseAnswers({})');
    expect(h).toContain('setFollowUpMissing(false)');
  });

  it('cancel / X still close it — onClose is untouched', () => {
    expect(PAGE).toMatch(/onClose=\{\(\) => \{ setConfirmAction\(null\); setCloseAnswers\(\{\}\); setFollowUpMissing\(false\); \}\}/);
  });
});

describe('[FIX-20260830-SHAKEEVERYTIME] the caller counts the attempts', () => {
  it('⭐ a blocked confirm increments the attempt, so the shake can replay', () => {
    /* a boolean could not report the SECOND press — true over true is not a
       state change, so nothing re-rendered and the dialog sat still. */
    const h = PAGE.slice(
      PAGE.indexOf('onConfirm={() => {'),
      PAGE.indexOf('title={confirmAction', PAGE.indexOf('onConfirm={() => {')),
    );
    expect(h).toMatch(/setFollowUpMissing\(true\);[\s\S]{0,120}setMissingAttempt\(\(n\) => n \+ 1\)/);
  });

  it('the counter reaches the sections', () => {
    expect(PAGE).toMatch(/missingAttempt=\{missingAttempt\}/);
  });

  it('it is a counter, not a boolean — the whole point', () => {
    expect(PAGE).toMatch(/useState\(0\)/);
    expect(PAGE).toMatch(/const \[missingAttempt, setMissingAttempt\]/);
  });
});
