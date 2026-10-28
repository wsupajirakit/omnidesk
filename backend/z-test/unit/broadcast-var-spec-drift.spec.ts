/**
 * [FEAT-20260822-BCASTSPECCLONE] The only place the clone and the original meet.
 * ===========================================================================
 * `content/broadcast-var/spec/broadcast-var-spec.ts` is a deliberate copy of
 * `system/dict-spec/flex-var-spec.ts`. A copy nobody compares drifts, and a
 * drifted var spec means a customer sees `{{bank_account_name}}` or `N/A` where
 * a real value belongs — silently, on every card that uses the missing tag.
 *
 * ⚠️ This file is ALLOWED to import the original; the runtime clone is not.
 *    That asymmetry is the design: production code stays decoupled, and the
 *    test is where the two are held together.
 *
 * ⚠️ If this goes red, fix the CLONE. The original is upstream and we follow it.
 *    แดงเมื่อไหร่ = ไปแก้สำเนา ไม่ใช่ไปแก้ต้นทาง.
 */
import {
  INTENTIONALLY_NOT_CLONED,
  walkBroadcastSiteRulesSpec,
  walkBroadcastVarSpec,
} from '@/modules/content';
import { walkFlexVarSpec, walkSiteRulesSpec } from '@/modules/system';

type Entry = { tag: string; path: string };

function collect(walk: (v: (t: string, p: string) => void) => void): Entry[] {
  const out: Entry[] = [];
  walk((tag, path) => out.push({ tag, path }));
  return out;
}

const originalProfile = collect(walkFlexVarSpec);
const cloneProfile = collect(walkBroadcastVarSpec);
const originalSite = collect(walkSiteRulesSpec);
const cloneSite = collect(walkBroadcastSiteRulesSpec);

const tags = (e: Entry[]) => e.map((x) => x.tag);
const byTag = (e: Entry[]) => new Map(e.map((x) => [x.tag, x.path]));

describe('spec drift — profile variables', () => {
  it('the original still produces variables at all (a vacuity check)', () => {
    // If the walker ever returned nothing, every comparison below would pass
    // while comparing two empty sets.
    expect(originalProfile.length).toBeGreaterThan(100);
    expect(cloneProfile.length).toBeGreaterThan(100);
  });

  it('🔴 the clone carries every tag the original does', () => {
    const missing = tags(originalProfile).filter(
      (t) =>
        !tags(cloneProfile).includes(t) &&
        !INTENTIONALLY_NOT_CLONED.includes(t),
    );
    expect(missing).toEqual([]);
  });

  it('🔴 the clone invents no tag the original does not have', () => {
    const extra = tags(cloneProfile).filter(
      (t) => !tags(originalProfile).includes(t),
    );
    expect(extra).toEqual([]);
  });

  it('🔴 every shared tag reads the SAME path', () => {
    // A matching tag list with a different path is the worst kind of drift:
    // everything looks present and every value is wrong.
    const o = byTag(originalProfile);
    const c = byTag(cloneProfile);
    const differing = [...o.entries()]
      .filter(([tag, path]) => c.has(tag) && c.get(tag) !== path)
      .map(([tag]) => tag);
    expect(differing).toEqual([]);
  });
});

describe('spec drift — site_rules variables', () => {
  it('the original still produces variables at all', () => {
    expect(originalSite.length).toBeGreaterThan(100);
    expect(cloneSite.length).toBeGreaterThan(100);
  });

  it('🔴 the clone carries every tag the original does', () => {
    const missing = tags(originalSite).filter(
      (t) =>
        !tags(cloneSite).includes(t) && !INTENTIONALLY_NOT_CLONED.includes(t),
    );
    expect(missing).toEqual([]);
  });

  it('🔴 the clone invents no tag the original does not have', () => {
    const extra = tags(cloneSite).filter(
      (t) => !tags(originalSite).includes(t),
    );
    expect(extra).toEqual([]);
  });

  it('🔴 every shared tag reads the SAME path', () => {
    const o = byTag(originalSite);
    const c = byTag(cloneSite);
    const differing = [...o.entries()]
      .filter(([tag, path]) => c.has(tag) && c.get(tag) !== path)
      .map(([tag]) => tag);
    expect(differing).toEqual([]);
  });
});

describe('the exception list is a decision, not a dumping ground', () => {
  it('every excluded tag must actually exist upstream', () => {
    // An entry for a tag the original never had is a leftover, and it would
    // hide a real omission behind it.
    for (const tag of INTENTIONALLY_NOT_CLONED) {
      expect([...tags(originalProfile), ...tags(originalSite)]).toContain(tag);
    }
  });
});
