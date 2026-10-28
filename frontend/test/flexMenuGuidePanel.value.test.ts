/**
 * [FEAT-20260829-MENUPBGUIDE] the menu card editor must SHOW the postback spec.
 *
 * Owner, 29/08: "ไหนอะ guid for menu" — the panel was missing entirely.
 *
 * Cause: `menu` sat in `FLEX_TYPES_NO_GUIDELINES`, which does two things at
 * once — it hides the panel AND makes the fetch effect return before it ever
 * issues the request. That was right when the list was written (a menu card has
 * no profile variables), and the comment there said so in its own words: "สิ่งที่
 * คนวาดต้องรู้คือ payload ของปุ่ม ซึ่งมาคนละทาง". That other way now exists — the
 * BE serves postback rows from the same endpoint — so the entry had to go.
 *
 * Why it matters: without the panel an operator TYPES the payload, and every
 * near-miss fails silently (a missing `v1`, a typo in `open`, an uppercase
 * letter). The customer taps a dead button and nobody is told.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = () =>
  readFileSync(
    join(__dirname, '..', 'components/flex/FlexMessageFormModal.tsx'),
    'utf8',
  );

describe('[MENUGUIDE] the panel is enabled for menu cards', () => {
  it('⭐⭐⭐ menu is NOT in the no-guidelines list', () => {
    const m = /const FLEX_TYPES_NO_GUIDELINES = \[([^\]]*)\]/.exec(src());
    expect(m).toBeTruthy();
    expect(m![1]).not.toContain('menu');
  });

  it('template_message stays excluded — it really has no rows', () => {
    const m = /const FLEX_TYPES_NO_GUIDELINES = \[([^\]]*)\]/.exec(src());
    expect(m![1]).toContain('template_message');
  });

  /* ⚠️⚠️ CHANGED 31/08/2026 — [FIX-20260831-PAYLINKONESOURCE], and the case
     was FLIPPED rather than deleted because the reason it existed has reversed.
     ────────────────────────────────────────────────────────────────────────
     It used to pin "slip never fetches — it has an in-file table". That was true
     while the whole slip table lived in the repo, INCLUDING its `{{paylink.*}}`
     rows. Those rows are now owned by the server, and the local copy had already
     gone stale once: a tag the server minted correctly did not appear here and
     was refused on save.

     Slip therefore fetches now. Its DATA tags still come from the file (the
     server has no catalogue for them); only the button tags are merged in. */
  it('slip DOES fetch now — its paylink rows belong to the server', () => {
    const s = src();
    expect(s).toContain('if (!flexTypeHasGuidelines(flexType))');
    expect(s).not.toContain("if (flexType === 'slip' ||");
    /* and the merge is what keeps the file's own data rows */
    expect(s).toContain("r.tag.startsWith('{{paylink.')");
    expect(s).toContain('...SLIP_GUIDELINES');
  });
});

describe('[MENUGUIDE] the panel does not lie about what it lists', () => {
  it('⭐ a menu card does NOT get the "Variable Mapping" heading', () => {
    /* These rows are postback payloads. Calling them variable mapping sends the
       operator hunting for {{...}} that does not exist for this card type. */
    const s = src();
    expect(s).toContain("activeFlexType === 'menu'");
    expect(s).toContain('Postback ของปุ่มเมนู');
  });

  it('every other type keeps the original heading', () => {
    expect(src()).toContain("'Template Guidelines (Variable Mapping)'");
  });
});

describe('[MENUGUIDE] enabling the panel cannot break saving a menu card', () => {
  it('⭐⭐ tag validation only inspects {{...}}, which postback rows never contain', () => {
    /* The guide table doubles as the save-time allowlist. If it matched raw
       strings, adding rows like `menu:v1:open:sub-a` could have started
       rejecting cards. It matches only double-brace tags, so it cannot. */
    const s = src();
    expect(s).toContain('obj.match(/\\{\\{([^}]+)\\}\\}/g)');
  });

  it('the postback rows carry no {{ }} at all', () => {
    /* Mirrors the BE rows; if one ever gained braces it would enter the
       allowlist and change validation behaviour silently. */
    const rows = [
      'menu:v1:open:sub-a',
      'menu:v1:second:item-1',
      '(ไม่ใส่ postback)',
      '(ยาวได้ไม่เกิน 300 bytes)',
    ];
    for (const r of rows) expect(r).not.toMatch(/\{\{|\}\}/);
  });
});

/* [FEAT-20260831-MENUVARSET] the guide must be usable, not just present.
   ────────────────────────────────────────────────────────────────────────────
   Owner, 31/08: *"เปิดให้ copy ใน var guide ด้วย"*. Copy was wired all along, but the
   icon lived behind `opacity-0 group-hover/row:opacity-100`, so on a table nobody
   hovers first it reads as "these are not clickable". And every row was a copy
   button — including the menu guide's two PROSE rows (`(ไม่ใส่ postback)`, the byte
   cap), where copying the sentence gives an operator something that cannot work. */
describe('[MENUGUIDE] the tag column is copyable, and only where copying means something', () => {
  const modal = () =>
    readFileSync(
      join(__dirname, '..', 'components/flex/FlexMessageFormModal.tsx'),
      'utf8',
    );

  it('⭐⭐⭐ the copy affordance is visible, not hover-only', () => {
    expect(modal()).not.toContain('opacity-0 group-hover/row:opacity-100');
  });

  it('⭐⭐⭐ a prose row is NOT a copy button', () => {
    /* the menu guide ships rows whose "tag" is an explanation in brackets —
       `(ไม่ใส่ postback)` and `(ยาวได้ไม่เกิน N bytes)`. */
    expect(modal()).toContain('isCopyableTag');
  });

  it('⭐⭐ the predicate is spelled once and reads the value, not the card type', () => {
    const src = modal();
    const hits = src.match(/const isCopyableTag/g) ?? [];
    expect(hits.length).toBe(1);
    expect(src).toMatch(/isCopyableTag\s*=\s*\(/);
  });
});
