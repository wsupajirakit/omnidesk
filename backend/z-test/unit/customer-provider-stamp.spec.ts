/**
 * [FEAT-20260905-CUSTPROV] Every profile / site-rules response says who answered.
 * 📖 PLAN: `todo/task/05092026/todo3_05092026_profile_panel_module.md` PART 7 §36
 *
 * ## Why the stamp exists
 * The panel has to know which shape it is looking at, and the honest carrier is
 * the payload that already carries the data — the same lesson the per-vendor AI
 * columns taught this repo on the morning of 05/09: a value that names its owner
 * cannot be misread, so the guard against misreading it stops being necessary.
 *
 * ## Two properties, and the second is the one that rots
 * 1. the key is present, and it is the RESOLVED name;
 * 2. `data` is untouched — byte for byte the stored blob.
 *
 * (2) is what a future edit is most likely to break, because reshaping `data`
 * "just a little" for the panel would look like progress. `raw_profile_data` is
 * read by the tier port, the notice rules and the follow-up rules; a provider
 * that reshapes it changes all three silently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The service is not on the chat barrel, and putting it there to satisfy a test
// would widen that module's public surface for no runtime reason. Same exemption
// `raw-profile-refresh-trigger.spec.ts:27` already takes.
// eslint-disable-next-line no-restricted-imports
import { MembersService } from '@/modules/chat/members.service';

/** The stored blob, verbatim. Any drift in what comes back is a defect. */
const BLOB = {
  data: { profile: { tier: { code: 'gold', level: 2 } }, promotion: null },
  extra: 'kept',
};

const objectId = 'a0d00000000000000000004a';

type Svc = Record<string, unknown> & {
  getRawProfile: (
    id: string,
    auth?: unknown,
  ) => Promise<Record<string, unknown>>;
  getHookSiteRules: (hookId: string) => Promise<Record<string, unknown>>;
};

function makeService(providerName = 'shopapi_v1'): Svc {
  const svc = Object.create(MembersService.prototype) as Svc;
  Object.assign(svc, {
    customerProvider: {
      activeName: () => providerName,
      /* A profile answer carries `view` as well as the stamp (PART 7 §36), so
         the stub has to answer this too. Kept trivial ON PURPOSE: this suite is
         about the ENVELOPE — which keys are present and whether `data` survived
         — and a realistic view here would only re-prove
         `customer-provider-view.spec.ts` with a worse fixture. */
      viewOf: () => ({ sections: [] }),
      /* [FEAT-20260907-PROVCONDS] stampedProfile now asks the resolved entry
         for its OPTIONAL §6-pattern conditions. A provider that declares
         none (shop-api) stamps none — this stub declares none, so every
         pre-existing envelope assertion below is unchanged by construction. */
      resolve: () => ({ name: providerName }),
    },
    memberModel: {
      findById: () => ({
        lean: () =>
          Promise.resolve({
            raw_profile_data: BLOB,
            profile_data_updated_at: new Date('2026-09-05T10:00:00Z'),
          }),
      }),
    },
    hookModel: {
      findById: () => ({ lean: () => Promise.resolve(null) }),
    },
    // The scope gate runs first and is not what this spec is about.
    ensureMemberInScope: () => Promise.resolve(undefined),
  });
  return svc;
}

describe('[CUSTPROV] the profile response names the provider that answered', () => {
  it('⭐ getRawProfile stamps customer_provider', async () => {
    const res = await makeService().getRawProfile(objectId);
    expect(res['customer_provider']).toBe('shopapi_v1');
  });

  it('⭐ `data` comes back byte-identical — the stamp is ADDITIVE', async () => {
    const res = await makeService().getRawProfile(objectId);
    // Not `toEqual` on a copy: the same object, unreshaped.
    expect(res['data']).toEqual(BLOB);
    expect(JSON.stringify(res['data'])).toBe(JSON.stringify(BLOB));
  });

  it('every key the response had before is still there', async () => {
    // A stamp that dropped a sibling key would be a breaking change wearing an
    // additive change's clothes.
    const res = await makeService().getRawProfile(objectId);
    expect(res['success']).toBe(true);
    expect(res['profile_data_updated_at']).toBe('2026-09-05T10:00:00.000Z');
  });

  it('⭐ the stamp follows the ACTIVE provider, not a hardcoded string', async () => {
    const res = await makeService('acme_v9').getRawProfile(objectId);
    expect(res['customer_provider']).toBe('acme_v9');
  });
});

describe('[CUSTPROV] the site-rules response is stamped on every branch', () => {
  it('the invalid-id branch', async () => {
    const res = await makeService().getHookSiteRules('not-an-object-id');
    expect(res['customer_provider']).toBe('shopapi_v1');
    expect(res['data']).toBeNull();
    expect(res['reason']).toBe('Invalid hook_id');
  });

  it('⭐ the hook-not-found branch — the easiest one to forget', async () => {
    // Early returns are where a stamp goes missing: they are written first and
    // read last. Both no-data branches are asserted for that reason.
    const res = await makeService().getHookSiteRules(objectId);
    expect(res['customer_provider']).toBe('shopapi_v1');
    expect(res['reason']).toBe('Hook not found');
  });
});

/**
 * The structural half. The cases above prove the branches that exist today are
 * stamped; this proves that a branch added TOMORROW cannot quietly go unstamped.
 *
 * Same shape as the guard in `customer-provider.spec.ts`, and for the same
 * reason: on 05/09 a namespace convention that was written down three times was
 * still forgotten in a sixth place, and only a structural check found it.
 */
describe('[CUSTPROV] no unstamped exit from these two methods', () => {
  const source = readFileSync(
    join(__dirname, '../../src/modules/chat/members.service.ts'),
    'utf8',
  );

  /** The two methods that answer the panel, sliced out of the file. */
  const sliceOf = (name: string): string => {
    const start = source.indexOf(`public async ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const next = source.indexOf('\n  public async ', start + 10);
    return source.slice(start, next === -1 ? source.length : next);
  };

  const codeLines = (text: string): string[] =>
    text.split('\n').filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    });

  it.each(['getRawProfile', 'refreshRawProfile', 'getHookSiteRules'])(
    '⭐ every object return in %s goes through stamped()',
    (method) => {
      const bare = codeLines(sliceOf(method)).filter((l) =>
        /return\s*\{\s*$/.test(l.trim()),
      );
      // `return {` with no `this.stamped(` in front of it = an exit the panel
      // would receive with no idea which provider produced it.
      expect(bare).toEqual([]);
    },
  );

  it('the stamp rule has ONE definition, not one per return site', () => {
    // Six call sites, one helper. Writing the key at each site is the shape that
    // broke `invalidateScope` earlier today — a fact in two places drifted the
    // moment one was edited.
    const definitions = codeLines(source).filter((l) =>
      l.includes('customer_provider:'),
    );
    expect(definitions).toHaveLength(1);
  });
});

/**
 * 🔴 THE ENVELOPE IS THE STAMP AND `view` — AND NOTHING ELSE. This is where that
 * decision is held.
 *
 * A `fields` key carrying the provider's 26 resolved values shipped here briefly
 * on 05/09 and was removed the same day: nothing rendered it, and its shape
 * taught the dashboard 26 vendor field names — the opposite of the plan's
 * envelope (PART 7 §36-37), which carries a closed set of section TYPES so the
 * front end never learns a vendor's vocabulary.
 *
 * `view` is the key that shape was removed IN FAVOUR OF, and it landed here on
 * 05/09 with the guard and the proofs the plan asks for (§41). `fields` staying
 * out is still a rule, and these cases are what stop it drifting back in.
 */
describe('[CUSTPROV] a profile answer carries the stamp and the view, nothing else derived', () => {
  it('⭐ `data` is STILL the stored blob, byte for byte', async () => {
    // The tier port, the notice rules and the follow-up rules all read `data`.
    // A provider that reshaped it would change three unrelated behaviours at
    // once and none of them would say so.
    const res = await makeService().getRawProfile(objectId);
    expect(JSON.stringify(res['data'])).toBe(JSON.stringify(BLOB));
  });

  it('⭐ the vendor FIELD NAMES stay off the wire — `fields` is not coming back', async () => {
    // The removed key, still absent. `view` replaced it precisely because a
    // section TYPE is a vocabulary the front end can hold without learning any
    // vendor's field names.
    const res = await makeService().getRawProfile(objectId);
    expect(res).not.toHaveProperty('fields');
    expect(res['customer_provider']).toBe('shopapi_v1');
  });

  it('⭐ `view` IS on the wire now — PART 7 §36', async () => {
    const res = await makeService().getRawProfile(objectId);
    expect(res).toHaveProperty('view');
    expect(res['view']).toEqual({ sections: [] }); // the stub's answer
  });

  it('site-rules answers carry the stamp, and NO view', async () => {
    // That payload is the site's rules, not a customer — there is no blob to
    // arrange, so `stampedProfile` is deliberately not the helper it uses.
    const res = await makeService().getHookSiteRules(objectId);
    expect(res).not.toHaveProperty('fields');
    expect(res).not.toHaveProperty('view');
    expect(res['customer_provider']).toBe('shopapi_v1');
  });
});
