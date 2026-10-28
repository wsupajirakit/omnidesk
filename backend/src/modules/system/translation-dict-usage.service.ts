import { Injectable } from '@nestjs/common';

import {
  collectSpecPaths,
  pickShop,
  walkFlexVarSpec,
  walkSiteRulesSpec,
} from './dict-spec/flex-var-spec';
import { FORMAT_RULES } from './dict-spec/flex-var-format-rules';
import SITE_RULES_SAMPLE from './dict-spec/siteRulesSample.json';

/**
 * "Where is this dictionary actually used?" — answered from the format rules.
 *
 * Ported from legacy-api `controllers/system/translationDictController.js`
 * (`buildUsageMap` at :45, `siteLeafIndex` at :131).
 *
 * The rules live in code, not in the database, deliberately: storing the list of
 * positions would mean re-syncing it every time a rule changes, and it would
 * drift silently when someone forgot. Computing it per request means the table
 * an admin sees is always current.
 */

/** One place a dictionary is applied, as the admin table renders it. */
export interface UsageSpot {
  kind: 'path' | 'any' | 'field';
  path: string;
  side: 'profile' | 'site_rules' | 'both' | 'unknown';
  tag: string | null;
}

export type UsageMap = Record<string, UsageSpot[]>;

/**
 * A position where a field NAME is translated. Deliberately without `kind` —
 * see `labelSpots`. Typed separately rather than as `Partial<UsageSpot>` so the
 * difference is stated rather than looking like an oversight.
 */
export interface LabelSpot {
  path: string;
  side: 'site_rules';
  tag: string | null;
}

/**
 * Spec paths are relative to their own block; admins read the raw JSON, so the
 * root each block hangs under is prepended to match what they actually see.
 */
const ROOT: Record<string, string> = {
  profile: 'data.profile.',
  site_rules: 'data.shop.',
};

@Injectable()
export class TranslationDictUsageService {
  /**
   * Index of every leaf field name in the site-rules sample → the full paths it
   * occurs at. Memoised: the sample is a static file, so the walk is done once.
   */
  private leafCache: Record<string, string[]> | null = null;

  private siteLeafIndex(): Record<string, string[]> {
    if (this.leafCache) return this.leafCache;
    const shop = pickShop(SITE_RULES_SAMPLE);
    const out: Record<string, string[]> = {};
    const walk = (o: unknown, p: string): void => {
      if (Array.isArray(o)) {
        o.forEach((v, i) => walk(v, `${p}[${i}]`));
        return;
      }
      if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
          const np = p ? `${p}.${k}` : k;
          (out[k] ??= []).push(`data.shop.${np}`);
          walk(v, np);
        }
      }
    };
    walk(shop, '');
    this.leafCache = out;
    return out;
  }

  /**
   * Expand a canonical path back into the REAL, indexed paths the spec lays out.
   *
   * An admin writing a translation thinks in concrete positions (deposit[0],
   * deposit[1]) rather than in the `[]` pattern, so one rule becomes several
   * rows — one per position the spec expands to — each carrying the tag that
   * reads it, e.g. `{{deposit_1_status}}`.
   */
  private expand(
    canonical: string,
    side: 'profile' | 'site_rules',
  ): Array<{ path: string; tag: string | null }> {
    const out: Array<{ path: string; tag: string | null }> = [];
    const walk = side === 'site_rules' ? walkSiteRulesSpec : walkFlexVarSpec;
    walk((t, pp) => {
      if (String(pp).replace(/\[[^\]]*\]/g, '[]') === canonical) {
        out.push({ path: String(pp), tag: t });
      }
    });
    // A rule whose path the spec never expands still deserves a row, so the
    // admin sees the rule exists rather than an unexplained gap.
    return out.length ? out : [{ path: canonical, tag: null }];
  }

  /** dictionary name → every place it is applied. */
  buildUsageMap(): UsageMap {
    const profilePaths = collectSpecPaths();
    const sitePaths = new Set<string>();
    walkSiteRulesSpec((_t, pp) =>
      sitePaths.add(String(pp).replace(/\[[^\]]*\]/g, '[]')),
    );

    const out: UsageMap = {};
    for (const r of FORMAT_RULES) {
      // A rule with neither a dict nor a format contributes no row.
      const name = r.dict ?? (r.format ? `(รูปแบบ ${r.format})` : null);
      if (!name) continue;
      const list = (out[name] ??= []);
      if (r.canonical) {
        const side = profilePaths.has(r.canonical)
          ? 'profile'
          : sitePaths.has(r.canonical)
            ? 'site_rules'
            : 'unknown';
        if (side === 'unknown') {
          list.push({ kind: 'path', path: r.canonical, side, tag: null });
          continue;
        }
        for (const e of this.expand(r.canonical, side)) {
          list.push({
            kind: 'path',
            path: (ROOT[side] ?? '') + e.path,
            side,
            tag: e.tag,
          });
        }
      } else if (r.isBoolean) {
        list.push({
          kind: 'any',
          path: 'ทุก field ที่เป็น true/false',
          side: 'both',
          tag: null,
        });
      } else if (r.field) {
        // ⚠️ String(regex) is intentional and matched to legacy: the datetime
        // rule's `field` is a RegExp, and legacy renders it as its source text
        // (`/^(date|time)$|(_at|_date)$/`) straight into the admin table.
        list.push({
          kind: 'field',
          path: `field ชื่อ ${String(r.field)}`,
          side: 'both',
          tag: null,
        });
      }
    }
    return out;
  }

  /**
   * Paths where a *field name* (not its value) is translated — label dicts.
   *
   * ⚠️ These spots carry NO `kind`, unlike the ones from `buildUsageMap`.
   * Legacy builds them as `{path, side, tag}` (translationDictController.js:187)
   * and the FE distinguishes the two by that absence, so adding `kind: "path"`
   * for symmetry would change the payload.
   */
  labelSpots(key: string): LabelSpot[] {
    return (this.siteLeafIndex()[key] ?? []).map((p) => ({
      path: p,
      side: 'site_rules' as const,
      tag: null,
    }));
  }
}
