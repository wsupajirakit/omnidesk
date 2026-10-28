/**
 * [FEAT-20260829-NOTICEUNSAVED] the notification tab saves on its OWN route
 * ===========================================================================
 * Owner 29/08. Two things that look like one:
 *
 * 🔴 THE MARKER WAS LYING. `savedSnapshot` lived in `HookNoticeTab`, which is
 *    unmounted the moment you leave the tab (`activeTab === 'notice' && <…/>`),
 *    and re-seeded from the CURRENT form on the way back. So: edit, visit another
 *    tab, come back — and the tab claimed "ตรงกับที่บันทึกไว้" while the change had
 *    never been sent. Nothing was lost (the values live in the parent's formData),
 *    but the one thing telling the admin they still had to press the tab's own
 *    save button had quietly reset itself.
 *
 * 🔴 AND THE MAIN SAVE SAID NOTHING. The tab writes to `PUT /hook/notice/:id`,
 *    a different route from the form's own save, so pressing the main button
 *    saves everything EXCEPT the notification settings — silently. The admin
 *    sees a success toast and reasonably believes all of it went.
 *
 * ⚠️ THE GUARD ONLY WORKS BECAUSE THE SNAPSHOT MOVED. Read from inside the tab it
 *    would fire only while the admin happens to be standing on that tab; from any
 *    other tab it would be silent — a guard that looks present and is not, which
 *    is worse than none. The two halves are one change for that reason.
 *
 * ⚠️ CLEAN STATE MUST STAY OUT OF THE WAY. Nothing about the ordinary save path
 *    may change when there is nothing pending — that case is asserted here too,
 *    because a guard that fires when it should not is the way this breaks the app.
 *
 * revert: delete `utils/noticeUnsaved.ts`, this spec, and the `noticeSavedRef` /
 *         guard block in `HookFormModal.tsx`.
 */
import { describe, expect, it } from 'vitest';

import { noticeSnapshot, noticeIsDirty } from '../utils/noticeUnsaved';

const base = {
  alias: 'oa-one',
  notice_deposit_status: true,
  notice_deposit_scope: 'text',
  notice_deposit_flex_id: 'card-1',
};

describe('[NOTICEUNSAVED] the snapshot', () => {
  it('⭐⭐ carries the notice fields', () => {
    expect(noticeSnapshot(base)).toContain('notice_deposit_status');
  });

  it('⭐⭐ 🔴 ignores everything that is not a notice field', () => {
    /* The tab writes its own route with its own body — a change to `alias`
       belongs to the main save and must never light this marker. */
    expect(noticeSnapshot(base)).toBe(noticeSnapshot({ ...base, alias: 'renamed' }));
  });

  it('⭐ key order in the form object cannot change the answer', () => {
    const reordered = {
      notice_deposit_flex_id: 'card-1',
      notice_deposit_scope: 'text',
      notice_deposit_status: true,
      alias: 'oa-one',
    };
    expect(noticeSnapshot(reordered)).toBe(noticeSnapshot(base));
  });
});

describe('[NOTICEUNSAVED] dirty', () => {
  it('⭐⭐ 🔴 a changed notice field is dirty', () => {
    expect(noticeIsDirty(noticeSnapshot(base), { ...base, notice_deposit_scope: 'all' })).toBe(true);
  });

  it('⭐⭐ 🔴 an untouched form is NOT dirty — the ordinary save must not be blocked', () => {
    expect(noticeIsDirty(noticeSnapshot(base), base)).toBe(false);
  });

  it('⭐⭐ 🔴 a change OUTSIDE the notice fields is not dirty either', () => {
    /* Renaming the OA must not make the notification guard fire. */
    expect(noticeIsDirty(noticeSnapshot(base), { ...base, alias: 'renamed' })).toBe(false);
  });

  it('⭐⭐ no snapshot yet ⇒ never dirty, so a form that never opened the tab saves normally', () => {
    /* `null` is the state before the tab has ever been mounted. Treating the
       unknown as "dirty" would block every save on every OA. */
    expect(noticeIsDirty(null, base)).toBe(false);
  });

  it('⭐ junk never throws and never blocks', () => {
    expect(noticeIsDirty(noticeSnapshot(base), null)).toBe(false);
    expect(noticeIsDirty(undefined, undefined)).toBe(false);
  });
});
