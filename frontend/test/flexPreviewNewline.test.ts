/* [FE] [FIX-20260824-FLEXNEWLINE] A newline typed into a Flex text does not show.
 *
 * REPORTED: a card whose text contains `\n\n` renders as one run-on line — in the
 * chat page AND in the flex edit/create preview, identically.
 *
 * ROOT CAUSE, MEASURED rather than reasoned about. Running the installed
 * `flex-render` directly:
 *   · the newline SURVIVES into the HTML — the library emits `<p>AAA\nBBB</p>`
 *   · no `<br>` is ever emitted, for any value of `wrap`
 *   · `wrap` selects a CLASS, and the library stylesheet does the rest:
 *       .flex-preview .MdTxt p          { white-space: nowrap }   ← wrap absent/false
 *       .flex-preview .MdTxt.ExWrap p   { white-space: normal }   ← wrap: true
 * `normal` collapses a newline to a space. So the character is there and the CSS
 * throws it away. Nothing in storage, the editor, or tag substitution is at
 * fault — those were checked and all preserve it.
 *
 * THE FIX is one declaration: `pre-line` for the wrapped case only. That is what
 * LINE itself does — a newline counts when `wrap` is on, and does not when it is
 * off — so the preview stops disagreeing with the app.
 *
 * ⚠️ SCOPED TO THE WRAPPED CASE ON PURPOSE. Making the unwrapped case honour
 * newlines too would make the preview lie in the other direction: LINE renders
 * `wrap: false` as a single clipped line no matter what the text contains. The
 * card in the report needs `"wrap": true` in its own JSON as well — that is
 * data, not code, and this change does not invent it.
 *
 * ⚠️ BLAST RADIUS: `FlexBubble` is the single renderer for every card the
 * dashboard displays — slip, notice, profile, broadcast. This changes how a
 * newline inside any wrapped text renders in the DASHBOARD only. It cannot
 * affect what LINE shows a customer: nothing here is sent anywhere.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render } from 'flex-render';

const bubble = (wrap?: boolean) => ({
  type: 'bubble',
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'text',
        text: 'บรรทัดหนึ่ง\nบรรทัดสอง',
        ...(wrap === undefined ? {} : { wrap }),
      },
    ],
  },
});

const appCss = () => readFileSync(join(process.cwd(), 'index.css'), 'utf8');

describe('[FLEXNEWLINE] a newline inside a wrapped Flex text survives to the screen', () => {
  it('(M1 MEASUREMENT) the library keeps the newline in the HTML — it is CSS that drops it', () => {
    // If this ever fails, the diagnosis above is wrong and the fix is in the
    // wrong layer. It is asserted rather than assumed for exactly that reason.
    const html = render(bubble(true) as never);
    expect(html).toContain('บรรทัดหนึ่ง\nบรรทัดสอง');
    expect(html).not.toMatch(/<br\s*\/?>/i);
  });

  it('(M2 MEASUREMENT) `wrap` only picks a class — ExWrap is present with it, absent without', () => {
    expect(render(bubble(true) as never)).toContain('ExWrap');
    expect(render(bubble(false) as never)).not.toContain('ExWrap');
    expect(render(bubble() as never)).not.toContain('ExWrap');
  });

  it('⭐ (T1 TARGET) the app overrides the wrapped case to pre-line', () => {
    const css = appCss();
    const rule = /\.flex-preview\s+\.MdTxt\.ExWrap\s+p\s*\{[^}]*white-space:\s*pre-line/;
    expect(rule.test(css)).toBe(true);
  });

  it('⭐ (P1 PIN) the UNWRAPPED case is left alone — the preview must not lie the other way', () => {
    // LINE clips `wrap: false` to one line whatever the text holds. An override
    // that caught the unwrapped selector too would show breaks the customer
    // will never see.
    const css = appCss();
    const wrapped = css.replace(
      /\.flex-preview\s+\.MdTxt\.ExWrap\s+p\s*\{[^}]*\}/g,
      '',
    );
    // no rule anywhere in our css sets pre-line on the plain .MdTxt p selector
    expect(wrapped).not.toMatch(
      /\.flex-preview\s+\.MdTxt\s+p\s*\{[^}]*white-space:\s*pre-line/,
    );
  });
});
