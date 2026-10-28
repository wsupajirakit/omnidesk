/**
 * [FIX-20260831-STOREDCARDVARS] a stored card's `{{...}}` are substituted —
 * and its button stops disappearing.
 * ===========================================================================
 * เจอจริง 31/08 บนเครื่องเจ้าของ: the card `sub-forget-password` arrived on a
 * phone with its green button missing. Nothing was logged and nothing refused —
 * the button was DROPPED inside `mintButtons`, and this is the chain:
 *
 *   1. a stored card's `content_json` never went through a variable pass. The
 *      engine resolves a definition's title/labels (`open`) and a code-defined
 *      result (`sendResult`), but a card opened by slug or by tag went straight
 *      to the renderer with its tags raw.
 *   2. the card's button read `uri: "{{hook_domain}}/dashboard"`.
 *   3. `mintButtons` repairs `uri` actions LINE would reject. `{{hook_domain}}…`
 *      is not http(s), and the slug/tag doors carry `items: []` so there was no
 *      item to bind it to ⇒ the button was removed to save the message.
 *
 * Every step was correct in isolation. The missing one was (1).
 *
 * 🔴 ORDER IS THE FIX, not an extra guard: substitute FIRST, mint SECOND. §3e
 * forbids a substitution pass from walking a minted `menu:v1:` payload, and this
 * order means none ever does. The repair rule keeps its teeth — it now judges
 * the FINAL uri, so a variable resolving to nothing is still dropped.
 *
 * ⚠️ The first case here FAILS on the code as it was: it is the bug, written
 *    down. อย่าลบ — มันคือหลักฐานว่าเคยพัง.
 */
import { StoredCardRenderer } from '@/modules/menu/renderers/stored-card.renderer';
import type { MenuDefinition } from '@/modules/menu/scenarios/scenario.types';

const bubbleWith = (uri: string) => ({
  type: 'bubble',
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [
      { type: 'text', text: 'เข้าเว็บที่ {{hook_domain}} ได้เลยค่ะ' },
      { type: 'button', action: { type: 'uri', label: 'ไปที่เว็บ', uri } },
    ],
  },
});

/** The slug/tag door's envelope: no items, so nothing is minted over. */
const DEFINITION: MenuDefinition = {
  key: 'slug-link',
  level: 'primary',
  variant: null,
  enabled: true,
  title: 'sub-forget-password',
  items: [],
  render: 'stored',
  card: { flexType: 'menu', slug: 'sub-forget-password' },
};

const CONTEXT = {
  hook: { _id: 'h1', group: 'g1', domain_name: 'https://demo.example' },
  lineUserId: 'U1',
  member: null,
  siteRules: null,
  silence: { silenced: false },
} as never;

function renderer(opts: { withVars: boolean; uri: string }) {
  const card = {
    flex_type: 'menu',
    name: 'sub forget password',
    group_ids: ['g1'],
    content_json: bubbleWith(opts.uri),
  };
  const seen: Record<string, unknown>[] = [];
  return {
    seen,
    r: new StoredCardRenderer({
      source: { find: () => Promise.resolve(card) },
      fallback: { render: () => ({ type: 'text', text: 'FALLBACK' }) },
      ...(opts.withVars
        ? {
            /* stands in for the seat: it is handed the ROW and answers with the
               drawn bubble, exactly like `renderFlexDoc(doc, vars, '', hook)`. */
            resolveCard: (row: { content_json?: unknown }) => {
              seen.push(row);
              return JSON.parse(
                JSON.stringify(row.content_json)
                  .split('{{hook_domain}}')
                  .join('https://demo.example'),
              ) as unknown;
            },
          }
        : {}),
    }),
  };
}

describe('[STOREDCARDVARS] the card the customer receives', () => {
  it('⭐⭐⭐ THE BUG: with no resolver the templated button is dropped', async () => {
    /* pinned deliberately — this is what shipped, and it is what a caller that
       wires no vars still gets. It is also why the fix is a WIRING change and
       not a change to the repair rule. */
    const { r } = renderer({
      withVars: false,
      uri: '{{hook_domain}}/dashboard',
    });
    const out = await r.render(DEFINITION, CONTEXT);
    expect(JSON.stringify(out)).not.toContain('button');
  });

  it('⭐⭐⭐ THE FIX: the variable resolves and the button survives', async () => {
    const { r } = renderer({
      withVars: true,
      uri: '{{hook_domain}}/dashboard',
    });
    const out = await r.render(DEFINITION, CONTEXT);
    const drawn = JSON.stringify(out);
    expect(drawn).toContain('"type":"button"');
    expect(drawn).toContain('https://demo.example/dashboard');
    expect(drawn).not.toContain('{{hook_domain}}');
  });

  it('⭐⭐⭐ the card TEXT stops leaking raw tags too', async () => {
    const { r } = renderer({ withVars: true, uri: 'https://ok.example' });
    const drawn = JSON.stringify(await r.render(DEFINITION, CONTEXT));
    expect(drawn).toContain('เข้าเว็บที่ https://demo.example ได้เลยค่ะ');
    expect(drawn).not.toContain('{{');
  });

  it('⭐⭐⭐ substitution runs BEFORE minting — no pass ever walks a payload', async () => {
    const { r, seen } = renderer({ withVars: true, uri: 'https://ok.example' });
    /* a real SCENARIO key here, not the slug-link envelope: minting only happens
       when there are items to bind, and `buildMenuPostback` rightly refuses
       `slug-link` as a scenario key. This is the shape that mints. */
    await r.render(
      {
        ...DEFINITION,
        key: 'second',
        items: [
          { id: 'a', label: 'A', action: { type: 'open', target: 'second' } },
        ],
      } as never,
      CONTEXT,
    );
    /* what the resolver was handed must be the STORED ROW, with no `menu:v1:`
       payload in it — if minting ran first this would carry one */
    expect(JSON.stringify(seen[0])).not.toContain('menu:v1:');
    /* and it must be the ROW, not the bubble: the central builder reads
       `source_roles` off the doc to decide which variable sources to build.
       Handed only `content_json`, `{{site_rules.*}}` reach the customer raw. */
    expect(seen[0]).toHaveProperty('content_json');
  });

  it('⭐⭐ a uri that resolves to nothing usable is STILL dropped', async () => {
    /* the repair rule keeps its teeth: it now judges the final string. LINE
       rejects the whole message over one bad uri, so this must not soften. */
    const { r } = renderer({ withVars: true, uri: '{{unknown_tag}}/x' });
    const out = await r.render(DEFINITION, CONTEXT);
    expect(JSON.stringify(out)).not.toContain('button');
  });

  it('⭐⭐ a resolver that throws costs nothing — the stored card is drawn', async () => {
    const card = {
      flex_type: 'menu',
      name: 'c',
      group_ids: ['g1'],
      content_json: bubbleWith('https://ok.example'),
    };
    const r = new StoredCardRenderer({
      source: { find: () => Promise.resolve(card) },
      fallback: { render: () => ({ type: 'text', text: 'FALLBACK' }) },
      resolveCard: () => {
        throw new Error('boom');
      },
    });
    const drawn = JSON.stringify(await r.render(DEFINITION, CONTEXT));
    expect(drawn).toContain('https://ok.example');
    expect(drawn).not.toContain('FALLBACK');
  });
});
