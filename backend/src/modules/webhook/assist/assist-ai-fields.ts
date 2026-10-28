/**
 * [FEAT-20260909-DSREASONING] The three "which AI answered" fields the assist
 * summary needs, taken from the credentials the reply path already derived.
 * ===========================================================================
 * ## Why this file exists, and why it is three fields rather than one
 *
 * The summary shares the main bot's AI settings — owner, 09/09: the summary does
 * not get a vendor, a model or a reasoning setting of its own, it uses the one
 * the OA answers customers with. So all three come from the same place, at the
 * same moment, and they belong together.
 *
 * 🔴 IT ALSO PAYS FOR ITSELF UNDER THE SPINE RATCHET, AND THAT IS NOT AN
 *    ACCIDENT. `spine-size-ratchet.json` says the METHOD ceiling *"may only ever
 *    go down; there is no mechanism here to raise it, and there must never be
 *    one"*, and that *"new logic belongs in its own file behind a short call
 *    site … never as a new inline block in the spine."*
 *
 *    Adding `aiReasoning` to the spine's assist-args literal would have grown
 *    `processLockedEvent` by one line, which is forbidden outright. Replacing
 *    the two existing lines with one spread makes the method one line SMALLER
 *    while carrying one more field:
 *
 *        aiVendor,                  ─┐  2 code lines
 *        aiModel,                   ─┘
 *        ...assistAiFields(creds),  ──   1 code line, 3 fields
 *
 *    The ceiling is lowered by one in the same commit, which is the only shape
 *    of change that file accepts.
 *
 * ⚠️ NOT A GENERIC HELPER. It reads the credential bundle and returns exactly
 *    the assist args' three AI fields. Widening it into "map creds to args"
 *    would put the spine's shape into a file that has no reason to know it.
 *
 * revert: inline the three fields back into the assist-args literal in
 *         `webhook.service.ts` and raise the method ceiling by two — which the
 *         ratchet does not allow, so the revert is really "delete the reasoning
 *         feature", not "delete this file".
 */
import type { AssistTurnArgs } from './assist-turn-args';

/** The slice of the credentials bundle this reads — declared, not imported, so
 *  a change to the bundle's other fifteen fields cannot reach this file. */
export interface AssistAiCredentials {
  aiVendor: string | null;
  aiModel: string | null | undefined;
  deepseekReasoning?: AssistTurnArgs['aiReasoning'];
}

/**
 * @param creds the bundle `deriveRequestCredentials` built for this turn
 * @returns the assist args' AI fields, ready to spread
 */
export function assistAiFields(
  creds: AssistAiCredentials,
): Pick<AssistTurnArgs, 'aiVendor' | 'aiModel' | 'aiReasoning'> {
  return {
    aiVendor: creds.aiVendor,
    aiModel: creds.aiModel,
    /* `?? null` rather than passing undefined through: the args type treats
       both as "not set", but a null says the lookup ran and found nothing,
       while undefined cannot be told apart from a field nobody wired. This
       feature has now been bitten twice by that exact ambiguity. */
    aiReasoning: creds.deepseekReasoning ?? null,
  };
}
