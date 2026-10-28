/**
 * [FEAT-20260831-MENUVARSET] What a MENU card is allowed to use — and nothing else.
 * ===========================================================================
 * The guide table is not decoration: `FlexMessageFormModal` builds its save-time
 * allowlist from these rows, so whatever appears here is what an operator may
 * type, and whatever is missing is rejected before the card is stored.
 *
 * Owner, 31/08: a menu card may use these families —
 *   · `menu:v1:open:<slug>` … the postback payloads (already served)
 *   · `{{hook_*}}` ………………… the OA's own context values (already served)
 *   · `{{paylink.contact_admin}}` … the contact-admin button
 *   · `{{site_rules.*}}` ………… ADDED 31/08 on the owner's second pass: a menu card
 *     shows deposit/withdraw numbers, so the site's own values belong on it. The
 *     customer-variable set (`{{profile.*}}`) is still OUT — a menu is drawn once
 *     for everyone, and a per-person value on it would be a lie by design.
 * and NOT the customer-variable set. Until now `menu` was absent from
 * `FLEX_VAR_TYPES`, so the service coerced it to `'normal'` and handed a menu
 * card the entire profile/site-rules catalogue — variables that belong to a
 * different kind of card.
 *
 * 🔴 THE SECOND HALF OF THE RULE IS "DO NOT TOUCH NORMAL". Trimming a shared
 * table is exactly the kind of change that quietly narrows every other type, so
 * the normal/profile/custom sets are pinned here too. ห้ามยุ่ง normal.
 */
import { FlexMessagesService } from '@/modules/content/flex-messages.service';
import { mintPayLinks } from '@/modules/webhook/payment-reply/payment-action-mint';
import { CONTACT_ADMIN_MESSAGE } from '@/modules/payment';

const svc = () =>
  new FlexMessagesService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { translate: (_d: unknown, k: unknown) => String(k) } as never,
  );

const guide = (flexType: string): Record<string, unknown>[] =>
  (svc().getFlexVariableGuidelines({ flex_type: flexType }).data['rows'] as
    Record<string, unknown>[] | undefined) ?? [];

const tagsOf = (flexType: string): string[] =>
  guide(flexType).map((r) => String(r['tag']));

const CONTACT_ADMIN_TAG = '{{paylink.contact_admin}}';

describe('[MENUVARSET] a menu card gets three families and no more', () => {
  it('⭐⭐⭐ the contact-admin button tag is offered', () => {
    expect(tagsOf('menu')).toContain(CONTACT_ADMIN_TAG);
  });

  it('⭐⭐⭐ the customer-variable set is GONE — it never applied to a menu card', () => {
    /* `{{profile.*}}` is per-person; a menu card is drawn once for everyone. */
    expect(tagsOf('menu').some((t) => t.startsWith('{{profile.'))).toBe(false);
  });

  it('⭐⭐⭐ the SITE values are offered (owner, 31/08 — second pass)', () => {
    /* A menu shows the site's own numbers (min deposit, hours…), so these apply
       to it in a way a customer variable never did. */
    expect(tagsOf('menu').some((t) => t.startsWith('{{site_rules.'))).toBe(
      true,
    );
  });

  /* The owner calls this family "hook.xx" after the SOURCE column the table
     prints (`hook.domain_name`); the tag itself is spelled with an underscore
     (`{{hook_domain}}`). Asserted on the real spelling, not on the nickname. */
  it('⭐ the hook context values stay — they DO apply, and the owner kept them', () => {
    expect(tagsOf('menu')).toEqual(
      expect.arrayContaining([
        '{{hook_domain}}',
        '{{hook_name}}',
        '{{hook_detail}}',
      ]),
    );
  });

  it('⭐ the postback payloads stay', () => {
    expect(tagsOf('menu').some((t) => t.startsWith('menu:'))).toBe(true);
  });

  it('every row a menu card gets belongs to one of the three families', () => {
    const stray = tagsOf('menu').filter(
      (t) =>
        !t.startsWith('menu:') &&
        !/^\{\{hook_/.test(t) &&
        !t.startsWith('{{site_rules.') &&
        /* [FIX-20260831-PAYLINKONESOURCE] the paylink family, not one tag.
           It grew to two the day `contact_admin_via_withdraw` shipped, and a
           single-tag exclusion would have called the new one a stray. */
        !t.startsWith('{{paylink.') &&
        // the postback guide also ships two prose rows (the byte cap and the
        // "no postback at all" note) — they carry no payload to paste
        !t.startsWith('('),
    );
    expect(stray).toEqual([]);
  });

  it('the response no longer claims to be a normal card', () => {
    expect(
      svc().getFlexVariableGuidelines({ flex_type: 'menu' }).data['flex_type'],
    ).toBe('menu');
  });
});

describe('[MENUVARSET] 🔴 no other type moves', () => {
  it('⭐⭐⭐ normal keeps its customer variables', () => {
    const tags = tagsOf('normal');
    expect(tags.some((t) => t.startsWith('{{profile.'))).toBe(true);
  });

  /* ⚠️⚠️ CHANGED 31/08/2026 — [FIX-20260831-PAYLINKONESOURCE]. `slip` came OUT
     of this list, deliberately: the dashboard used to hard-code the slip card's
     paylink rows in `config/flexSlipGuidelines.ts`, that copy never learned
     about a tag added to the grammar, and the card was then REFUSED ON SAVE.
     The server owns the list now and must therefore serve it for `slip` as
     well. What the case still pins — that no OTHER type is offered one — is the
     part that was always the point. */
  it('⭐⭐ no type beyond menu and slip is offered a paylink tag', () => {
    for (const t of ['normal', 'profile', 'custom', 'customerhelper']) {
      expect(tagsOf(t).some((x) => x.startsWith('{{paylink.'))).toBe(false);
    }
    /* and the two that ARE offered them differ, because `retry` needs a payment
       run to resume and a menu card can never supply one */
    expect(tagsOf('slip')).toContain('{{paylink.retry}}');
    expect(tagsOf('menu')).not.toContain('{{paylink.retry}}');
    expect(tagsOf('menu')).toContain(CONTACT_ADMIN_TAG);
    expect(tagsOf('slip')).toContain(CONTACT_ADMIN_TAG);
  });

  it('no other type is offered the menu payloads', () => {
    for (const t of ['normal', 'profile', 'custom', 'customerhelper', 'slip']) {
      expect(tagsOf(t).some((x) => x.startsWith('menu:'))).toBe(false);
    }
  });

  it('customerhelper still gets its own tag', () => {
    expect(tagsOf('customerhelper')).toContain('{{cus_land_url}}');
  });
});

describe('[MENUVARSET] the tag it hands out is the one the minter accepts', () => {
  /* The guide would be worse than useless if it printed a tag the send path does
     not recognise: the card saves, and the customer reads `{{paylink.…}}`.
     So the string is not compared to a literal — it is fed to the REAL minter. */
  it('⭐⭐⭐ pasting the offered tag into a message button mints the real text', () => {
    const bare = CONTACT_ADMIN_TAG;
    const card = {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: { type: 'message', label: 'ติดต่อแอดมิน', text: bare },
          },
        ],
      },
    };
    const out = mintPayLinks(card, {});
    const rendered = JSON.stringify(out.contents);
    expect(out.minted).toContain('paylink.contact_admin');
    // the customer still reads the same sentence — it moved to `displayText`.
    expect(rendered).toContain(CONTACT_ADMIN_MESSAGE);
    /* [FEAT-20260902-ADMINPOSTBACK] this used to be `not.toContain('paylink')`,
       which was the right idea spelled too widely: the point is that no un-minted
       TAG survives, and the minted payload legitimately carries the namespace
       (`paylink:v1:contact_admin`). A press must be distinguishable from typing,
       and only a postback payload can carry that proof.
       ⇒ ห้ามเหลือ tag ดิบ · payload ที่มินต์แล้วมี namespace ได้ */
    expect(rendered).not.toContain('{{paylink');
    expect(rendered).toContain('"data":"paylink:v1:contact_admin"');
  });
});
