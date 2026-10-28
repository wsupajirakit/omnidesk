/**
 * [FIX-20260831-MENUROLESAVE] a menu card STORES the sources its guide offers.
 * ===========================================================================
 * เจอจริง 31/08: `sub-register` printed `{{site_rules.dep_min}}` at a customer,
 * raw. The variable guide offers `{{site_rules.*}}` for a menu card — that rule
 * lives in `MENU_SOURCE_ROLES` — but the SAVE path wrote whatever the form sent,
 * and the form sent `[]`. The row therefore declared no sources, and the central
 * builder (`buildFlexVarMaps`) reads exactly that field to decide what to build.
 * Guide says yes, row says no, customer reads `{{...}}`.
 *
 * 🔴 ONE RULE, ONE CONSTANT, BOTH ENDS. The fix is not a special case in the
 * renderer — it is making the row agree with the rule the guide already states.
 * Widening the builder for menu cards instead would put a second spelling of
 * "what a menu may use" in a second module.
 *
 * ⚠️ Only `menu`. Every other type still stores exactly the roles it requested —
 *    a rule that leaked into `custom` would silently rewrite operator choices.
 * ⚠️ Editing is also the REPAIR path: an older menu card saved with `[]` gets
 *    the right set simply by being saved again, which is why no backfill code
 *    exists (owner: ไม่ต้องมี code backfill).
 *
 * These cases drive the REAL `createFlexMessage` / `updateFlexMessage` and read
 * what was handed to the model — the rule is never restated here.
 */
import { FlexMessagesService } from '@/modules/content/flex-messages.service';

const USER = { role: 'admin', group_ids: ['g1'], userId: 'u1' };
/** A real 24-hex id — `updateFlexMessage` rejects anything else outright. */
const ID = 'a0d00000000000000000006b';
const META = { ip: '127.0.0.1', userAgent: 'spec' };

/** Records the document a save would write. */
function harness(existing: Record<string, unknown> | null = null) {
  const written: Record<string, unknown>[] = [];
  const model = {
    create: (doc: Record<string, unknown>) => {
      written.push(doc);
      return Promise.resolve({ ...doc, _id: 'new-id' });
    },
    /* three call shapes, all real and all different — copied from the code, not
       guessed: the name check narrows with `.select('_id').lean()`, the slug
       check ends in `.lean().exec()`, and the row load awaits `.lean()`. A fake
       that answers only one of them silently returns the wrong thing. */
    findOne: () => {
      const lean = (): Promise<unknown> & { exec: () => Promise<unknown> } => {
        const p = Promise.resolve(existing) as Promise<unknown> & {
          exec: () => Promise<unknown>;
        };
        p.exec = () => Promise.resolve(null); // the slug check: never taken
        return p;
      };
      return {
        select: () => ({ lean: () => Promise.resolve(null) }),
        lean,
      };
    },
    /* the update path awaits `.lean()` directly — no `.exec()` */
    findOneAndUpdate: (_f: unknown, update: Record<string, unknown>) => ({
      lean: () => {
        written.push((update['$set'] ?? update) as Record<string, unknown>);
        return Promise.resolve({ _id: ID, ...update });
      },
    }),
  };
  const counter = {
    findOneAndUpdate: () => ({
      lean: () => ({ exec: () => Promise.resolve({ seq: 1 }) }),
    }),
  };
  /* constructor order: flexModel, hookModel, counterModel, auditLog, dictCache */
  const svc = new FlexMessagesService(
    model as never,
    {} as never,
    counter as never,
    { createAuditLog: () => Promise.resolve(null) } as never,
    { translate: (_d: unknown, k: unknown) => String(k) } as never,
  );
  return { svc, written };
}

const baseDto = (over: Record<string, unknown>) => ({
  name: 'card',
  flex_type: 'custom',
  content_json: { type: 'bubble' },
  source_roles: [],
  group_ids: ['g1'],
  ...over,
});

describe('[MENUROLESAVE] creating a card', () => {
  it('⭐⭐⭐ a MENU card is stored declaring site_rules, whatever the form sent', async () => {
    for (const sent of [[], ['profile'], undefined]) {
      const { svc, written } = harness();
      await svc.createFlexMessage(
        baseDto({
          flex_type: 'menu',
          flex_sub_type: 'sub',
          flex_slug: 'sub-register',
          source_roles: sent,
        }),
        USER as never,
        META,
      );
      expect(written[0]?.['source_roles']).toEqual(['site_rules']);
    }
  });

  it('⭐⭐⭐ every other type keeps exactly what it asked for', async () => {
    for (const [type, sent] of [
      ['custom', ['site_rules']],
      ['custom', []],
      ['profile', []],
    ] as const) {
      const { svc, written } = harness();
      await svc.createFlexMessage(
        baseDto({ flex_type: type, source_roles: [...sent] }),
        USER as never,
        META,
      );
      expect(written[0]?.['source_roles']).toEqual(sent);
    }
  });
});

describe('[MENUROLESAVE] editing a card', () => {
  it('⭐⭐⭐ re-saving an old menu card REPAIRS it — that is the backfill', async () => {
    /* the row as it exists on the owner's database today */
    const { svc, written } = harness({
      _id: ID,
      flex_type: 'menu',
      flex_sub_type: 'sub',
      flex_slug: 'sub-register',
      source_roles: [],
      group_ids: ['g1'],
    });
    await svc.updateFlexMessage(ID, { source_roles: [] }, USER as never, META);
    expect(written[0]?.['source_roles']).toEqual(['site_rules']);
  });

  it('⭐⭐ editing a non-menu card does not rewrite its sources', async () => {
    const { svc, written } = harness({
      _id: ID,
      flex_type: 'custom',
      source_roles: ['site_rules'],
      group_ids: ['g1'],
    });
    await svc.updateFlexMessage(
      ID,
      { source_roles: ['profile'] },
      USER as never,
      META,
    );
    expect(written[0]?.['source_roles']).toEqual(['profile']);
  });
});
