/**
 * [UI-20260904-HIDEMATCHTAG] Display switches for the Object album list.
 *
 * A file of its own rather than a constant inside one of the components,
 * because the flag below is read by THREE of them and a switch that lives
 * inside one of its consumers is a switch the next reader cannot find.
 */

/**
 * Show the "Matching Tag" column, and the matching-tag block in the preview
 * dialog?
 *
 * `false` hides both. The owner asked for it on 04/09: the tag is still what
 * the album answers to, it just stops taking a column on a screen that already
 * has eight.
 *
 * 🔴 THE HEADER AND THE CELL MUST MOVE TOGETHER. `ObjectImageTable` renders the
 *    `<th>` and `ObjectImageRow` renders the `<td>`, in different files. Hiding
 *    one and not the other does not hide a column — it shifts every column after
 *    it by one, so Categories sits under Storage and nothing looks obviously
 *    broken. That is why both read this same flag, and why the DOM test asserts
 *    the header count and the cell count together.
 *
 * ⚠️ NOTHING ABOUT THE DATA CHANGES. `matching_tag` is still stored, still
 *    returned by the API, still copied by the copy button in the row's own
 *    actions, and still what the webhook matches on. Only these two views stop
 *    drawing it.
 *
 * Flip to `true` to bring the column back; no other edit is needed.
 */
export const SHOW_MATCHING_TAG = false;

/**
 * [FEAT-20260907-OBJUPLOADSTEP] Which wizard step manages an album's FILES.
 *
 * `stepDefsFor` (`components/object/form/objectImageForm.constants.ts:93`)
 * returns `[STEP_BASIC, STEP_MEDIA, STEP_ACCESS]`, so the media step is index 1
 * — "step 2" as the screen numbers them.
 *
 * ⚠️ A NAMED CONSTANT, not a `1` typed at each call site. Two entry points open
 *    on it (the upload action and the album picture), and a reordering of those
 *    step defs would otherwise silently send both to the wrong page of the form.
 */
export const OBJ_MEDIA_STEP = 1;
