/* [FE] Modal shell, "form" family — characterization test for [FEAT-20260810-MODALSHELL].
 *
 * Same job as `modalShell.dom.test.tsx`, for the second chrome family: five
 * dialogs across `components/admin/` and `components/campaign/` whose overlay
 * class string is IDENTICAL character for character and whose panel differs only
 * by its `max-w-*` token. The snapshots below are recorded from the hand-written
 * markup BEFORE those files adopt the primitive, so the adoption is provable
 * rather than asserted. ถ่าย DOM ไว้ก่อนแก้ ถ้า snapshot ขยับ = refactor เปลี่ยนของจริง
 *
 * Only the shell is under test here. Each dialog's form body is its own feature
 * and is deliberately not exercised — a snapshot that includes it still detects
 * any shell change, which is all this file claims to prove.
 *
 * revert: delete this file together with the primitive's `form` variant.
 *
 * ⚠️ 16/08/2026 — the GroupFormModal snapshot was RE-RECORDED, not deleted. Two
 * changes to that dialog moved its markup on purpose:
 *   · a save control now sits in the header (the form grew long enough that the
 *     footer button could be below the fold), through the new optional
 *     `actions` slot on `Modal.Header` — a slot that renders nothing when it is
 *     not passed, so every OTHER dialog in this file kept its exact markup and
 *     its snapshot is untouched, which is the evidence that the shared
 *     primitive itself did not change
 *   · the "copy permissions from" field moved up in the form, because its
 *     dropdown panel opened into the dialog's bottom edge
 * The case still guards what it always guarded: the shell. If the shell moves
 * again for a reason nobody wrote down here, this is still the test that says so.
 *
 * ⚠️ 24/08/2026 — the BroadcastFormModal snapshot was RE-RECORDED for the same
 * class of reason, and again on purpose. Two deliberate moves in that dialog:
 *   · a confirm AND a cancel now sit in the header, through the same optional
 *     `actions` slot GroupFormModal already uses. The owner asked for both
 *     ("ปุ่มยืนยัน ยกเลิก เพิ่มที่ header ด้วย"), which is why a cancel is there
 *     despite the note on `actions` in `components/common/Modal.tsx` advising
 *     against one — that trade-off is recorded at the call site, not hidden here.
 *     The FOOTER buttons were kept: "เพิ่มที่ header ด้วย" is add, not move.
 *   · the panel widened `max-w-4xl` → `max-w-6xl` (the form grew a third column)
 * As before, every OTHER dialog in this file kept its exact markup and its
 * snapshot is untouched — which is the evidence that the shared primitive itself
 * did not change. เปลี่ยนแค่ dialog เดียว ตัวอื่นต้องไม่ขยับ.
 *
 * ⚠️ 25/08/2026 — RE-RECORDED again, BroadcastFormModal only, for two more owner
 * instructions about the header the 24/08 round had just created:
 *   · "header modal button ขอ size เดียวกับ footer" — the header pair was
 *     `px-4 py-1.5` with a 14px icon while the footer was `px-6 py-2.5` with 18.
 *     Two buttons that do the same thing in the same dialog now look the same.
 *   · "เอาปุ่มกากบาทออกไป" — the X is gone. A cancel with a word on it already
 *     sits in that header, so the X was a second way to do the same thing, and
 *     the smaller, unlabelled one. Escape and the overlay click still close the
 *     dialog; the primitive owns both, and neither was touched here.
 * The other four dialogs' snapshots are again untouched, for the same reason and
 * as the same evidence.
 *
 * ⚠️ 25/08/2026 — RE-RECORDED once more, BroadcastFormModal only. The owner asked
 * for the wizard's ย้อนกลับ / ต่อไป to appear in the header as well as the footer
 * ("ปุ่มต่อไปกับย้อนกลับ เอาขึ้น header ด้วย"). It is the SAME `BroadcastStepNav`
 * component the footer renders — not a second pair of buttons — so the rules that
 * disable ย้อนกลับ on step one, hide ต่อไป on the last step, and hide both in
 * "แสดงทุกขั้นตอน" mode apply to it automatically.
 *
 * 🔴 The shared `Modal` gained a scroll hint in the same round, and the other four
 * dialogs' snapshots did NOT move — which is the evidence that the hint was added
 * without changing the shell. An earlier attempt wrapped the body in an extra div
 * and turned five snapshots red at once; that version was thrown away rather than
 * re-recorded, because a shell change is exactly what this file exists to refuse.
 */
/* ⚠️ 25/08/2026 — snapshot **ทุกตัว** ในไฟล์นี้ถูกอัดใหม่พร้อมกัน ซึ่งเป็นครั้งแรก
 * ที่เกิดขึ้น และนั่นคือเหตุผลที่ต้องเขียนไว้ตรงนี้
 *
 * เจ้าของสั่ง 25/08 ให้ **ล็อกความสูงโมดัล** แทนที่จะยืดตามเนื้อหา
 * ("lock ความสูง modal ไม่งั้นมันกินขอบ · lock modal สูงทุก ๆ หน้า")
 * ⇒ `max-h-[90vh]` / `max-h-[86vh]` กลายเป็น `h-[90vh]` / `h-[86vh]` บนตัวโมดัลกลาง
 *
 * เหตุผลของเจ้าของ: กล่องที่ยืดตามเนื้อหาทำให้ dropdown ที่กางใกล้ขอบล่างล้นออกไป
 * แล้วโดนตัด และทำให้ปุ่มแถวล่างขยับไปมาระหว่างขั้นของวิซาร์ด
 *
 * 🔴 นี่คือการเปลี่ยนแปลงชนิดที่ไฟล์นี้มีไว้ "ปฏิเสธ" — แก้ที่ตัวกลางแล้วขยับทุก
 *    dialog · ที่ยอมให้ผ่านเพราะเป็นคำสั่งตรงและระบุว่า "ทุก ๆ หน้า" · และสิ่งที่
 *    ขยับจริงมีแค่คลาสของ panel เท่านั้น — overlay / header / body เหมือนเดิมทุก
 *    ตัวอักษร
 * ⇒ ถ้าวันหลัง snapshot พวกนี้ขยับโดยไม่มีบรรทัดแบบนี้อยู่ข้าง ๆ นั่นคืออุบัติเหตุ
 *   ที่ไฟล์นี้มีไว้จับ
 *
 * ⚠️ และอีกครั้งในวันเดียวกัน — เฉพาะ BroadcastFormModal: ปุ่มยืนยันได้คลาสจาง
 *    (`opacity-40`) กับ `title` อธิบายเหตุผล เมื่อยังเดินไม่ถึงขั้นสุดท้ายของวิซาร์ด
 *    (เจ้าของ: *"ถ้ายังไม่ถึง step สุดท้าย ปุ่มยืนยันจะกดไม่ได้ เบลอ · ถ้าพยายามกด
 *    ให้บอกไปว่าทำไม"*) · **ไม่ใช้ `disabled`** เพราะปุ่มที่กดแล้วเงียบไม่ได้บอก
 *    อะไรใคร — กดได้แต่ถูกกันไว้แล้วขึ้นเหตุผลแทน กติกาเดียวกับช่องติ๊กยืนยัน
 *    อีกสี่ dialog ไม่ขยับ ซึ่งเป็นหลักฐานว่าตัวกลางไม่ถูกแตะรอบนี้
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

vi.mock('../services/admin/visibleGroups', () => ({
  fetchVisibleGroups: () => Promise.resolve([]),
  filterVisibleHooks: (hs: any[]) => hs,
}));

import { ChangePasswordModal, GroupFormModal, UserFormModal } from '../components/admin';
import { AutoReplyFormModal, BroadcastFormModal } from '../components/campaign';
import { I18nProvider } from '../i18n';

beforeAll(() => {
  if (!window.matchMedia)
    (window as any).matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
});

const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);
const noop = () => {};
const asyncNoop = async () => {};

/** The shell is the overlay + panel + header. Asserting on it directly keeps the
 *  snapshot readable and makes a failure point at the chrome, not at form fields
 *  that a feature change is allowed to move. */
const shellOf = (container: HTMLElement) => {
  const overlay = container.firstElementChild as HTMLElement;
  const panel = overlay?.firstElementChild as HTMLElement;
  const header = panel?.firstElementChild as HTMLElement;
  return {
    overlay: overlay?.className,
    panel: panel?.className,
    header: header?.className,
    headerHtml: header?.outerHTML,
  };
};

/**
 * Structure, not just classes.
 *
 * `shellOf` above compares class strings, which would NOT notice a child moving
 * from one parent to another. That matters here: UserFormModal and
 * BroadcastFormModal render their nested AlertModal/ConfirmModal as SIBLINGS of
 * the panel, inside the overlay — so a primitive that puts every child inside the
 * panel would silently reparent them and the class-only assertion would still be
 * green. This records the overlay's child list so that move cannot pass.
 * เทียบ class อย่างเดียวไม่พอ — ลูกย้ายพ่อแม่แล้ว class ยังเหมือนเดิม
 */
const overlayStructure = (container: HTMLElement) => {
  const overlay = container.firstElementChild as HTMLElement;
  const panel = overlay?.firstElementChild as HTMLElement;
  return {
    overlayChildCount: overlay?.childElementCount,
    overlayChildTags: Array.from(overlay?.children ?? []).map((c) => c.tagName),
    panelChildTags: Array.from(panel?.children ?? []).map((c) => c.tagName),
  };
};

describe('form-family dialogs keep their overlay child structure', () => {
  it('UserFormModal — nested Alert/Confirm stay siblings of the panel', () => {
    const { container } = wrap(
      <UserFormModal isOpen onClose={noop} onSubmit={asyncNoop as any} />,
    );
    expect(overlayStructure(container)).toMatchSnapshot();
  });

  it('AutoReplyFormModal', () => {
    const { container } = wrap(
      <AutoReplyFormModal isOpen onClose={noop} onSubmit={asyncNoop as any} />,
    );
    expect(overlayStructure(container)).toMatchSnapshot();
  });

  /* [UI-20260828-SCROLLHINT] snapshot ของเคสนี้ถูกอัปเดตโดยตั้งใจ 28/08
     ลูกตัวแรกของ panel เปลี่ยนจาก `FORM` เป็น `DIV` — เป็น wrapper `relative`
     ที่ห่อฟอร์มไว้ให้ลูกศรบอกทางเลื่อนวางแบบ absolute ได้ (`ScrollHint`)
     🔴 สิ่งที่เคสนี้กันไว้จริง ๆ คือ **กล่องยืนยันต้องยังเป็นพี่น้องของ panel
        ไม่ใช่ลูกของมัน** — `overlayChildTags` ยังเท่าเดิมทุกตัว ⇒ สัญญานั้นไม่ถูกแตะ
     ⚠️ ถ้าวันหลัง `overlayChildTags` เปลี่ยน นั่นคือของจริงที่ต้องหยุดตรวจ
        ไม่ใช่ `panelChildTags` ที่เปลี่ยนเพราะเพิ่มชั้นห่อ */
  it('BroadcastFormModal — nested Confirm stays a sibling of the panel', () => {
    const { container } = wrap(
      <BroadcastFormModal isOpen onClose={noop} onSubmit={asyncNoop as any} />,
    );
    expect(overlayStructure(container)).toMatchSnapshot();
  });
});

describe('form-family dialog shell is unchanged by the primitive', () => {
  it('ChangePasswordModal', () => {
    const { container } = wrap(
      <ChangePasswordModal isOpen onClose={noop} onSubmit={asyncNoop as any} />,
    );
    expect(shellOf(container)).toMatchSnapshot();
  });

  it('GroupFormModal — create', () => {
    const { container } = wrap(
      <GroupFormModal isOpen onClose={noop} onSubmit={asyncNoop as any} />,
    );
    expect(shellOf(container)).toMatchSnapshot();
  });

  it('UserFormModal — create', () => {
    const { container } = wrap(
      <UserFormModal isOpen onClose={noop} onSubmit={asyncNoop as any} />,
    );
    expect(shellOf(container)).toMatchSnapshot();
  });

  it('AutoReplyFormModal — create', () => {
    const { container } = wrap(
      <AutoReplyFormModal isOpen onClose={noop} onSubmit={asyncNoop as any} />,
    );
    expect(shellOf(container)).toMatchSnapshot();
  });

  it('BroadcastFormModal — create', () => {
    const { container } = wrap(
      <BroadcastFormModal isOpen onClose={noop} onSubmit={asyncNoop as any} />,
    );
    expect(shellOf(container)).toMatchSnapshot();
  });

  it('closed dialogs render nothing', () => {
    const { container } = wrap(
      <>
        <ChangePasswordModal isOpen={false} onClose={noop} onSubmit={asyncNoop as any} />
        <GroupFormModal isOpen={false} onClose={noop} onSubmit={asyncNoop as any} />
        <UserFormModal isOpen={false} onClose={noop} onSubmit={asyncNoop as any} />
        <AutoReplyFormModal isOpen={false} onClose={noop} onSubmit={asyncNoop as any} />
        <BroadcastFormModal isOpen={false} onClose={noop} onSubmit={asyncNoop as any} />
      </>,
    );
    expect(container.innerHTML).toBe('');
  });
});
