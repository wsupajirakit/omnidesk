/**
 * [FIX-20260830-HALFTRAY] TOMBSTONE for [FIX-20260830-TRAYCAPSCALE].
 *
 * The `tc-tray-cap` mechanism this file used to pin is GONE with its problem:
 * trays no longer carry ANY height cap. The root gives the composer its share
 * of the screen (half in default mode, all of it in fullscreen), the box and
 * tray are `flex-1 min-h-0` fillers, and the shrink-0 rows take their height
 * first — so there is no cap left for a fixed-scale tray to inflate and no way
 * for the send row to be starved. What survives here is the guard that the old
 * mechanism can never half-return.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { chatTrayPanelClass } from '../hooks/chatTrayMode';

const SRC = readFileSync(resolve(__dirname, '../pages/chat/TicketChat.tsx'), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('the dead cap stays dead', () => {
  it('no tray emits tc-tray-cap any more', () => {
    for (const mode of ['default', 'full', undefined, 'garbage']) {
      expect(chatTrayPanelClass(mode, 'p-2 max-h-48 overflow-y-auto')).not.toContain('tc-tray-cap');
    }
  });

  it('TicketChat does not reference it outside comments', () => {
    expect(strip(SRC)).not.toContain('tc-tray-cap');
  });

  it('every tray still scrolls inside a shrinkable filler — the living replacement', () => {
    const c = chatTrayPanelClass('default', 'p-2 max-h-48 overflow-y-auto');
    expect(c).toContain('overflow-y-auto');
    expect(c).toContain('flex-1');
    expect(c).toContain('min-h-0');
    expect(c).not.toMatch(/max-h-/);
  });
});
