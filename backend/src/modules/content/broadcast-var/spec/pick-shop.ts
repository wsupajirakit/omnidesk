/**
 * [FEAT-20260822-BCASTSPECCLONE] Cloned `pickShop`.
 *
 * Copied from `system/dict-spec/flex-var-spec.ts`. It absorbs every envelope
 * shape the site-rules payload arrives in, and `hooks.raw_site_rules_data`
 * stores `{ data: { shop: … } }` — the first shape it looks for.
 *
 * revert: delete this file with the rest of `spec/`.
 */

export function pickShop(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const data = r['data'] as Record<string, unknown> | undefined;
  const fromData = data?.['shop'];
  if (fromData && typeof fromData === 'object') {
    return fromData as Record<string, unknown>;
  }
  const shop = r['shop'];
  if (shop && typeof shop === 'object') return shop as Record<string, unknown>;
  if (data && typeof data === 'object') return data;
  return r;
}

/** Walk the site-rules spec once — the mirror of `walkFlexVarSpec`. */
