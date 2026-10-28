/**
 * [FEAT-20260822-BCASTFORMATCLONE] Cloned map builders — spec walk + formatter.
 * ===========================================================================
 * Copied from `webhook/flex/flex-data-vars.util.ts` (`buildFlexProfileVarMap`,
 * `buildSiteRulesVarMap`), rewired onto OUR cloned spec and OUR cloned
 * formatter so nothing here reaches into the original at runtime.
 *
 * These are the piece that ties the two clones together: walk every tag the
 * spec declares, read its path out of the data, and format the value. Getting
 * them wrong would produce a map that has the right KEYS and the wrong VALUES,
 * which is why `broadcast-var-format-drift.spec.ts` compares our output against
 * the original's on the same input rather than trusting the copy.
 *
 * ⚠️ Empty stays `-` here, exactly as upstream. Our `N/A` is a separate pass
 *    (`checks/empty-value.ts`) applied after the map is built — see the note in
 *    `value-format.ts`.
 *
 * revert: delete this file with the rest of `format/`.
 */
import {
  walkBroadcastSiteRulesSpec,
  walkBroadcastVarSpec,
} from '../spec/broadcast-var-spec';
import { pickShop } from '../spec/pick-shop';
import { canonicalFlexPath } from '../spec/spec-path';
import { resolveBankNiceName } from '../../bank-directory';
import {
  type FlexBuildOpts,
  type TranslateFn,
  formatFlexVar,
  formatSiteRulesVar,
  readSpecPath,
} from './value-format';

export function buildFlexProfileVarMap(
  profile: unknown,
  opts: FlexBuildOpts = {},
  translate: TranslateFn,
): Record<string, string> {
  const p = profile && typeof profile === 'object' ? profile : {};
  const out: Record<string, string> = {};

  // legacy flexVarSpec.js:466 — scope = profile.web_code, override-able by opts.
  //   ⚠️ opts.scope wins so the shop block (no web_code of its own) and the
  //      profile block share ONE scope, set by the orchestrator.
  const scopeFromProfile = readSpecPath(p, 'web_code');
  const scope =
    opts.scope ??
    (typeof scopeFromProfile === 'string' ? scopeFromProfile : undefined);
  const tool = opts.tool ?? undefined;

  walkBroadcastVarSpec((tag, path) => {
    out[tag] = formatFlexVar(
      readSpecPath(p, path),
      {
        path,
        // legacy computes field the same for every row kind: last dotted segment
        field: String(path).split('.').pop() ?? '',
        canonical: canonicalFlexPath(path),
        fullPath: `data.profile.${path}`,
        scope,
        tool,
      },
      translate,
    );
  });

  // [FEAT-20260802-BANKNICE] legacy flexVarSpec.js:524-527 — {{bank_code}} shows
  //   the pretty name (bbl → Bangkok Bank), overwriting the raw code the walk
  //   just wrote. Unknown code keeps its original value (never blank / throw).
  const rawBankCode = readSpecPath(p, 'bank.code');
  out['bank_code'] = formatFlexVar(
    rawBankCode ? resolveBankNiceName(rawBankCode) : rawBankCode,
    null,
    translate,
  );

  return out;
}

/**
 * [FIX-20260808-FLEXVARMAP] REAL-DATA site_rules map — legacy
 * `buildSiteRulesVarMap` (config/siteRulesVarSpec.js:270-290). Reuses
 * `pickShop` (finds the shop block in any response shape) and `walkSiteRulesSpec`.
 *
 * ⚠️ The shop block carries no `web_code`, so `scope` MUST come from opts — the
 *    orchestrator passes the profile's web_code. Without it, site-specific words
 *    die silently on this source only (legacy siteRulesVarSpec.js:277-284).
 * ⚠️ `data.shop.` fullPath prefix, not `data.profile.` — different stored key.
 */
export function buildSiteRulesVarMap(
  raw: unknown,
  opts: FlexBuildOpts = {},
  translate: TranslateFn,
): Record<string, string> {
  const shop = pickShop(raw);
  const out: Record<string, string> = {};
  const tool = opts.tool ?? undefined;
  const scope = opts.scope ?? undefined;

  walkBroadcastSiteRulesSpec((tag, path) => {
    out[tag] = formatSiteRulesVar(
      readSpecPath(shop, path),
      {
        path,
        field: String(path).split('.').pop() ?? '',
        canonical: canonicalFlexPath(path),
        fullPath: `data.shop.${path}`,
        scope,
        tool,
      },
      translate,
    );
  });

  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// pickByRole — the runtime block picker
// ───────────────────────────────────────────────────────────────────────────

/**
 * [FIX-20260808-FLEXVARMAP] Find a data block by its declared `role`, then by a
 * fallback key regex — legacy `customToolService.pickByRole`
 * (services/core-bot/customToolService.js:983-994). Used by the site_rules
 * `pick` below: `pickByRole(profileData, 'site_rules', /site.?rule/i)?.block?.data`.
 */
