/* [FIX-20260819-DIVIDERHELPERLABEL] what the suppressed-check divider shows
 * ===========================================================================
 * The divider is written when an unlinked customer's slip is refused WHILE an
 * admin holds the room: nothing goes to the customer, and this row is the only
 * way the operator learns what the bot would have said.
 *
 * Owner, 19/08, after seeing `ผลตรวจสลิป: [[[customer-helper]]]` on that screen:
 * a marker is markup, not an answer. For that one case the divider must read
 * "ไม่พบข้อมูลการลงทะเบียนของสมาชิก" instead.
 *
 * These are BEHAVIOURAL specs — real inputs, real output — which is why the
 * decision was lifted out of `webhook.service.ts` into its own pure function.
 * The rule it must never break: any copy WITHOUT the marker is passed through
 * untouched, because that copy is the operator's own words.
 * ไม่มี marker = ส่งข้อความจริงผ่านไปเหมือนเดิม.
 */
/* eslint-disable no-restricted-imports -- the webhook barrel deliberately does not
   export hook-reply internals; the sibling specs for this area import the same way. */
import {
  SUPPRESSED_CHECK_HELPER_LABEL,
  resolveSuppressedCheckText,
} from '@/modules/webhook/hook-reply/suppressed-check-divider';

const HELPER = '[[[customer-helper]]]';
const RESOLVED = 'ยังไม่พบข้อมูลการลงทะเบียนค่ะ กดปุ่มด้านล่างเพื่อลงทะเบียน';

describe('[FIX-20260819-DIVIDERHELPERLABEL] resolveSuppressedCheckText', () => {
  it('shows the operator label when the copy carries the helper marker', () => {
    expect(resolveSuppressedCheckText(HELPER, RESOLVED)).toBe(
      SUPPRESSED_CHECK_HELPER_LABEL,
    );
    expect(
      resolveSuppressedCheckText(`ยังไม่พบข้อมูล ${HELPER}`, RESOLVED),
    ).toBe(SUPPRESSED_CHECK_HELPER_LABEL);
  });

  it('matches the marker case-insensitively, like the card builder does', () => {
    expect(resolveSuppressedCheckText('[[[Customer-Helper]]]', RESOLVED)).toBe(
      SUPPRESSED_CHECK_HELPER_LABEL,
    );
  });

  it('passes ordinary operator copy through untouched', () => {
    const plain = 'กรุณาผูกบัญชีก่อนส่งสลิปนะคะ';
    expect(resolveSuppressedCheckText(plain, plain)).toBe(plain);
    expect(resolveSuppressedCheckText('', RESOLVED)).toBe(RESOLVED);
    expect(resolveSuppressedCheckText(null, RESOLVED)).toBe(RESOLVED);
    expect(resolveSuppressedCheckText(undefined, RESOLVED)).toBe(RESOLVED);
  });

  it('leaves every OTHER marker alone — only customer-helper is relabelled', () => {
    // Owner scope, 19/08: "เราแค่ทำ flow นี้เป๊ะๆเท่านั้น".
    const assist = 'ส่งให้แอดมิน [[[assist]]]';
    expect(resolveSuppressedCheckText(assist, assist)).toBe(assist);
  });

  it('never returns an empty string — the divider must always say something', () => {
    expect(resolveSuppressedCheckText(HELPER, '')).toBe(
      SUPPRESSED_CHECK_HELPER_LABEL,
    );
    expect(resolveSuppressedCheckText('', '')).toBe('');
  });

  it('the label is the exact wording the owner asked for', () => {
    expect(SUPPRESSED_CHECK_HELPER_LABEL).toBe(
      'ไม่พบข้อมูลการลงทะเบียนของสมาชิก',
    );
  });
});
