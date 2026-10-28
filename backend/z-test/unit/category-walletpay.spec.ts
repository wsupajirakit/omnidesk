/* [FEAT-20260815-WALLETPAYCAT] a tool whose only payment leg is walletpay is its own category
 * ===========================================================================
 * REPORTED LIVE (owner, 15 Aug 2026): linking OAs to the `walletpay` tool on the
 * Custom Tools page dropped `Shop-API v1` to "0 OA" and broke the binding —
 * *"perm มันหายจริง"*.
 *
 * WHY IT HAPPENED: `deriveCategory` answered `'payment'` for BOTH tools, because
 * both carry a role from `PAYMENT_ROLES`. The page's OA-link button writes the
 * single `hook.custom_tool_id`, so linking the second tool overwrote the first.
 *
 * WHY THE OBVIOUS FIX WAS WRONG: refusing to re-link an OA was tried first and
 * reverted the same day. An OA legitimately needs BOTH — Shop-API v1 runs topup
 * (`payment_tool_id`), walletpay runs the walletpay leg (`walletpay_tool_id`). They are
 * different jobs, so blocking the second link blocked the feature.
 *   *"สองอันนี้คนละอย่างกันนะ"* · *"ต้องผูกได้ทั้งสอง"*
 *
 * THE RULE THIS PINS — read the two legs, not one:
 *   has pay_topup                → 'payment'   (Shop-API v1: unchanged)
 *   has pay_walletpay, no pay_topup → 'walletpay'    (NEW)
 *   neither                      → 'generic'
 *
 * ⚠️ A tool carrying BOTH legs stays `'payment'`. That is the historical
 * single-tool layout the runner still supports (`payment-runner.service.ts`
 * falls back to a `pay_walletpay` endpoint on the payment tool itself), and
 * demoting it would strip the topup gate at `:614` from a tool that runs topup.
 */
/* `deriveCategory` is not on the hooks barrel, and adding it there would widen
   the module's public surface for a test. The neighbouring spec that covers the
   same function (`category-from-role.spec.ts`) reaches into the file the same
   way, so this follows the pattern already in place rather than inventing a
   second one. */
// eslint-disable-next-line no-restricted-imports
import {
  TOOL_CATEGORIES,
  deriveCategory,
} from '@/modules/hooks/custom-tool-normalize';

const ep = (role: string, key = role.toUpperCase()) => ({ role, key });

describe('[WALLETPAYCAT] deriveCategory tells the two payment legs apart', () => {
  it('walletpay-only is its own category', () => {
    expect(deriveCategory([ep('pay_walletpay')])).toBe('walletpay');
  });

  /* The one that must not move. Shop-API v1 runs topup and the runner gates it on
     `category === 'payment'` (`payment-runner.service.ts:614`); answering
     anything else here would silently disable every top-up. */
  it('topup stays payment — Shop-API v1 is untouched', () => {
    expect(deriveCategory([ep('pay_topup')])).toBe('payment');
  });

  it('a tool carrying BOTH legs stays payment', () => {
    expect(deriveCategory([ep('pay_topup'), ep('pay_walletpay')])).toBe(
      'payment',
    );
    // order must not matter
    expect(deriveCategory([ep('pay_walletpay'), ep('pay_topup')])).toBe(
      'payment',
    );
  });

  it('no payment leg is still generic', () => {
    expect(deriveCategory([ep('customer_profile'), ep('site_rules')])).toBe(
      'generic',
    );
    expect(deriveCategory([])).toBe('generic');
  });

  /* A disabled line still decides the category — same rule the original
     function documents: switching an endpoint off is temporary, and flipping
     the category would ALSO unbind the tool from every OA. */
  it('a disabled walletpay line still counts', () => {
    expect(deriveCategory([{ ...ep('pay_walletpay'), status: false }])).toBe(
      'walletpay',
    );
  });

  it('walletpay is a declared category, so validation accepts it', () => {
    expect(TOOL_CATEGORIES).toContain('walletpay');
    expect(TOOL_CATEGORIES).toContain('payment');
    expect(TOOL_CATEGORIES).toContain('generic');
  });
});
