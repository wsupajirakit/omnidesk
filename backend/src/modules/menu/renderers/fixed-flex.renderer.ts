/**
 * [FEAT-20260828-MENUTAG-S1] today's fixed-code look — a plain flex bubble:
 * title + one postback button per item. The owner will dictate the real look
 * (plan Q6); this stays deliberately minimal until then. Var placeholders in
 * strings pass through UNRESOLVED — resolution is S6's injected adapter.
 *
 * ⚠️ Buttons carry `menu:v1:` postbacks minted by the codec, so a payload that
 * would exceed LINE's 300-byte cap fails HERE at build time, loudly, never at
 * the customer.
 * ── WHAT A RENDERER MAY AND MAY NOT DO ─────────────────────────────────────
 * MAY: turn a definition plus a context into one LINE message object.
 * MUST NOT:
 *   · hand-write a postback payload. `buildMenuPostback` is the only minter, so
 *     a payload that would break LINE's 300-byte cap fails HERE at build time,
 *     never at the customer. A literal like `menu:open` parses as NOT OURS and
 *     the button is dead on arrival — that exact mistake is what
 *     menu-fixed-flex-renderer.spec.ts round-trips every button against.
 *   · make a button anything other than a postback action. A `message` button
 *     sends the LABEL as chat text: the postback door never fires, the text
 *     door sees prose, and nothing errors. The menu is simply dead.
 *   · resolve a variable. Titles and labels arrive already resolved (the engine
 *     resolves the DEFINITION first, precisely so no substitution pass ever
 *     walks the payloads this file mints).
 *   · read anything. A renderer is a pure function of (definition, context).
 *
 * revert: delete src/modules/menu/ whole.
 */
import { buildMenuPostback } from '../menu-postback.util';
import type { MenuDefinition } from '../scenarios/scenario.types';
import type { MenuRenderer, RenderedMenuMessage } from './renderer.port';

export class FixedFlexRenderer implements MenuRenderer {
  public render(definition: MenuDefinition): RenderedMenuMessage {
    return {
      type: 'flex',
      altText: definition.title,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: definition.title,
              weight: 'bold',
              size: 'md',
            },
            ...definition.items.map((item) => ({
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: {
                type: 'postback',
                label: item.label,
                data: buildMenuPostback(definition.key, item.id),
              },
            })),
          ],
        },
      },
    };
  }
}
