/* [FE] [FIX-20260824-DRAGDEEPER] The composer can be dragged 30% shorter.
 *
 * WHAT THE OWNER ASKED FOR: in a room where a conversation is happening, the
 * composer already has a drag grip. They want to be able to drag it DOWN
 * further — another 30% — so a long chat can be read without the composer
 * eating the screen. Explicitly: without re-laying-out anything inside it.
 *
 * WHAT THAT MEANS IN CODE: `areaH` is the TEXTAREA's height, not the whole
 * composer's — it is applied to one `style={{ height: areaH }}` and nothing
 * else. So the change is the floor of that one clamp, and nothing inside the
 * box moves or reflows. That is why this is three characters and not a layout
 * change.
 *
 * ⚠️ SOURCE PINS, not a render. `MIN_H` and `MAX_H` are locals inside a
 * 5,400-line component and are not exported; rendering it in jsdom is not
 * practical here, and `reopenTicketCard.test.ts` established reading the source
 * for exactly this component. Comments are stripped first so prose naming a
 * number cannot satisfy an assertion.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { DEFAULT_COMPOSER_H } from '../pages/chat/composerHeightMemory';
import { join } from 'path';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const source = ticketChatSource()
  /* ⚠️ LINE COMMENTS FIRST, then block comments — the order is load-bearing.
     Stripping `/* *\/` first swallowed real code in this file: a `/*` sitting
     inside a `//` comment opens a block that runs to the next `*\/`, and the
     constants this spec reads disappeared with it. The `[^:]` guard keeps
     `https://` out of the line-comment pass. ลำดับสลับไม่ได้ ไม่งั้นกินโค้ดจริง. */
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const numFromSource = (name: string): number => {
  const m = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(source);
  if (!m) throw new Error(`${name} is no longer a numeric const in TicketChat.tsx`);
  return Number(m[1]);
};

/** What the floor was before the owner asked for another 30%. */
const PREVIOUS_MIN_H = 56;

describe('[DRAGDEEPER] the composer drags 30% further down', () => {
  it('⭐ (T1 TARGET) the floor is 30% lower than it was', () => {
    const min = numFromSource('MIN_H');
    // 56 → 39 (56 × 0.7 = 39.2, rounded down so the drag reaches the full 30%)
    expect(min).toBeLessThanOrEqual(Math.round(PREVIOUS_MIN_H * 0.7));
    expect(min).toBeGreaterThan(0);
  });

  it('(T2) the floor still leaves the textarea usable — one line of text fits', () => {
    // text-sm is 14px with a ~1.5 line-height, and the textarea carries p-2
    // (8px top + 8px bottom). Anything under ~37px would clip the first line,
    // and a box you cannot read one line in is not "smaller", it is broken.
    expect(numFromSource('MIN_H')).toBeGreaterThanOrEqual(37);
  });

  it('⭐ (P1 PIN) the ceiling did not move — only the floor was asked for', () => {
    expect(numFromSource('MAX_H')).toBe(416);
  });

  it('⭐ (P2 PIN → 156) the default opening height moved ONCE, by owner order', () => {
    /* [FEAT-20260830-INPUT30] 30/08: the owner asked the default-mode input to
       open 30% taller — 120 → 156. That is the ONE sanctioned move; this pin
       keeps guarding against silent drift from here. */
    expect(DEFAULT_COMPOSER_H).toBe(156);
  });

  it('(P3 PIN) the clamp is still a clamp, and still on both ends', () => {
    /* [FIX-20260910-COMPACTSOURCE] BACK TO THE ORIGINAL LITERAL, and that is the
       point. A measured `areaCeiling()` was briefly added here so a drag could
       not push the preview strip's lower rows off screen — then the strip's
       source field was CAPPED instead (`PREVIEW_SOURCE_H`), which makes that
       overflow impossible rather than merely bounded. A guard that can no longer
       fire is debt, so it went, and the clamp is one number again. */
    expect(source).toContain('Math.max(MIN_H, Math.min(MAX_H, next))');
    expect(source).not.toContain('areaCeiling');
  });

  /* [FIX-20260830-GRIPWHOLE] REPLACED, not deleted — the owner reversed this
     exact decision on 30/08. The old case pinned "the drag resizes the textarea
     and nothing else"; the owner's report was *"เวลาลากสามขีดมันได้ลากไปแค่กล่อง
     input"* and, asked which behaviour he wanted, chose that the grip must grow
     the WHOLE composer, the open tray included. So the premise this case
     protected is deliberately gone.

     What the file was REALLY protecting is still pinned, and is what this
     replacement asserts: the drag is still ONE clamped number (`areaH`) with
     exactly one consumer, so the 24/08 rules in composerHeightMemory.ts still
     see the whole drag. Only the element that number lands on changed.
     The new contract is pinned in full by chatGripWholeComposer.value.test.ts. */
  /* [FIX-20260830-COMPOSERIDLEH] CONTRACT CHANGED, deliberately.
     This used to pin "the textarea never carries a pixel height again", which
     was the right reading of the 30/08 grip complaint but too broad. Putting the
     dragged height on the BOX unconditionally made the box a fixed height even
     with no tray open, so at the default 120 it was forced to 198px of chrome +
     nothing and the surplus showed as dead space under the caret — the owner's
     second 30/08 screenshot.
     The rule is now conditional on there being a tray to share the height with:
     tray open → the box carries it (the grip grows the tray, as required);
     no tray → the textarea carries it and the box sizes to content, which is
     the pre-GRIPWHOLE compactness. So `areaH` reaching the textarea is once
     again correct — what must stay true is that it is still ONE number with one
     consumer per branch, and that the two branches are mutually exclusive. */
  it('(P4 PIN, rewritten) the drag is still ONE number, one consumer per branch', () => {
    // `areaH` feeds exactly one derived box height, applied to exactly one element
    const derived = source.match(/const\s+composerBoxH\s*=/g) ?? [];
    expect({ derivedHeights: derived.length }).toEqual({ derivedHeights: 1 });
    const boxStyle = source.match(/const\s+composerBoxStyle\s*=/g) ?? [];
    expect({ boxStyles: boxStyle.length }).toEqual({ boxStyles: 1 });
    const consumers = source.match(/height:\s*composerBoxH/g) ?? [];
    expect({ heightConsumers: consumers.length }).toEqual({ heightConsumers: 1 });

    // the textarea branch exists again, and is ALSO exactly one number
    const taStyle = source.match(/const\s+textareaStyle\s*=/g) ?? [];
    expect({ textareaStyles: taStyle.length }).toEqual({ textareaStyles: 1 });
    /* [FIX-20261019-STALEPIN] the textarea branch reads `effectiveAreaH`, not `areaH`, since commit
       a34be6e (18/09) — owner rule [FIX-20260918-TRAYHALFAREA]: with the quick-reply / emoji /
       sticker panel open in DEFAULT mode the typing area takes HALF the dragged height (never under
       44px) so the panel is not squeezed out of sight; expanded mode untouched. That commit did not
       update this pin, which kept asserting the pre-rule `height: areaH` and failed since. Still
       ONE number: `effectiveAreaH` is derived from `areaH` alone (pinned below). */
    const taConsumers = source.match(/height:\s*effectiveAreaH\b/g) ?? [];
    expect({ effectiveAreaHConsumers: taConsumers.length }).toEqual({ effectiveAreaHConsumers: 1 });
    const derivedTa = source.match(/const\s+effectiveAreaH\s*=/g) ?? [];
    expect({ effectiveAreaHDecls: derivedTa.length }).toEqual({ effectiveAreaHDecls: 1 });
    expect(source).toMatch(
      /const effectiveAreaH =\s*trayPanelOpen && !isFullTray\s*\?\s*Math\.max\(44, Math\.round\(areaH \/ 2\)\)\s*:\s*areaH;/,
    );

    /* ⭐ the branches must be MUTUALLY EXCLUSIVE — if both a box height and a
       textarea height could apply at once the drag would be counted twice and
       the box would grow by roughly double what the pointer moved. */
    /* [FIX-20260830-REALFULL] the two branches are complementary by
       construction now: the box carries the height unless (locked || truly
       fullscreen), and the textarea carries it exactly in those two states. */
    const ta = source.slice(
      source.indexOf('const textareaStyle'),
      source.indexOf('const textareaStyle') + 260,
    );
    expect(ta).toMatch(/composerLocked \|\| anyTrayOpen/);
    const box = source.slice(
      source.indexOf('const composerBoxStyle'),
      source.indexOf('const composerBoxStyle') + 260,
    );
    expect(box).toMatch(/!composerLocked && !anyTrayOpen/);
  });
});
