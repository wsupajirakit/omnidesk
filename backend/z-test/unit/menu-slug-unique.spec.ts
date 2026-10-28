/**
 * [FIX-20260831-MENUSLUGDUP] A menu slug must be unique — including against
 * cards that were DELETED.
 * ===========================================================================
 * เจอจริง 31/08 บนเครื่องเจ้าของ: two cards carried `flex_slug: "sub-register"`,
 * one of them soft-deleted an hour earlier. A button pointing at that slug opened
 * nothing at all, and nothing said why — the lookup answered with whichever row
 * the collection returned first, the renderer refused it because `deleted_at` was
 * set, and the LIVE card was never reached.
 *
 * Two separate defects, and both are fixed:
 *   1. the lookup must not return a deleted card at all (the seat's query)
 *   2. an operator must not be able to create the collision in the first place —
 *      and the check has to include deleted rows, because a deleted card is
 *      exactly what a slug can silently collide with. Owner: *"validate ตอนสร้าง
 *      การ์ดห้ามตั้งชื่อ slug ซ้ำกับตัวที่ถูกลบด้วย"*.
 *
 * ⚠️ NOT group-scoped, unlike the NAME check. A name is an operator-facing label
 * and a clash inside someone else's group would be unexplainable; a SLUG is
 * resolved by the menu engine BEFORE the group check runs, so two cards sharing
 * one anywhere in the collection is a real ambiguity.
 * ⚠️ Menu cards only. Every other type stores `flex_slug: null`, and a rule that
 * fired on null would refuse every second card of every other kind.
 */
import { FlexMessagesService } from '@/modules/content/flex-messages.service';

/** Records the queries it is asked, answers with whatever rows are staged. */
function flexModelFake(rows: Record<string, unknown>[]) {
  const queries: Record<string, unknown>[] = [];
  return {
    queries,
    findOne: (q: Record<string, unknown>) => {
      queries.push(q);
      const slug = q['flex_slug'];
      const hit = rows.find((r) => r['flex_slug'] === slug) ?? null;
      return { lean: () => ({ exec: () => Promise.resolve(hit) }) };
    },
  };
}

const svc = (flexModel: unknown): FlexMessagesService =>
  new FlexMessagesService(
    flexModel as never,
    {} as never,
    {} as never,
    {} as never,
    { translate: (_d: unknown, k: unknown) => String(k) } as never,
  );

/** `isMenuSlugTaken` is private — reached the way the create path reaches it. */
const taken = async (
  service: FlexMessagesService,
  slug: string,
  flexType = 'menu',
  excludeId?: unknown,
): Promise<boolean> =>
  (
    service as unknown as {
      isMenuSlugTaken: (s: unknown, t: string, e?: unknown) => Promise<boolean>;
    }
  ).isMenuSlugTaken(slug, flexType, excludeId);

describe('[MENUSLUGDUP] the slug check', () => {
  it('⭐⭐⭐ a slug already used by a LIVE card is taken', async () => {
    const m = flexModelFake([{ flex_slug: 'sub-register' }]);
    await expect(taken(svc(m), 'sub-register')).resolves.toBe(true);
  });

  it('⭐⭐⭐ a slug used by a DELETED card is ALSO taken — that is the whole point', async () => {
    const m = flexModelFake([
      { flex_slug: 'sub-register', deleted_at: new Date() },
    ]);
    await expect(taken(svc(m), 'sub-register')).resolves.toBe(true);
    /* the query must NOT exclude deleted rows, or the collision it exists to
       stop is exactly the one it lets through */
    expect(JSON.stringify(m.queries[0])).not.toContain('deleted_at');
  });

  it('⭐⭐ a free slug is not taken', async () => {
    const m = flexModelFake([{ flex_slug: 'something-else' }]);
    await expect(taken(svc(m), 'sub-register')).resolves.toBe(false);
  });

  it('⭐⭐ the card being edited does not collide with itself', async () => {
    const m = flexModelFake([{ flex_slug: 'sub-register' }]);
    await taken(svc(m), 'sub-register', 'menu', 'a0d00000000000000000006c');
    expect(JSON.stringify(m.queries[0])).toContain('_id');
  });

  it('⭐⭐⭐ a non-menu type is never checked — it stores no slug', async () => {
    for (const t of ['normal', 'custom', 'slip', 'profile']) {
      const m = flexModelFake([{ flex_slug: 'sub-register' }]);
      await expect(taken(svc(m), 'sub-register', t)).resolves.toBe(false);
      expect(m.queries).toEqual([]);
    }
  });

  it('⭐ an empty slug is not a collision — a menu card may have none', async () => {
    const m = flexModelFake([{ flex_slug: 'sub-register' }]);
    await expect(taken(svc(m), '   ')).resolves.toBe(false);
    expect(m.queries).toEqual([]);
  });
});
