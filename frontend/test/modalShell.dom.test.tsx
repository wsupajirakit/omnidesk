/* [FE] Modal shell — characterization test for [FEAT-20260810-MODALSHELL].
 *
 * This is NOT a feature test. Its only job is to freeze the rendered DOM of the
 * dialogs BEFORE they adopt `components/common/Modal.tsx`, so the adoption can be
 * proven to have changed nothing. The snapshot is written from the hand-rolled
 * markup and must survive the refactor byte-for-byte — a diff here means the
 * primitive restyled a dialog instead of merely hosting it.
 *
 * Class strings are asserted verbatim on purpose: Tailwind carries the entire
 * visual result in the class attribute, so an HTML snapshot IS the visual diff.
 * เทสนี้ล็อก DOM ก่อน refactor — ถ้า snapshot ขยับ แปลว่า refactor เปลี่ยนหน้าตาจริง
 *
 * revert: delete this file together with the primitive.
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
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

import { BulkStatusModal, BulkPermissionsModal, BulkTagScopeModal } from '../components/bulk';
import { Modal } from '../components/common/Modal';
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

/* The primitive is tested directly as well as through its callers. Reason: every
 * adopting dialog still keeps its own `if (!isOpen) return null` ahead of the
 * return, so the primitive's own guard is never reached from those tests — a
 * mutation that deleted it survived the suite until these cases were added.
 * เทสผ่าน caller อย่างเดียวไม่พอ — guard ของ primitive ไม่เคยถูกวิ่งถึง */
describe('Modal primitive — its own contract', () => {
  it('renders nothing while closed', () => {
    const { container } = render(
      <Modal isOpen={false}>
        <Modal.Body>should not appear</Modal.Body>
      </Modal>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the shell while open, and the caller can replace every class string', () => {
    const { container } = render(
      <Modal isOpen overlayClassName="my-overlay" panelClassName="my-panel">
        <Modal.Header title="T" onClose={noop} />
        <Modal.Body className="my-body">body</Modal.Body>
        <Modal.Footer className="my-footer">footer</Modal.Footer>
      </Modal>,
    );
    // Verbatim pass-through is the whole safety property: a dialog whose chrome
    // differs keeps its own strings instead of being restyled by the default.
    expect(container.querySelector('.my-overlay')).not.toBeNull();
    expect(container.querySelector('.my-panel')).not.toBeNull();
    expect(container.querySelector('.my-body')?.className).toBe('my-body');
    expect(container.querySelector('.my-footer')?.className).toBe(
      'px-5 py-4 border-t border-slate-200 dark:border-slate-700 my-footer',
    );
  });

  it('hideClose drops the X button rather than rendering a dead one', () => {
    const { container } = render(
      <Modal isOpen>
        <Modal.Header title="T" onClose={noop} hideClose />
      </Modal>,
    );
    expect(container.querySelector('button')).toBeNull();
  });
});

describe('modal shell DOM is unchanged by the primitive', () => {
  it('BulkStatusModal — closed renders nothing', () => {
    const { container } = wrap(
      <BulkStatusModal
        isOpen={false}
        onClose={noop}
        usernames={['alice']}
        choice={null}
        onChoice={noop}
        confirming={false}
        onConfirmStep={noop}
        onSubmit={noop}
        saving={false}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('BulkStatusModal — step 1, nothing chosen', () => {
    const { container } = wrap(
      <BulkStatusModal
        isOpen
        onClose={noop}
        usernames={['alice', 'bob']}
        choice={null}
        onChoice={noop}
        confirming={false}
        onConfirmStep={noop}
        onSubmit={noop}
        saving={false}
      />,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('BulkStatusModal — disabling chosen, confirming, saving (warning + spinner branch)', () => {
    const { container } = wrap(
      <BulkStatusModal
        isOpen
        onClose={noop}
        usernames={['alice', 'bob']}
        choice={false}
        onChoice={noop}
        confirming
        onConfirmStep={noop}
        onSubmit={noop}
        saving
      />,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('BulkPermissionsModal — open with a selection', () => {
    const { container } = wrap(
      <BulkPermissionsModal
        isOpen
        onClose={noop}
        usernames={['alice']}
        value={['hook.manage']}
        onChange={noop}
        available={['hook.manage', 'slip.manage', 'dashboard.stats.view']}
        onConfirm={noop}
        saving={false}
      />,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('BulkTagScopeModal — open with groups and hooks', () => {
    const { container } = wrap(
      <BulkTagScopeModal
        isOpen
        onClose={noop}
        tagNames={['tag-a', 'tag-b']}
        groups={[{ id: 'g1', name: 'Group A' }] as any}
        hooks={[{ id: 'h1', name: 'OA One' }] as any}
        groupIds={['g1']}
        hookIds={[]}
        onChangeGroups={noop}
        onChangeHooks={noop}
        onConfirm={noop}
        saving={false}
      />,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });
});
