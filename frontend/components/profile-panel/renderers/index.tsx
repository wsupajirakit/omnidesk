/**
 * [FEAT-20260905-CUSTPROV PART 7] 🔴 THE CLOSED SET. It lives here and nowhere
 * else.
 *
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          PART 7 §37 (the closed set) · §38 (this folder) · §39 (add a
 *          provider without an FE file) · §40 (the unknown-type rule)
 * 📖 CONTRACT: `omnidesk-api/src/modules/customer-provider/providers/engine/view.types.ts`
 *
 * ## THE ONE IDEA
 * The dashboard knows TYPES. It never learns a vendor's name or a vendor's field
 * names — there is no `providers/` folder on this side and no provider list in
 * this repo at all. That is what makes adding provider B, C or D a back-end-only
 * change (§39: one pure `buildView`, one registry line, one spec — no route, no
 * DTO, no FE file, no i18n key, no deploy step here).
 *
 * ## 🔴 ADDING A KEY TO THIS MAP IS AN FE RELEASE — AND THAT IS THE POINT
 * §40: *"A provider that truly needs bespoke UI registers ONE component in the
 * renderer set as a new `type`, and must justify why a primitive cannot express
 * it. Every such addition is an FE release, so the COUNT of them is the honest
 * measure of whether this design is holding."* Four today, matching the four the
 * producer emits — `field-options.registry.ts:25-29` rules out adding a fifth
 * for a future that has not arrived. ถ้าเริ่มเพิ่ม type ทุกครั้ง = ดีไซน์เริ่มพัง
 *
 * ## 🔴 WHY THE MAP IS THE SET, INSTEAD OF A UNION BESIDE IT
 * A hand-written `SectionType` union next to this object is the shape that
 * drifts: one gains a member, the other does not, and both halves still compile.
 * The BE closes that with two type assertions because its side is authored by
 * hand; here the map IS the list — `KNOWN_SECTION_TYPES` is derived from it, so
 * there is no second copy to disagree with. `Section.type` is deliberately
 * `string` (see `./types.ts`) because this side receives untrusted JSON.
 *
 * ## 🔴 `renderSection` NEVER RETURNS NULL
 * An unrecognised type falls through to `UnknownSection` — §40's requirement and
 * §41's mutation ("render an unknown `type` as empty instead of a labelled
 * fallback" must go red). A `null` here would make a provider that ships a type
 * early look, on screen, exactly like a provider that sent no data.
 *
 * revert: delete this folder (`components/profile-panel/renderers/`) and
 *         `test/profilePanelView.dom.test.tsx`. Nothing outside the folder
 *         imports it yet, so removal is a single `rm -r`.
 */
import React from 'react';
import { AmountRowsSection } from './AmountRowsSection';
import { EmptySection } from './EmptySection';
import { KvSection } from './KvSection';
import { ListSection } from './ListSection';
import { UnknownSection } from './UnknownSection';
import type { Section, SectionProps } from './types';

/**
 * THE CLOSED SET — `type` → renderer.
 *
 * Each key is emitted by `shopapi-v1/build-view.ts` today; none is speculative.
 *   kv           label/value rows (โปรโมชั่น)
 *   list         image + title + trailing value (สินค้าที่ซื้อล่าสุด, เหรียญ, รอบสะสมแต้ม)
 *   amount_rows  dated signed amounts (ประวัติฝาก/ถอน, เงินคืน, แนะนำเพื่อน)
 *   empty        the card that holds its place with nothing in it
 */
const RENDERERS: Readonly<Record<string, React.FC<SectionProps>>> = {
  kv: KvSection,
  list: ListSection,
  amount_rows: AmountRowsSection,
  empty: EmptySection,
};

/** Derived, never hand-listed — see the header. Sorted so it reads stably. */
export const KNOWN_SECTION_TYPES: readonly string[] = Object.keys(RENDERERS).sort();

/** `true` when this build can draw the type. Exported for tests and diagnostics. */
export const canRender = (type: string): boolean => Object.hasOwn(RENDERERS, type);

/**
 * A section → its body. Total: every input produces visible output.
 *
 * ⚠️ `Object.hasOwn`, not `RENDERERS[type]` alone — a section whose `type` is
 * `"constructor"` or `"toString"` would otherwise resolve to an inherited
 * `Object.prototype` member and React would be handed a function that is not a
 * component. Untrusted JSON reaches this line, so the lookup is guarded rather
 * than trusted. `type` มาจากสายนอก อย่าเชื่อว่าเป็นคีย์ของเราเสมอ
 */
export const renderSection = (section: Section): React.ReactElement => {
  const Renderer = canRender(section.type) ? RENDERERS[section.type] : undefined;
  return Renderer ? <Renderer section={section} /> : <UnknownSection section={section} />;
};

export { ProfilePanelView } from './ProfilePanelView';
export { AmountRowsSection, EmptySection, KvSection, ListSection, UnknownSection };
export { iconFor } from './icons';
export type { AmountRow, Chip, CustomerView, KvRow, ListItem, Section } from './types';
