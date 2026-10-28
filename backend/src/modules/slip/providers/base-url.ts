/**
 * ==== [FEAT-20260903-BASEURLPERPROVIDER] which host does THIS provider talk to?
 *
 * ONE function answers it, for every provider, and the answer comes from the
 * REGISTRY: each provider states its own host (`defaultBaseUrl`) and names the
 * deployment override it accepts (`baseUrlConfigKey`), both in its own file.
 * Owner's rule, 03/09: the provider registry is the single source of truth and it
 * is served from one place — no second list, no per-vendor branch anywhere else.
 * registry เป็นตัวจริงตัวเดียว · เสิร์ฟจุดเดียว · เจ้าใหม่ไม่ต้องแก้ที่นี่
 *
 * 🔴 THE BUG THIS EXISTS TO REMOVE. The flow used to answer
 *
 *     this.integration.swiftcheckApiBaseUrl || provider.defaultBaseUrl
 *
 * — a Swiftcheck-named env applied to EVERY provider. On a deployment that sets
 * `SWIFTCHECK_API_BASE_URL`, a second provider would have had its own path appended
 * to **Swiftcheck's host**: the customer's slip image and that vendor's API key
 * posted to the wrong company. Nothing errors, because the URL is still
 * syntactically valid — the call simply fails at the far end and is recorded as
 * an outage. Measured 03/09: the var is set in neither `.env.local` nor
 * `.env.example`, so it is armed rather than firing; the day someone sets it, it
 * fires. ตั้ง env วันไหน = กัดวันนั้น
 *
 * ⚠️ SCALES BY DOING NOTHING. Adding a provider does not touch this file. It uses
 * its own `defaultBaseUrl` unless it declares an override key, and declaring one
 * is a deliberate edit to the union in the port that the compiler checks.
 *
 * ⚠️ PROVIDERS STILL DO NOT READ CONFIG. This takes the config bag from the flow
 * — the only thing allowed to read it — and the parameter type narrows it to the
 * base-URL fields, so this function cannot see a secret even though the object it
 * is handed carries several. Same discipline as the API key, which is decrypted
 * at the call site and passed in as a plain value.
 *
 * revert: delete this file and restore `slip-flow.service.ts`'s `baseUrlFor` to
 * `this.integration.swiftcheckApiBaseUrl || provider.defaultBaseUrl`. To bring the
 * per-hook layer back instead, see [FIX-20260903-HOSTNOTAFIELD] on `resolveBaseUrl`
 * — it lists every file the field touched.
 */
import type { SlipProvider } from './slip-provider.port';

/**
 * Just the base-URL overrides, keyed by the same names providers declare. Typed
 * from the port's own union, so the two cannot drift: a key that is not a legal
 * `baseUrlConfigKey` cannot be read here.
 */
export type SlipBaseUrlConfig = Readonly<
  Partial<
    Record<NonNullable<SlipProvider['baseUrlConfigKey']>, string | undefined>
  >
>;

/**
 * @returns the host this provider must be called on.
 *
 * Order: the deployment override THIS provider named, when it is set and not
 * blank, otherwise the provider's own host. A blank or whitespace-only override
 * is treated as absent, because an env var set to `""` in a compose file is the
 * same intent as not setting it, and letting it through would produce a request
 * to a path with no host at all.
 *
 * 🔴 [FIX-20260903-HOSTNOTAFIELD] THERE IS NO PER-HOOK LAYER, AND THAT IS A
 * DECISION, NOT AN OMISSION. One existed for a few hours on 03/09: the host had
 * been read from a Swiftcheck-named env, the owner ruled env out, and "per hook" was
 * the first place to put it instead. Then the owner saw the form and ruled again —
 * an operator must not TYPE a host, and it does not belong in the database. The
 * value that decides is `provider.defaultBaseUrl`, in that vendor's own file, so a
 * vendor changing its URL is a one-line edit with nothing to migrate and no row to
 * update. Measured before removing it: 0 of 7 hooks held a value in either
 * database, so nothing was lost.
 * ⇒ host ไม่ใช่ค่าที่คนกรอก · อยู่ในไฟล์ของ provider บรรทัดเดียว
 *
 * ⚠️ WHY THE DEPLOYMENT KEY STAYS even though nothing sets it. It is the only
 * seam `slip-flow-parity.spec.ts` has for pointing the flow at a host it can
 * observe (`http://swiftcheck.invalid/v2`) while driving legacy at the same one — the
 * suite that proves Swiftcheck's behaviour has not moved. Removing it would take the
 * parity proof with it, which costs far more than a key that is set in none of
 * `.env.local`, `.env.example`, `docs/env-prod.example`, `docs/env-stg.example`
 * (re-measured 03/09). ⇒ คีย์นี้ไม่มีใครตั้ง เหลือไว้ให้ parity ฉีด host เท่านั้น
 */
export function resolveBaseUrl(
  provider: SlipProvider,
  config: SlipBaseUrlConfig,
): string {
  const key = provider.baseUrlConfigKey;
  /* Read exactly the one field the provider named. A provider that names none
     never reaches the config at all, which is what makes "a new vendor cannot
     accidentally inherit another vendor's host" true by construction rather
     than by everyone remembering. */
  const override = key ? config[key]?.trim() : undefined;
  return override || provider.defaultBaseUrl;
}
