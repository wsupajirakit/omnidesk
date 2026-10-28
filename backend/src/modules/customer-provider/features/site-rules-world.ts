/**
 * [FEAT-20261018-SITERULESWORLD] Do site rules reach the AI on this site?
 *
 * Two keys, AND-ed: the PROVIDER decides whether its site has a site-rules world at all
 * (`siteRules` in `provider-features.ts` — absent = on, loan_v1 declares `false`), and the
 * OA's own switch `ai_raw_site_rules` still decides per OA, exactly `=== true` as before.
 * ⇒ shop-api (declares nothing) answers the switch alone, byte-for-byte today's behaviour.
 * ⇒ loan_v1 answers false whatever the switch says, so NEITHER prompt block is sent — the
 *   data block (empty there anyway) nor the "กฏการใช้ข้อมูล Site Rules" guide block, which
 *   used to go to the model with no data behind it.
 *
 * One function, one caller (`webhook/gates/ask-model.step.ts`); both prompt paths read the
 * request's `sendSiteRules` from there. revert: put `hook?.['ai_raw_site_rules'] === true`
 * back at that call site and delete this file + its barrel line.
 */
import { providerFeatureOn } from './active-provider';

export function siteRulesReachAi(hookSwitch: unknown): boolean {
  return hookSwitch === true && providerFeatureOn('siteRules');
}
