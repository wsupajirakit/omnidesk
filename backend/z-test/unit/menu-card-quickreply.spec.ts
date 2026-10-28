/**
 * [FEAT-20260831-MENUSLIPQR] the slip-request card ships the image picker.
 * ===========================================================================
 * เจอจริง 31/08 และ **LINE เป็นคนตอบเอง** ไม่ใช่การเดา — the card carried a
 * `cameraRoll` button, and `POST /v2/bot/message/validate/push` answered:
 *
 *     400  {"details":[{"message":"{0} action is not available for flex message"}]}
 *
 * `cameraRoll` is a QUICK-REPLY action. Inside a flex button LINE refuses the
 * whole message, so that card could never be delivered — the dashboard showed it
 * and the phone never did. The owner removed the button; the picker comes back
 * where LINE actually accepts it: as the message's `quickReply`.
 *
 * 🔴 IT REUSES `SLIP_QUICK_REPLY`, THE ONE THAT ALREADY EXISTS. That constant is
 * the slip flow's own picker (`slip-flex.handler.ts`, with a note recording the
 * LINE docs it was checked against). A second copy here would drift the day the
 * owner changes the button again. ของเดิมมีอยู่แล้ว ใช้ตัวเดิม ห้ามสร้างใหม่.
 *
 * ⚠️ THE RULE LIVES AT THE SEAT, NOT IN THE MENU MODULE. Which card gets a
 *    picker is slip knowledge, and `src/modules/menu` is forbidden from importing
 *    webhook code (contract DO-NOT #1). The module only offers the seam.
 * ⚠️ ONE card. Every other stored card renders exactly as before — asserted
 *    below, because "it only affects the one I meant" is the claim that is
 *    always worth testing.
 */
import { StoredCardRenderer } from '@/modules/menu/renderers/stored-card.renderer';
import type { MenuDefinition } from '@/modules/menu/scenarios/scenario.types';

const CONTEXT = {
  hook: { _id: 'h1', group: 'g1' },
  lineUserId: 'U1',
  member: null,
  siteRules: null,
  silence: { silenced: false },
} as never;

const DEFINITION = (slug: string): MenuDefinition => ({
  key: 'slug-link',
  level: 'primary',
  variant: null,
  enabled: true,
  title: slug,
  items: [],
  render: 'stored',
  card: { flexType: 'menu', slug },
});

const PICKER = {
  items: [
    { type: 'action', action: { type: 'cameraRoll', label: 'เลือกรูปภาพ' } },
  ],
};

function renderer(slug: string, withDep = true) {
  const card = {
    flex_type: 'menu',
    flex_slug: slug,
    name: `card ${slug}`,
    group_ids: ['g1'],
    content_json: { type: 'bubble' },
  };
  const asked: unknown[] = [];
  return {
    asked,
    r: new StoredCardRenderer({
      source: { find: () => Promise.resolve(card) },
      fallback: { render: () => ({ type: 'text', text: 'FALLBACK' }) },
      ...(withDep
        ? {
            /* stands in for the seat: slip knowledge, not menu knowledge */
            quickReplyFor: (c: { flex_slug?: string | null }) => {
              asked.push(c.flex_slug);
              return c.flex_slug === 'sub-slip-request' ? PICKER : undefined;
            },
          }
        : {}),
    }),
  };
}

describe('[MENUSLIPQR] the picker rides on the message, not in the card', () => {
  it('⭐⭐⭐ the slip-request card ships the quick reply', async () => {
    const { r } = renderer('sub-slip-request');
    const out = (await r.render(
      DEFINITION('sub-slip-request'),
      CONTEXT,
    )) as Record<string, unknown>;
    expect(out['quickReply']).toEqual(PICKER);
    /* and the picker is where LINE accepts it — on the MESSAGE, never inside
       `contents`, which is the mistake that produced the 400 */
    expect(JSON.stringify(out['contents'])).not.toContain('cameraRoll');
  });

  it('⭐⭐⭐ every other card is untouched — no quickReply key at all', async () => {
    for (const slug of ['sub-register', 'main-menu', 'sub-web-url']) {
      const { r } = renderer(slug);
      const out = (await r.render(DEFINITION(slug), CONTEXT)) as Record<
        string,
        unknown
      >;
      expect(out).not.toHaveProperty('quickReply');
    }
  });

  it('⭐⭐⭐ no dep wired ⇒ nothing changes for anyone', async () => {
    const { r } = renderer('sub-slip-request', false);
    const out = (await r.render(
      DEFINITION('sub-slip-request'),
      CONTEXT,
    )) as Record<string, unknown>;
    expect(out).not.toHaveProperty('quickReply');
    expect(out['type']).toBe('flex');
  });

  it('⭐⭐ the decision is made on the CARD, not on the definition title', async () => {
    /* the seat is asked with the row, so a renamed scenario cannot change it */
    const { r, asked } = renderer('sub-slip-request');
    await r.render(DEFINITION('something-else-entirely'), CONTEXT);
    expect(asked).toEqual(['sub-slip-request']);
  });

  it('⭐⭐ a dep that throws costs the picker, never the card', async () => {
    const card = {
      flex_type: 'menu',
      flex_slug: 'sub-slip-request',
      name: 'c',
      group_ids: ['g1'],
      content_json: { type: 'bubble' },
    };
    const r = new StoredCardRenderer({
      source: { find: () => Promise.resolve(card) },
      fallback: { render: () => ({ type: 'text', text: 'FALLBACK' }) },
      quickReplyFor: () => {
        throw new Error('boom');
      },
    });
    const out = (await r.render(
      DEFINITION('sub-slip-request'),
      CONTEXT,
    )) as Record<string, unknown>;
    expect(out['type']).toBe('flex');
    expect(out).not.toHaveProperty('quickReply');
  });
});
