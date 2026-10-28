/**
 * [FIX-20260831-MENUSLUGDUP] the card lookup must never return a DELETED card.
 * ===========================================================================
 * เจอจริง 31/08 บนเครื่องเจ้าของ: a button pointing at `sub-register` opened
 * nothing. Two rows held that slug — one soft-deleted an hour earlier — the seat
 * had no `deleted_at` clause, so `findOne` was free to answer with the deleted
 * one, and `stored-card.renderer.ts` then refused it (`if (card.deleted_at)`).
 * The LIVE card was never reached and the customer got silence.
 *
 * 🔴 THE RENDERER'S REFUSAL IS NOT A FIX. It is the last line of defence and it
 * is correct — a deleted card must not be sent. But refusing at the END means
 * the lookup has already spent its one chance. The filter has to be in the QUERY
 * so the live sibling is the row that comes back. Both stay: the renderer keeps
 * guarding against a stale card handed in by some other future caller.
 *
 * ⚠️ `deleted_at: { $exists: false }` — verified against the real collection
 * 31/08: 80 rows, 2 with the key present, 78 without it (live rows carry NO
 * `deleted_at` key at all, not `null`). Same shape the update path already uses
 * at flex-messages.service.ts. ดูแถวจริงแล้ว ไม่ได้เดา.
 *
 * The provider is read out of Nest's own metadata rather than re-declared here,
 * so this test breaks if the seat is moved or rewritten — which is the point.
 */
import { MENU_CARD_SOURCE } from '@/modules/menu';
import { WebhookModule } from '@/modules/webhook/webhook.module';

type Provider = {
  provide?: unknown;
  useFactory?: (...args: unknown[]) => {
    find: (q: unknown) => Promise<unknown>;
  };
};

/** The seat exactly as Nest holds it — not a copy of it. */
function menuCardSource(): { find: (q: unknown) => Promise<unknown> } {
  const providers = (Reflect.getMetadata('providers', WebhookModule) ??
    []) as Provider[];
  const seat = providers.find((p) => p && p.provide === MENU_CARD_SOURCE);
  if (!seat?.useFactory) throw new Error('MENU_CARD_SOURCE seat not found');

  const model = {
    findOne: (q: Record<string, unknown>) => {
      queries.push(q);
      return { lean: () => ({ exec: () => Promise.resolve(null) }) };
    },
  };
  return seat.useFactory(model);
}

let queries: Record<string, unknown>[] = [];
beforeEach(() => {
  queries = [];
});

describe('[MENUSLUGDUP] the stored-card seat', () => {
  it('⭐⭐⭐ a lookup by SLUG never considers a deleted card', async () => {
    await menuCardSource().find({ flexType: 'menu', slug: 'sub-register' });
    expect(queries[0]).toMatchObject({
      flex_type: 'menu',
      flex_slug: 'sub-register',
      deleted_at: { $exists: false },
    });
  });

  it('⭐⭐⭐ a lookup by TAG excludes them too — same trap, same clause', async () => {
    await menuCardSource().find({ flexType: 'menu', tag: 'menu_main_00010' });
    expect(queries[0]).toMatchObject({
      flex_tag: 'menu_main_00010',
      deleted_at: { $exists: false },
    });
  });

  it('⭐⭐ the exclusion is unconditional — it is not one of the optional clauses', async () => {
    await menuCardSource().find({ flexType: 'menu' });
    expect(queries[0]).toHaveProperty('deleted_at');
    /* and it never narrows anything else away: an absent key stays absent */
    expect(queries[0]).not.toHaveProperty('flex_slug');
    expect(queries[0]).not.toHaveProperty('flex_tag');
    expect(queries[0]).not.toHaveProperty('flex_sub_type');
  });

  it('⭐ the optional clauses still all apply together', async () => {
    await menuCardSource().find({
      flexType: 'menu',
      subType: 'sub',
      slug: 'sub-register',
      tag: 'menu_sub_00011',
    });
    expect(queries[0]).toEqual({
      flex_type: 'menu',
      flex_sub_type: 'sub',
      flex_slug: 'sub-register',
      flex_tag: 'menu_sub_00011',
      deleted_at: { $exists: false },
    });
  });
});
