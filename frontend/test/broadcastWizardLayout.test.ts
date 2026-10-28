/* [UI-20260825-WIZARDWIDE] + [FEAT-20260825-BCASTCONFIRM2] Two rules about the
 * broadcast form that nothing was guarding, and that both got reported by the
 * owner rather than by a test.
 * ===========================================================================
 * 1. The wizard must use the whole modal. The six-card form was laid out as
 *    two columns (2fr left, 1fr right) back when all six were on screen at
 *    once. Walking one card at a time left cards 3-6 rendering inside the 1/3
 *    column with half the dialog empty — *"ตำแหน่งมั่ว … พื้นที่กว้างเยอะ"*.
 *    The instruction came with a hard boundary: *"ห้ามกระทบกับโหมดแสดงทุกขั้นตอน"*,
 *    so the show-all classes are pinned character for character.
 *
 * 2. Saving asks twice, in create and in edit alike. That was asked for on
 *    24/08 and shipped, and then a whole wizard was built around the submit
 *    path with nothing checking the confirm survived. It did — but only by
 *    luck, and this file is what turns that into a measurement.
 *
 * ⚠️ SOURCE PINS. Both rules live in JSX inside a 1,500-line component that
 * needs a live modal, four services and an i18n provider to render. Comments
 * are stripped first, because the prose in that file names the very class
 * strings being asserted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BROADCAST_STEPS,
  firstStepWithError,
  errorsOnStep,
} from '../components/campaign/form/broadcastSteps';

const modal = readFileSync(
  join(process.cwd(), 'components/campaign/BroadcastFormModal.tsx'),
  'utf8',
)
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('[WIZARDWIDE] one step at a time uses the whole dialog', () => {
  it('⭐⭐ (T1) the container is only a 3-column grid when every step is shown', () => {
    expect(
      modal,
      'วิซาร์ดต้องไม่ใช้ grid 3 คอลัมน์ ไม่งั้นการ์ดจะไปกองในคอลัมน์แคบ',
    ).toContain(
      "showAllSteps ? 'grid grid-cols-1 lg:grid-cols-3 gap-6' : 'flex flex-col gap-6'",
    );
  });

  it('⭐⭐ (T2) both column wrappers step out of the way in wizard mode', () => {
    /* `contents` is the whole trick: the wrapper stops being a box, so the one
       visible pane becomes a direct child of the full-width container. Without
       BOTH, whichever half still has a wrapper keeps its old width. */
    expect(modal).toContain(
      "showAllSteps ? 'lg:col-span-2 flex flex-col gap-6' : 'contents'",
    );
    expect(modal).toContain("showAllSteps ? 'flex flex-col gap-6' : 'contents'");
  });

  it('⭐ (T3) the 10% shrink is lifted when there is room for it', () => {
    // "ถ้าเหลือเยอะก็ขยาย font + element ให้พอดี"
    expect(modal).toContain('zoom: showAllSteps ? 0.9 : 1');
  });

  it('⭐⭐ (P1 PIN) show-all keeps its exact classes — the owner said ห้ามกระทบ', () => {
    expect(modal).toContain('grid grid-cols-1 lg:grid-cols-3 gap-6');
    expect(modal).toContain('lg:col-span-2 flex flex-col gap-6');
  });

  it('⭐ (P2 PIN) panes are still hidden, never unmounted', () => {
    /* The reason the wizard can be walked without losing what was typed. If a
       pane is ever rendered conditionally instead, this file's premise and the
       recipient-condition builder both break. */
    const panes = modal.match(/<BroadcastStepPane\b/g) ?? [];
    expect({ panes: panes.length }).toEqual({ panes: 6 });
    expect(modal).not.toMatch(/\{\s*stepIndex === \d+\s*&&\s*<BroadcastStepPane/);
  });
});

describe('[BCASTCONFIRM2] saving asks twice, in every mode', () => {
  it('⭐⭐ (T4) a valid submit opens the confirm — it does NOT save straight away', () => {
    expect(modal, 'ต้องเปิดกล่องยืนยันก่อน ไม่ใช่ยิง onSubmit ทันที').toContain(
      'setIsConfirmOpen(true)',
    );
  });

  it('⭐⭐ (T5) the save itself lives behind the confirm, not in the submit handler', () => {
    /* `onSubmit` must be reachable only from `confirmSubmit`. If it is ever
       called from the submit handler as well, one of the two paths saves
       without asking — and that is the bug this rule exists to prevent. */
    const calls = modal.match(/await onSubmit\(/g) ?? [];
    expect({ onSubmitCallSites: calls.length }).toEqual({ onSubmitCallSites: 1 });
    const confirmBody = modal.slice(
      modal.indexOf('const confirmSubmit'),
      modal.indexOf('const confirmSubmit') + 400,
    );
    expect(confirmBody).toContain('await onSubmit(');
  });

  it('⭐ (T6) create and edit get their own confirm wording — one dialog, both modes', () => {
    expect(modal).toContain("resolvedMode === 'update'");
    expect(modal).toContain('broadcast.confirm_update_title');
    expect(modal).toContain('broadcast.confirm_create_title');
  });

  it('⭐ (P3 PIN) the header save posts the same form, so it goes through the same confirm', () => {
    expect(modal).toContain('form="broadcast-form"');
    expect(modal).toContain('name="header_confirm"');
  });
});

describe('[SENDCONSENT] the gate is in the save path, not on the button', () => {
  /* เจ้าของสั่งว่า *"ถ้าพยายามกดโดยไม่ check box เด้ง check box แดง ๆ"* ⇒ ปุ่มต้อง
     กดได้ · ถ้าไป `disabled` ปุ่มแทน คนที่กดจะไม่ได้อะไรกลับมาเลย ซึ่งอ่านว่า
     ระบบค้าง ไม่ใช่ว่ายังไม่ได้ติ๊ก */
  it('⭐⭐ (T7) an unticked confirm returns before saving, and turns the box red', () => {
    expect(modal).toContain('if (!consentChecked)');
    expect(modal).toContain('setConsentMissing(true)');
    const gate = modal.slice(modal.indexOf('const confirmSubmit'));
    expect(
      gate.indexOf('setConsentMissing(true)'),
      'ประตูต้องอยู่ก่อน onSubmit ไม่ใช่หลัง',
    ).toBeLessThan(gate.indexOf('await onSubmit('));
  });

  it('⭐⭐ (T8) the confirm dialog must not close itself on confirm', () => {
    /* ค่าปริยายคือปิด ⇒ คนที่ยังไม่ติ๊กจะเห็นกล่องหายไปเฉย ๆ แล้วงานไม่ถูกบันทึก */
    expect(modal).toContain('closeOnConfirm={false}');
  });

  it('⭐ (T9) the tick resets every time the dialog opens', () => {
    // การยืนยันของครั้งก่อนต้องไม่นับให้ครั้งนี้
    const open = modal.slice(modal.indexOf('setShowErrorSummary(false);'));
    expect(open.slice(0, 200)).toContain('setConsentChecked(false)');
  });
});

describe('[BCASTSKIPASSIST] the new tick reaches the payload', () => {
  it('⭐⭐ (T10) it has a default, a hydrate and an input — all three', () => {
    /* สามจุดนี้คือชุดที่ field ใหม่หายเงียบทุกครั้งที่ตกไปหนึ่งจุด */
    expect(modal).toContain('skip_assist: false,');
    expect(modal).toContain('skip_assist?: boolean }).skip_assist === true');
    expect(modal).toContain('data-testid="broadcast-skip-assist"');
  });

  it('⭐⭐ (T11) the payload spreads formData, so the new field rides along', () => {
    const build = modal.slice(modal.indexOf('const buildPayload'), modal.indexOf('const confirmSubmit'));
    expect(build, 'ถ้าเลิก spread เมื่อไหร่ ต้องมาเพิ่ม skip_assist เองที่นี่').toContain('...formData,');
  });
});

describe('[PICKSENDMODE] วิธีส่งต้องเลือกเอง ไม่มีติ๊กมาให้', () => {
  /* เจ้าของ 25/08: *"create/edit ก็ตาม เราจะไม่ติ๊กการส่งให้ ให้ติ๊กเอง ถ้า submit
     โดยไม่ติ๊กก็ validate เด้งมาที่ step นี้ แล้วบอกแดงตรงไหน"* */
  it('⭐⭐ (T12) ฟอร์มเปล่าเปิดมาโดยยังไม่ได้เลือกวิธีส่ง', () => {
    expect(modal, "ค่าเริ่มต้นต้องว่าง ไม่ใช่ 'draft'").toContain("status: '',");
    /* ⚠️ จำกัดขอบเขตที่ก้อนค่าเริ่มต้นเท่านั้น — `status: 'draft'` ยังต้องมีอยู่ใน
       `handleScheduleMode('draft')` เพราะนั่นคือตอนที่ผู้ใช้ **กดเลือก**
       ฉบับร่างเอง ซึ่งเป็นคนละเรื่องกับการติ๊กมาให้ล่วงหน้า */
    const defaults = modal.slice(modal.indexOf('DEFAULT_FORM'), modal.indexOf('DEFAULT_FORM') + 1200);
    expect(defaults).not.toContain("status: 'draft'");
  });

  it('⭐⭐ (T13) โหมดแก้ไขแสดงค่าที่บันทึกไว้ แต่ไม่เติมค่าเริ่มต้นให้', () => {
    expect(modal).toContain("status: initialData.status || '',");
  });

  it('⭐⭐⭐ (T14) ไม่เลือก = validate ไม่ผ่าน', () => {
    expect(modal).toContain('if (!formData.status)');
    expect(modal).toContain("nextErrors.status = t('broadcast.form_status_required')");
  });

  it('⭐⭐⭐ (T15) `status` อยู่ในขั้น "สถานะการส่ง" ⇒ เด้งไปยืนที่ขั้นนั้นจริง', () => {
    /* ตกบรรทัดนี้ = แถบสรุปบอกว่าผิด แต่วิซาร์ดพาไปยืนผิดขั้น หรือไม่พาไปเลย */
    const send = BROADCAST_STEPS.find(s => s.id === 'section-send');
    expect(send?.fields).toContain('status');
    expect(firstStepWithError({ status: 'x' })).toBe(
      BROADCAST_STEPS.findIndex(s => s.id === 'section-send'),
    );
  });

  it('⭐⭐ (T16) มีที่แสดงว่า "แดงตรงไหน" ในขั้นนั้น', () => {
    expect(modal).toContain('data-testid="send-status-error"');
    expect(modal).toContain('{errors.status}');
  });

  it('⭐ (T17) ป้ายจำนวน error ของการ์ดนี้นับ status ด้วย (ผ่าน errorsIn ตัวเดิม)', () => {
    expect(errorsOnStep('section-send', { status: 'x' })).toBe(1);
    expect(errorsOnStep('section-send', { status: 'x', scheduled_at: 'y' })).toBe(2);
  });
});
