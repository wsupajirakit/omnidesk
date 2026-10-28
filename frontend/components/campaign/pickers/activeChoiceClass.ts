/**
 * [UI-20260824-BCASTACTIVE] The one "this option is chosen" look for the broadcast form.
 * ===========================================================================
 * Owner, 24/08: *"สีเขียวมันดูยากไป เข้มกว่านี้ light theme"*.
 *
 * 🔴 WHAT WAS WRONG. Every card/pill in `BroadcastFormModal` painted its active
 *    state as `border-emerald-400 bg-emerald-500/10 text-emerald-300`. That
 *    string was written for a DARK panel: `emerald-300` (#6EE7B7) is a pale mint
 *    meant to glow on near-black. This app's `dark-*` tokens are LIGHT surfaces
 *    (`index.css:46-49` — `--color-dark-800: #EDF1F6`), so the label was pale
 *    mint on near-white at roughly 1.5:1 contrast — visible only if you already
 *    knew where to look. เขียวอ่อนบนพื้นขาว = แทบมองไม่เห็นว่าเลือกอันไหนอยู่.
 *
 * 🔴 NOT AN INVENTED PALETTE. `CHOICE_ACTIVE` is copied from the readable active
 *    state this repo already ships — `components/bulk/BulkStatusModal.tsx:101`
 *    and `components/bulk/BulkMethodModal.tsx:469` use this exact string for a
 *    selected card. It keeps the emerald identity ("chosen" stays green) but
 *    moves the WEIGHT to a dark label (`emerald-700`) on a light tint
 *    (`emerald-50`), with a ring so the choice reads even at a glance.
 *    ลอกของที่ repo ใช้อยู่แล้ว ไม่ได้กะสีเอง.
 *
 * ⚠️ THE `dark:` VARIANT IS REAL HERE. This app toggles themes with
 *    `html.theme-dark`, not Tailwind's default `.dark` — `index.css:33` maps the
 *    variant with `@custom-variant dark`. So `dark:text-emerald-300` genuinely
 *    fires in the dark theme, which is why the OLD pale value survives there and
 *    nothing regresses for dark-theme users. ธีมมืดยังได้สีเดิม ไม่เสียของ.
 *
 * WHY A MODULE AND NOT A CONST IN THE MODAL: eleven call sites repeated the same
 * ternary, which is how they drifted apart in the first place, and
 * `BroadcastFormModal.tsx` is already past the 400-line cap so nothing new may
 * be added to it. A test can also assert on these exports directly.
 *
 * revert: inline `border-emerald-400 bg-emerald-500/10 text-emerald-300` back at
 * each call site and delete this file — the pale state returns everywhere.
 */

/** Chosen. Dark emerald label on a light emerald tint + ring; pale mint in dark theme. */
export const CHOICE_ACTIVE =
  'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-semibold ring-2 ring-emerald-400/50';

/** Not chosen — byte-identical to what every card in the form already used, so
 *  this change only ever touches the ACTIVE branch. ปุ่มที่ไม่ได้เลือก ต้องเหมือนเดิมเป๊ะ. */
export const CHOICE_IDLE = 'border-dark-700 text-slate-600 hover:border-primary-500/40';

export const choiceClass = (active: boolean): string => (active ? CHOICE_ACTIVE : CHOICE_IDLE);
