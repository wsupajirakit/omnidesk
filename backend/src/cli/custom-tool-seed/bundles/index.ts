/**
 * [FEAT-20261014-TOOLSEED] Every seedable vendor bundle. ONE line per vendor.
 *
 * Adding vendor C: write `bundles/<id>.bundle.ts` (a `SeedBundle`), add it below. The CLI,
 * the plan and the spec need no change — the registry keys itself off `bundle.id`, so the id
 * is written once.
 */
import type { SeedBundle } from '../seed-bundle.types';

import { LOAN_V1_SEED_BUNDLE } from './loan-v1.bundle';

export const SEED_BUNDLES: ReadonlyMap<string, SeedBundle> = new Map(
  [LOAN_V1_SEED_BUNDLE].map((b) => [b.id, b]),
);
