/* [FIX-20260819-REFUSALMARKERMODE] the slip-refusal field opts in by its marker
 * ===========================================================================
 * Found in production 19/08: a customer uploaded a slip and received the literal
 * text `[[[customer-helper]]]` — twice. Root cause, dived before writing this:
 *   · `hook_text_reply_mode` defaults to 'off', and 'off' returns the raw string
 *     by contract (pinned in helper-marker-leak.spec.ts — NOT changed here);
 *   · the dashboard has no control for that mode (zero FE references), so the
 *     marker is the only request an operator can actually make.
 *
 * These specs pin the decision function that resolves the collision, and the
 * property that matters most: a field WITHOUT a marker must behave exactly as
 * it did before, for every mode. ของเดิมต้องไม่ขยับ.
 */
/* eslint-disable no-restricted-imports -- the webhook barrel deliberately does not
   export the hook-reply internals (see webhook/index.ts), and the sibling spec that
   pins this same area (`helper-marker-leak.spec.ts`) reaches in the same way. */
import { resolveRefusalReplyMode } from '@/modules/webhook/hook-reply/refusal-reply-mode';

const HELPER = '[[[customer-helper]]]';
const ASSIST = '[[[assist]]]';

describe('[FIX-20260819-REFUSALMARKERMODE] marker-driven mode for the refusal field', () => {
  it('upgrades an unconfigured hook to flex when the helper marker is present', () => {
    expect(resolveRefusalReplyMode(HELPER, 'off')).toBe('flex');
    expect(resolveRefusalReplyMode(`ยังไม่พบข้อมูล ${HELPER}`, 'off')).toBe(
      'flex',
    );
  });

  it('leaves every OTHER marker exactly as it behaves today', () => {
    // Owner, 19/08: "จะเอาแค่ slip_require_profile_text = รองรับ flex mint ปุ่ม".
    // `[[[assist]]]` in an unconfigured hook keeps its current behaviour —
    // widening this would change OAs that never asked for a change.
    expect(resolveRefusalReplyMode(ASSIST, 'off')).toBe('off');
    expect(resolveRefusalReplyMode(`ส่งให้แอดมิน ${ASSIST}`, 'off')).toBe(
      'off',
    );
  });

  it('leaves a plain-text field completely alone', () => {
    expect(
      resolveRefusalReplyMode('ยังไม่ได้ผูกบัญชี กรุณาผูกก่อน', 'off'),
    ).toBe('off');
    expect(resolveRefusalReplyMode('', 'off')).toBe('off');
    expect(resolveRefusalReplyMode(null, 'off')).toBe('off');
    expect(resolveRefusalReplyMode(undefined, 'off')).toBe('off');
  });

  it('never overrides an operator who already chose a mode', () => {
    for (const chosen of ['strip', 'button', 'flex'] as const) {
      expect(resolveRefusalReplyMode(HELPER, chosen)).toBe(chosen);
      expect(resolveRefusalReplyMode(ASSIST, chosen)).toBe(chosen);
      expect(resolveRefusalReplyMode('plain', chosen)).toBe(chosen);
    }
  });

  it('matches the marker case-insensitively, like the resolver does', () => {
    expect(resolveRefusalReplyMode('[[[Customer-Helper]]]', 'off')).toBe(
      'flex',
    );
  });
});
