/**
 * [FEAT-20260822-CLONEFIELDS] Ticking SOME fields of a tab in Multi-Clone.
 * ===========================================================================
 * Owner, 22/08: "ค่าในกล่องแน่ ติ๊กเฉพาะบางรายการได้ เช่นเอาแค่ doc ก็ได้ · ติ๊กอะไรไปแค่นั้น".
 *
 * WHAT IT IS: the rules of the tick, as pure functions over one value —
 * `FieldPick` = { [tabKey]: fields[] }. A tab key present = the tab is ticked;
 * its array = exactly the fields that will be cloned. The modal only renders
 * this; nothing here knows React, the API, or secrets.
 *
 * SEAMLESS: a tab ticked whole = all its fields (what the tick always meant),
 * and `fieldsPayload` adds the `fields` key to the request ONLY when some tab
 * is partial. A whole-tab clone therefore sends the exact request it always
 * sent, and the BE (omnidesk-api `cloneHookSettings`) treats an absent `fields`
 * as "the whole tab" — byte-identical on both sides. ติ๊กทั้งแท็บ = request เดิมเป๊ะ.
 *
 * Secrets are NOT here on purpose: `include_secrets` keeps its own list and its
 * own BE gate (a secret named in `fields` without the tick is a 400 there).
 *
 * Order: fields and tabs are emitted in REGISTRY order (the order the BE's
 * field-tabs endpoint returns), never click order — so the BE's audit rows and
 * `fields_applied` read the same as a whole-tab clone.
 *
 * revert: delete this file, test/cloneFieldPick.value.test.ts, and the per-field
 *         checkboxes in HookCloneModal (the tab checkbox goes back to selectedTabs[]).
 */

export interface PickableTab {
  key: string;
  /** field names in registry order */
  fields: string[];
}

/** tabKey → the fields ticked in that tab (registry order). Absent key = tab not ticked. */
export type FieldPick = Record<string, string[]>;

export type TabState = 'none' | 'partial' | 'full';

export function tickTab(pick: FieldPick, tab: PickableTab): FieldPick {
  return { ...pick, [tab.key]: [...tab.fields] };
}

export function untickTab(pick: FieldPick, tabKey: string): FieldPick {
  const { [tabKey]: _gone, ...rest } = pick;
  void _gone;
  return rest;
}

export function toggleField(pick: FieldPick, tab: PickableTab, field: string): FieldPick {
  const current = new Set(pick[tab.key] ?? []);
  if (current.has(field)) current.delete(field);
  else current.add(field);
  if (current.size === 0) return untickTab(pick, tab.key);
  // registry order, not click order
  return { ...pick, [tab.key]: tab.fields.filter((f) => current.has(f)) };
}

export function tabState(pick: FieldPick, tab: PickableTab): TabState {
  const chosen = pick[tab.key];
  if (!chosen || chosen.length === 0) return 'none';
  return chosen.length >= tab.fields.length ? 'full' : 'partial';
}

/** The `tabs` (+ `fields` only when some tab is partial) part of the clone request. */
export function fieldsPayload(
  pick: FieldPick,
  tabs: PickableTab[],
): { tabs: string[]; fields?: string[] } {
  const selected = tabs.filter((t) => (pick[t.key]?.length ?? 0) > 0);
  const anyPartial = selected.some((t) => tabState(pick, t) === 'partial');
  const out: { tabs: string[]; fields?: string[] } = { tabs: selected.map((t) => t.key) };
  if (anyPartial) out.fields = selected.flatMap((t) => pick[t.key] ?? []);
  return out;
}
