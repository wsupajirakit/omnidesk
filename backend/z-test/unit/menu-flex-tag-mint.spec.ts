/**
 * [FEAT-20260831-MENUMAINTAG] A menu card gets its own reference tag.
 * ===========================================================================
 * A main menu card had no way to be named: `FLEX_TAG_CONFIG` covered `custom`
 * and `profile-semi-custom` only, so all 19 menu cards in the live collection
 * carried no `flex_tag` at all. Without one an operator cannot paste anything
 * into a prompt that means "this card" — the list even offers a Copy button,
 * which was handing out the operator-typed slug wrapped in `[[[ ]]]`, a shape
 * no grammar in the repo resolves.
 *
 * Owner's decisions, 31/08:
 *   1. the number is padded like its siblings — `menu_main_00001`, not `_1`
 *   2. existing rows are filled by hand on the local database; NO backfill ships
 *   3. sub cards get one too (`menu_sub_00001`), minted in advance even though
 *      nothing reads it yet — and it must change nothing that exists today
 *
 * 🔴 THE COUNTERS MUST STAY SEPARATE. `flex_m`, `flex_pc`, `menu_main_` and
 * `menu_sub_` are four independent series; sharing a counter would interleave
 * two numbering schemes and the file that declares them says so in its own
 * words. This spec asserts the counter id each type reaches for, not just the
 * string it returns. คนละชุดต้องคนละตัวนับ.
 */
import { FlexMessagesService } from '@/modules/content/flex-messages.service';

/** Records every counter it is asked for, and answers with a fixed sequence. */
function counterFake(seq = 1) {
  const asked: string[] = [];
  return {
    asked,
    model: {
      findOneAndUpdate: (
        filter: Record<string, unknown>,
        _update: unknown,
        _opts: unknown,
      ) => {
        asked.push(String(filter['_id']));
        return Promise.resolve({ seq });
      },
    },
  };
}

/** The service with only the collaborators tag minting touches. */
const svcWith = (counter: unknown): FlexMessagesService =>
  new FlexMessagesService(
    {} as never,
    {} as never,
    counter as never,
    {} as never,
    { translate: (_d: unknown, k: unknown) => String(k) } as never,
  );

/** `generateFlexTag` is private — reached the way the create path reaches it. */
const mint = async (
  svc: FlexMessagesService,
  flexType: string,
  subType?: string,
): Promise<string | null> =>
  (
    svc as unknown as {
      generateFlexTag: (t: string, s?: string) => Promise<string | null>;
    }
  ).generateFlexTag(flexType, subType);

describe('[MENUMAINTAG] a menu card is given a reference tag', () => {
  it('⭐⭐⭐ a MAIN card mints menu_main_00001 — five digits, like its siblings', async () => {
    const c = counterFake(1);
    await expect(mint(svcWith(c.model), 'menu', 'main')).resolves.toBe(
      'menu_main_00001',
    );
  });

  it('⭐⭐ a SUB card mints its own series (decision 3 — minted in advance)', async () => {
    const c = counterFake(1);
    await expect(mint(svcWith(c.model), 'menu', 'sub')).resolves.toBe(
      'menu_sub_00001',
    );
  });

  it('⭐⭐⭐ main and sub read DIFFERENT counters — the series never interleave', async () => {
    const main = counterFake();
    await mint(svcWith(main.model), 'menu', 'main');
    const sub = counterFake();
    await mint(svcWith(sub.model), 'menu', 'sub');

    expect(main.asked).toEqual(['menu_main_tag']);
    expect(sub.asked).toEqual(['menu_sub_tag']);
  });

  it('⭐⭐⭐ neither touches the counters the other card types own', async () => {
    for (const sub of ['main', 'sub']) {
      const c = counterFake();
      await mint(svcWith(c.model), 'menu', sub);
      expect(c.asked).not.toContain('flex_message_tag');
      expect(c.asked).not.toContain('flex_profile_custom_tag');
      expect(c.asked).not.toContain('dynamic_tag_ins');
    }
  });

  it('the number is whatever the counter says, padded to five', async () => {
    const c = counterFake(42);
    await expect(mint(svcWith(c.model), 'menu', 'main')).resolves.toBe(
      'menu_main_00042',
    );
  });
});

describe('[MENUMAINTAG] 🔴 nothing else moves', () => {
  it('⭐⭐⭐ custom still mints flex_m from its own counter', async () => {
    const c = counterFake(7);
    await expect(mint(svcWith(c.model), 'custom')).resolves.toBe('flex_m00007');
    expect(c.asked).toEqual(['flex_message_tag']);
  });

  it('⭐⭐ profile-semi-custom still mints flex_pc from its own counter', async () => {
    const c = counterFake(3);
    await expect(mint(svcWith(c.model), 'profile-semi-custom')).resolves.toBe(
      'flex_pc00003',
    );
    expect(c.asked).toEqual(['flex_profile_custom_tag']);
  });

  it('⭐⭐ the types that never had a tag still get none, and ask no counter', async () => {
    for (const t of ['normal', 'profile', 'slip', 'customerhelper']) {
      const c = counterFake();
      await expect(mint(svcWith(c.model), t)).resolves.toBeNull();
      expect(c.asked).toEqual([]);
    }
  });

  it('⭐ a menu card with an unknown sub-type mints nothing rather than guessing', async () => {
    const c = counterFake();
    await expect(
      mint(svcWith(c.model), 'menu', 'sideways'),
    ).resolves.toBeNull();
    expect(c.asked).toEqual([]);
  });
});
