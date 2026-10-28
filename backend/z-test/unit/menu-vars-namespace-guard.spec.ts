/**
 * [FEAT-20260828-MENUTAG-S6] the namespace whitelist (plan §5 S6).
 *
 * WHAT THIS GUARDS: a scenario using a `{{namespace.field}}` the central
 * builders never produce. The central applier keeps an unknown tag literal, so
 * the failure is not a crash — it is `{{profile.nickname}}` printed to a
 * customer, forever, with nothing red anywhere. This is the fence that turns
 * that into a build failure.
 *
 * 🔴 THE ALLOWED SET IS DERIVED, NEVER LISTED HERE:
 *   · data namespaces  ← `FLEX_VAR_SOURCES`, imported from the webhook BARREL
 *   · context names    ← read out of `flex-render.util.ts` itself, the same
 *     source-census technique `webhook-log-door-census.spec.ts` already uses in
 *     this repo. `FLEX_CONTEXT_VARS` is not barrel-exported and adding an export
 *     would be an edit to someone else's module (STANDING ORDER #1 — ask first),
 *     so the guard reads the source rather than asking for a change.
 * Either list growing centrally widens this guard by itself.
 *
 * ⚠️ Every shipped scenario is a placeholder today (Q6), so nothing here uses a
 * variable yet and the sweep would pass vacuously. The last case fabricates a
 * bad scenario and requires the checker to REJECT it — without that, this file
 * would be decoration.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { FLEX_VAR_SOURCES } from '@/modules/webhook';
import { SCENARIOS, type MenuDefinition } from '@/modules/menu';

const CENTRAL = (): string =>
  readFileSync(
    resolve(__dirname, '../../src/modules/webhook/flex/flex-render.util.ts'),
    'utf8',
  );

/**
 * The tag regex is READ OUT of the central applier rather than copied here.
 * A copy would drift the day someone widens the central pattern — the guard
 * would keep scanning with the old one and quietly stop catching things. Same
 * reasoning as CONTEXT_NAMES below; the 28/08 audit found the copy and removed
 * it.
 */
const TAG_RE = (): RegExp => {
  const m =
    /replaceIn = \(s: unknown\): string =>\s*String\(s\)\.replace\(\s*(\/[^\n]+\/g),/.exec(
      CENTRAL(),
    );
  if (!m)
    throw new Error('central tag regex not found — flex-render.util.ts moved');
  const body = m[1]!.replace(/^\//, '').replace(/\/g$/, '');
  return new RegExp(body, 'g');
};

const CONTEXT_NAMES = (): string[] => {
  const src = CENTRAL();
  const block = src.slice(src.indexOf('FLEX_CONTEXT_VARS'));
  const end = block.indexOf('\n};');
  const names = [...block.slice(0, end).matchAll(/^\s{2}([a-z_]+):/gm)].map(
    (m) => m[1]!,
  );
  return names;
};

/** Every string a scenario can put in front of a customer. */
const stringsOf = (d: MenuDefinition): string[] => {
  const out = [d.title];
  for (const item of d.items) {
    out.push(item.label);
    if (item.action.type === 'result') {
      const r = item.action.result;
      if (r.kind === 'text') out.push(r.text);
      if (r.kind === 'flex') out.push(r.altText, JSON.stringify(r.flex));
      if (r.kind === 'image') out.push(r.imageUrl, r.previewUrl ?? '');
    }
  }
  return out;
};

const offendingTags = (defs: Iterable<MenuDefinition>): string[] => {
  const roles = Object.keys(FLEX_VAR_SOURCES);
  /* `buildFlexVarMaps` writes a BARE tag only for a source marked implicit
     (profile today) — so a bare name is legal exactly when such a source
     exists, or when it is one of the reserved context names. */
  const implicitExists = Object.values(FLEX_VAR_SOURCES).some(
    (src) => (src as { implicit?: boolean }).implicit === true,
  );
  const context = new Set(CONTEXT_NAMES());

  const allowed = (name: string): boolean => {
    const dot = name.indexOf('.');
    if (dot > 0) return roles.includes(name.slice(0, dot));
    return context.has(name) || implicitExists;
  };

  const bad: string[] = [];
  for (const d of defs) {
    for (const s of stringsOf(d)) {
      for (const m of String(s).matchAll(TAG_RE())) {
        if (!allowed(m[1]!.toLowerCase())) bad.push(`${d.key}: {{${m[1]!}}}`);
      }
    }
  }
  return bad;
};

describe('[MENUVARS] scenario variables stay inside namespaces the builders produce', () => {
  it('the derived allow-list is not empty (a vacuous guard would pass everything)', () => {
    expect(Object.keys(FLEX_VAR_SOURCES)).toEqual(
      expect.arrayContaining(['profile', 'site_rules']),
    );
    expect(CONTEXT_NAMES()).toEqual(
      expect.arrayContaining(['hook_domain', 'hook_name', 'hook_detail']),
    );
  });

  it('⭐⭐⭐ every shipped scenario uses only known namespaces', () => {
    expect(offendingTags(SCENARIOS.values())).toEqual([]);
  });

  it('⭐⭐⭐ and the checker actually REJECTS an unknown namespace', () => {
    /* Without this the sweep above proves nothing while the scenarios are
       placeholders: an empty input passes any predicate. */
    const bogus: MenuDefinition = {
      key: 'primary-a',
      level: 'primary',
      variant: 'a',
      enabled: true,
      title: 'hi {{shop.owner_name}}',
      items: [
        {
          id: 'x',
          label: 'ok {{profile.name}}',
          action: { type: 'result', result: { kind: 'text', text: 'plain' } },
        },
      ],
    };
    expect(offendingTags([bogus])).toEqual(['primary-a: {{shop.owner_name}}']);
  });
});
