/**
 * [FEAT-20261014-BASETAGS] The legacy `[[[name]]]` markers, read the active provider's way.
 *
 * Each declared marker is resolved exactly like a dynamic tag — `pickApiSource` finds the
 * endpoint block by `sub_type`, `computeDynamicTagValue` reads the path or the formula — so
 * there is one reader, not a second one for markers. A marker that comes back empty or
 * `N/A` is LEFT OUT of the result: the caller keeps legacy's value for it (`''` on a custom-
 * tool hook), which also means legacy-shaped data still wins wherever the table finds nothing.
 *
 * Pure. revert: drop the one `Object.assign` line in `reply-dyntag.ts` and this file.
 */
import type { ProviderBaseTags } from '@/modules/customer-provider';
// eslint-disable-next-line no-restricted-imports -- the same fence reply-dyntag.ts uses
import {
  computeDynamicTagValue,
  pickApiSource,
} from '@/modules/ai/rag-engine.service';

export function providerBaseTagValues(
  profileData: Record<string, unknown> | null | undefined,
  declared: ProviderBaseTags,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!profileData) return out;
  for (const [tag, pair] of Object.entries(declared)) {
    const dTag = { tag, sub_type: pair.sub_type, value: pair.value };
    const source = pickApiSource(profileData, dTag);
    if (!source) continue;
    let value: string;
    try {
      value = computeDynamicTagValue(source, dTag);
    } catch {
      continue;
    }
    if (value !== '' && value !== 'N/A') out[tag] = value;
  }
  return out;
}
