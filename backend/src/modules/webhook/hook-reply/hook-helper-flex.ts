/*
 * ==== [FEAT-20260812-HOOKHELPERFLEX] hook-field replies send the helper CARD ====
 *
 * ## What this is for
 * `missing_api_data_text` / `image_answer_text` / `default_answer_text` are fields an
 * operator types by hand, and operators routinely put the marker `[[[customer-helper]]]`
 * in them. The three sites that send those fields only ever sent TEXT, so the customer
 * saw the literal brackets — and even after `[FIX-20260812-HELPERMARKERLEAK]` stripped
 * them, the customer still got a plain sentence with no button.
 *
 * The AI-reply path already answers that same marker with a flex card carrying a real
 * "อนุญาตให้เชื่อมต่อ" button (`[FEAT-20260810-HELPERFLEX]`, webhook.service ~:3303).
 * Owner, 2026-08-12: *"ทำให้มันโหลด flex_customerhelper_id และ mint ปุ่มเหมือน ai"* —
 * the hook-field path must do exactly the same thing.
 *
 * ## Why a separate file
 * The owner asked repeatedly not to swell `webhook.service.ts`. This holds the whole
 * decision, so each of the three call sites is two lines and the feature can be lifted
 * out by deleting this file plus those lines.
 *
 * ## What it deliberately REUSES rather than reimplements
 *   · `resolveCustomerHelperFlex` — card lookup + the 3-layer permission gate
 *     (type must be `customerhelper`, not deleted, SAME GROUP as the hook). Rewriting
 *     that check here would be a way for one OA's card to leak to another.
 *   · `mintLinkToken` + `buildCustomerRegisterUrl` — the identical mint the AI path
 *     uses, so token shape and TTL match. No second mint implementation exists.
 * ⇒ the card an operator binds to `flex_customerhelper_id` renders the same on both
 *   paths, and a fix to either helper reaches both.
 *
 * ## ⚠️ NEVER THROWS
 * This sits on the customer reply path. Every failure — mint down, card missing, wrong
 * group, a malformed document — resolves to `null`, and `null` means the caller sends
 * its plain text exactly as it does today. A thrown error here would cost the customer
 * their reply entirely, which is far worse than a missing button.
 *
 * ## Switch
 * Reuses `hook_text_reply_mode` rather than adding a fourth flag, so an operator has one
 * dial for "how do hook-field replies treat this marker":
 *   'off' (default) · 'strip' · 'button'  → no card; behaviour unchanged
 *   'flex'                                → the card, mint and all
 *
 * revert: delete this file, the `[FEAT-20260812-HOOKHELPERFLEX]` blocks in
 *         webhook.service.ts (grep HOOKHELPERFLEX), and `'flex'` from the
 *         `hook_text_reply_mode` enum in hook.schema.ts.
 */
import { buildCustomerRegisterUrl } from './customer-register.handler';
import { resolveCustomerHelperFlex } from './customer-helper-flex';
import { hasCustomerHelperTag } from './reply-tags.util';

/** Everything this needs from the service, so it can be tested without Nest. */
export interface HookHelperFlexDeps {
  /** `CustomerLinkService.mintLinkToken` — the AI path's mint, not a copy. */
  mintLinkToken: (input: {
    hookId: unknown;
    channelUserId: unknown;
    channelType: string;
  }) => string | null | undefined;
  /** Reads a flex_messages row by id. Must resolve null rather than throw. */
  findFlexById: (id: unknown) => Promise<Record<string, unknown> | null>;
  warn?: (msg: string) => void;
}

export interface HookHelperFlexInput {
  /** The RAW field value, markers still in it — the marker is what triggers the card. */
  rawText: string | null | undefined;
  hook: Record<string, unknown> | null | undefined;
  /** LINE user id, for the mint. */
  channelUserId: unknown;
  /** Already-resolved `hook_text_reply_mode`. Only 'flex' produces a card. */
  mode: string;
}

/**
 * Build the customer-helper card for a hook-field reply, or `null` to send text.
 *
 * `null` is the safe answer and is returned whenever the mode is not 'flex', the field
 * carries no marker, or anything at all goes wrong.
 */
export async function buildHookHelperFlex(
  input: HookHelperFlexInput,
  deps: HookHelperFlexDeps,
): Promise<Record<string, unknown> | null> {
  /* [FIX-20260901-OFFMENUTAG] `off` now sends the card too, and ONLY these two.
   *
   * WHY. The owner's rule, 01/09: a customer who meets `[[[customer-helper]]]`
   * sees the CARD. Earlier the same day `off` was taught to strip the marker so
   * the raw brackets stopped reaching customers — but stripping alone left them
   * with `customer_helper_text`, which is the FALLBACK for when a card cannot be
   * built, not the intended reply. Half a fix reads as a whole one until someone
   * looks at a real conversation, which is how this was caught.
   *
   * `off` is not a choice anyone can make — the dashboard has no control for the
   * column (re-verified 01/09: four i18n labels, zero rendered inputs) — so it
   * can only mean "never configured". The marker is the opt-in, the same rule
   * `refusal-reply-mode.ts` established on 19/08.
   *
   * ⚠️ `strip` and `button` are EXCLUDED on purpose, and that is the whole point
   *    of naming two modes instead of inverting the check. Those two are settings
   *    an operator had to reach an API to write, and they mean "text only" and
   *    "text plus the quick reply". Sending a card to them would overrule a
   *    deliberate decision; sending one to `off` overrules nothing.
   *
   * The `null` return below is still the safe answer for everything else: no
   * marker, a mint failure, a missing card. The caller then sends the text that
   * `resolveHookTextReply` returned.
   *
   * revert: `if (input.mode !== 'flex') return null;` — `off` goes back to
   * sending `customer_helper_text` as plain text. */
  if (input.mode !== 'flex' && input.mode !== 'off') return null;

  // No marker ⇒ the operator wrote ordinary copy; a card would be an intrusion.
  if (!hasCustomerHelperTag(input.rawText ?? '')) return null;

  try {
    /* Mint exactly as the AI path does. A failed mint is NOT fatal: the card still
       goes out and `resolveCustomerHelperFlex` falls back to HELPER_FALLBACK_URI,
       which is deliberately google.com so a missing setting is visible. */
    let helperUri: string | null = null;
    try {
      const token = deps.mintLinkToken({
        hookId: input.hook?.['_id'],
        channelUserId: input.channelUserId,
        channelType: 'line',
      });
      if (token) {
        helperUri = buildCustomerRegisterUrl(
          input.hook?.['customer_link_landing_url'] as string | null,
          token,
        );
      }
    } catch (mintErr) {
      deps.warn?.(
        `[HOOKHELPERFLEX] mint failed: ${(mintErr as Error).message}`,
      );
    }

    /* The shared resolver: reads `flex_customerhelper_id`, enforces the permission
       gate, and falls back to the hard-coded card. It never throws. */
    return await resolveCustomerHelperFlex(input.hook, helperUri, {
      findFlexById: deps.findFlexById,
      warn: deps.warn,
    });
  } catch (err) {
    /* Belt to the resolver's braces — the caller must always be able to fall back
       to sending its text. */
    deps.warn?.(
      `[HOOKHELPERFLEX] card build failed, sending text: ${(err as Error).message}`,
    );
    return null;
  }
}
