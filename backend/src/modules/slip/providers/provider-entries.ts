/**
 * ==== [FEAT-20260903-PROVIDERSWITCH] one line per provider, one word to switch =
 *
 * WHAT THIS IS FOR. Owner, 03/09: a provider must be switchable on and off, and
 * editable, **as easily as possible** — wrapped, and separated per provider. So
 * every provider is ONE self-describing entry here and nothing else anywhere:
 *
 *     turn one on/off   →  flip `enabled` on its line. Nothing else changes.
 *     add a new one     →  write its file, add ONE line here. `index.ts` never
 *                          changes again, and no other provider's line is touched.
 *     remove one        →  delete its line and its folder.
 *
 * ⇒ THE ENTRIES ARE INDEPENDENT BY CONSTRUCTION. No entry reads another, the
 * order carries no meaning (see `DEFAULT_SLIP_PROVIDER` below), and a disabled
 * entry costs nothing at runtime beyond an import it already had for its spec.
 * เปิดปิดได้ทีละเจ้า · เพิ่มเจ้าใหม่ = บรรทัดเดียว · ไม่กระทบเจ้าอื่นเลย
 *
 * 🔴 THE KEY IS `provider.name`, NOT A STRING TYPED HERE. The map used to be
 * written `swiftcheck: swiftcheckProvider`, which states the same fact twice and lets
 * the two drift: a hook would store the map key while `resolveSlipProvider`
 * matched on it and the provider answered to a different `name`, so the stamp on
 * the slip row and the configured value would disagree with nothing failing.
 * Deriving the key makes them one fact. ชื่อมีที่เดียว จะขัดกันเองไม่ได้
 *
 * ⚠️ WHY NOT AN ENV VAR. It was considered and rejected: an env nobody sets is
 * the debt `[FIX-20260829-STRIKEENVDEAD]` had to be undone in production, the
 * standing rule is that staging keeps Swiftcheck with NOTHING configured, and a
 * runtime toggle on the money path can be flipped without a review, without a
 * test run, and without the tripwire below ever firing. A line of code is the
 * heavier switch on purpose. ไม่ทำเป็น env — สวิตช์เส้นเงินต้องผ่านรีวิวและเทส
 *
 * ⚠️ ENABLING A SECOND ENTRY IS NOT A FREE ACTION. It goes RED in
 * `slip-provider-hook-field.spec.ts`, on purpose: that tripwire names the two
 * bugs a second provider arms (the clone/credential pair, and the payment leg
 * forwarding a new envelope to Shop-API). Read it before flipping anything.
 *
 * revert: put `SLIP_PROVIDERS` back as an object literal in `index.ts` and delete
 * this file.
 */
import { slipguardProvider } from './slipguard/slipguard.provider';
import { swiftcheckProvider } from './swiftcheck/swiftcheck.provider';

import type { SlipProvider } from './slip-provider.port';

/** One provider, and whether it may be chosen. */
export interface SlipProviderEntry {
  readonly provider: SlipProvider;
  /**
   * `false` = written and tested, but not selectable: `resolveSlipProvider`
   * cannot return it, the field-options endpoint does not offer it, and the
   * dashboard picker stays hidden because `choice_count` does not rise.
   */
  readonly enabled: boolean;
  /**
   * 🔴 THE ONE EVERY HOOK USES UNLESS IT SAYS OTHERWISE. Exactly one entry
   * carries it, and it must also be `enabled` — both enforced below at module
   * load, because a registry with no default (or two) is a code error and
   * failing at boot beats failing on a customer's slip.
   *
   * ⚠️ IT IS A MARK HERE RATHER THAN A SEPARATE CONSTANT so the provider is
   * named ONCE in this file. It used to be `DEFAULT_SLIP_PROVIDER =
   * swiftcheckProvider`, a second mention that could drift from the list.
   *
   * ⚠️ AND IT IS NOT POSITIONAL. Deriving "the default" from the first entry
   * would mean reordering this array silently changes which vendor verifies
   * money for the whole fleet.
   *
   * ⚠️ MOVING THIS MARK IS A RULE-B CHANGE. `slip-provider-rules.spec.ts`
   * asserts the default IS Swiftcheck by identity — not merely "a provider" — so
   * moving it turns a named rule red rather than sliding through.
   */
  readonly isDefault?: boolean;
}

/**
 * 🔴 THE SWITCHBOARD. One line per provider — this is the only place that decides
 * which ones exist.
 */
export const SLIP_PROVIDER_ENTRIES: readonly SlipProviderEntry[] = [
  // The provider every hook uses unless it says otherwise — see `isDefault`.
  { provider: swiftcheckProvider, enabled: true, isDefault: true },
  /* OFF — written, measured against the live API and covered by
     `slip-provider-slipguard.spec.ts`, but not selectable yet.
     🔴 BEFORE FLIPPING THIS TO `true`: Shop-API must confirm it reads a new vendor's
     envelope, because a hook whose payment tool is ON forwards this provider's
     raw reply to it and the failure surfaces REMOTELY, after the slip is already
     verified, locked and answered ([DECISION-20260903-VERIFYFEEDSPAYMENT]).
     Flipping it also turns the tripwire red — read that spec's notes first. */
  { provider: slipguardProvider, enabled: false },
];

/**
 * Builds the name → implementation map from a list of entries.
 *
 * Exported as a pure function so a spec can drive it with a modified list and
 * prove that flipping one `enabled` is genuinely all it takes — rather than
 * asserting the current map and hoping the switch behaves.
 *
 * @returns only the ENABLED entries, keyed by each provider's own name.
 */
export const buildProviderRegistry = (
  entries: readonly SlipProviderEntry[],
): Record<string, SlipProvider> =>
  Object.fromEntries(
    entries.filter((e) => e.enabled).map((e) => [e.provider.name, e.provider]),
  );

/**
 * Picks the entry marked `isDefault`.
 *
 * 🔴 THROWS WHEN THE LIST IS AMBIGUOUS, and that is deliberate. This runs at
 * module load, so a registry with no default, two defaults, or a default that is
 * switched off takes the process down at boot — before a single customer's slip
 * reaches it, and red in every test run. The alternative is a silent fallback,
 * which on this path means "some vendor verifies money and nobody chose which".
 * ผิดตั้งแต่ boot ดีกว่าไปพังตอนลูกค้าส่งสลิป
 *
 * @throws when the entries do not name exactly one enabled default.
 */
export const resolveDefaultProvider = (
  entries: readonly SlipProviderEntry[],
): SlipProvider => {
  const defaults = entries.filter((e) => e.isDefault);
  if (defaults.length !== 1) {
    throw new Error(
      `slip provider registry must name exactly one default, found ${defaults.length}`,
    );
  }
  const [only] = defaults;
  if (!only?.enabled) {
    throw new Error(
      `slip provider registry names a DISABLED default (${only?.provider.name ?? '?'})`,
    );
  }
  return only.provider;
};
