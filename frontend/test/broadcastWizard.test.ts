/* [UI-20260825-WIZARD] ฟอร์มบรอดแคสต์เดินเป็นขั้นตอน
 *
 * เจ้าของ: *"modal boardcast ทุกอย่างทำเป็น step / create / edit / copy ·
 * ไล่จากซ้ายไปขวาจนบันทึก · ย้อนกลับ/ต่อไป ปุ่มใหญ่ชัดเจน"*
 *
 * 🔴 ความเสี่ยงใหญ่ที่สุดของวิซาร์ดคือ **ซ่อนจนหาไม่เจอ** — error ที่อยู่ขั้น 1
 *    ต้องไม่หายไปตอนผู้ใช้ยืนอยู่ขั้น 4 · เคสส่วนใหญ่ที่นี่ปักเรื่องนั้น
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  BROADCAST_STEPS,
  stepErrorCounts,
  firstStepWithError,
  clampStep,
  errorsOnStep,
} from '../components/campaign/form/broadcastSteps';

const modal = readFileSync(
  join(process.cwd(), 'components/campaign/BroadcastFormModal.tsx'),
  'utf8',
);

describe('[WIZARD] §1 ตารางขั้นตอน', () => {
  it('⭐⭐ ลำดับขั้น = ลำดับการอ่านเดิมของฟอร์ม (ซ้าย→ขวา)', () => {
    expect(BROADCAST_STEPS.map((s) => s.id)).toEqual([
      'section-basic',
      'section-message',
      'section-group',
      'section-oa',
      'section-target',
      'section-send',
    ]);
  });

  it('⭐⭐ ทุกขั้นผูกกับการ์ดจริงบนจอด้วย testId เดียวกัน', () => {
    /* `id` คือกาวเส้นเดียวที่ผูก "ขั้นที่ n" เข้ากับ `<FormSection>` ใบนั้น
       พิมพ์ไม่ตรง = ขั้นนั้นไม่มีอะไรแสดงเลย และไม่มี error ให้เห็นด้วย */
    for (const s of BROADCAST_STEPS) {
      expect(modal, `${s.id} ต้องมีการ์ดจริง`).toContain(`testId="${s.id}"`);
    }
  });

  it('⭐ ไม่มีขั้นซ้ำ และไม่มีช่องถูกจองสองขั้น', () => {
    const ids = BROADCAST_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const fields = BROADCAST_STEPS.flatMap((s) => [...s.fields]);
    expect(new Set(fields).size).toBe(fields.length);
  });
});

describe('[WIZARD] §2 error ต้องไม่หายไปกับขั้นที่ถูกซ่อน', () => {
  it('⭐⭐ นับ error เข้าขั้นที่ถูกต้อง', () => {
    expect(stepErrorCounts({ name: 'x' })[0]).toBe(1);
    expect(stepErrorCounts({ name: 'x' })[1]).toBe(0);
    expect(errorsOnStep('section-basic', { name: 'x', description: 'y' })).toBe(2);
  });

  it('⭐⭐ กดเซฟพลาด → ชี้ไปขั้น **แรก** ที่ผิด ไม่ใช่ขั้นใกล้สุด', () => {
    /* ผู้ใช้ควรถูกพากลับไปจุดเริ่มของปัญหา แล้วไล่ลงมาตามลำดับเดิม */
    expect(firstStepWithError({ target: 'x', name: 'y' })).toBe(0);
    expect(firstStepWithError({ target: 'x' })).toBe(4);
  });

  it('⭐ ไม่มี error = -1', () => {
    expect(firstStepWithError({})).toBe(-1);
  });

  it('⭐ เลขขั้นไม่หลุดขอบ', () => {
    expect(clampStep(-5)).toBe(0);
    expect(clampStep(99)).toBe(BROADCAST_STEPS.length - 1);
  });
});

describe('[WIZARD] §3 ต่อสายจริงใน modal', () => {
  it('⭐⭐ ฟอร์มใช้แถบขั้นตอนและปุ่มเดินขั้น', () => {
    expect(modal).toContain('<BroadcastStepRail');
    expect(modal).toContain('<BroadcastStepNav');
  });

  it('⭐⭐ ทุกการ์ดถูกห่อด้วย StepPane — ไม่มีใบไหนหลุดออกนอกวิซาร์ด', () => {
    for (const s of BROADCAST_STEPS) {
      const at = modal.indexOf(`stepId="${s.id}"`);
      expect(at, `${s.id} ต้องถูกห่อ`).toBeGreaterThan(-1);
    }
    expect((modal.match(/<BroadcastStepPane/g) ?? []).length).toBe(BROADCAST_STEPS.length);
  });

  it('⭐⭐ ช่องกรอกยัง MOUNT อยู่ทุกขั้น — ซ่อน ไม่ใช่ถอดทิ้ง', () => {
    /* 🔴 ถ้าถอด mount ค่าที่พิมพ์ไว้จะหายตอนเดินออกจากขั้นนั้น ซึ่งเป็นผลลัพธ์
       ที่แย่ที่สุดของงานนี้ · StepPane ต้องไม่ทำ conditional render */
    const pane = readFileSync(
      join(process.cwd(), 'components/campaign/form/BroadcastStepper.tsx'),
      'utf8',
    );
    const at = pane.indexOf('BroadcastStepPane: React.FC');
    const body = pane.slice(at, pane.indexOf('export', at + 10));
    expect(body).toContain('{children}');
    expect(body, 'ห้าม early-return null — นั่นคือการถอด mount').not.toMatch(
      /if\s*\(\s*!visible\s*\)\s*return\s+null/,
    );
  });

  it('⭐⭐ กดเซฟพลาดแล้วเด้งไปขั้นที่ผิดจริง', () => {
    /* ⚠️ ปักสิ่งที่เจาะจง ไม่ใช่ "หา setStepIndex ข้างหน้า" — รอบแรกเขียนแบบนั้น
       แล้ว mutation ที่ลบบรรทัดเด้งทิ้ง **ไม่แดง** เพราะไปเจอ `setStepIndex`
       ของ `onPick` ในแถบขั้นตอนที่อยู่ถัดไปแทน
       (บทเรียนเดิมของวันนี้: ค้นหาข้ามขอบ = ไม่ได้ปักอะไร) */
    expect(modal).toContain('firstStepWithError(nextErrors)');
    expect(
      modal,
      'ต้องเด้งไปขั้นที่ firstStepWithError บอก',
    ).toContain('setStepIndex(clampStep(bad))');
  });

  it('⭐⭐ ชั้นยืนยันสองชั้นยังอยู่ — วิซาร์ดต้องไม่ข้ามมันไป', () => {
    expect(modal).toContain('setIsConfirmOpen(true)');
    expect(modal).toContain('const confirmSubmit');
  });
});

describe('[WIZARD] every section counts its errors through ONE source', () => {
  /* Why this is pinned rather than trusted: the rail, the jump-to-first-error
     and each card's badge must agree, and they only agree while all three read
     `BROADCAST_STEPS.fields`. A card that counts its own errors inline drifts
     silently — `errorCount={errors.group ? 1 : 0}` sat in the group card while
     `validate()` only ever set `assign_group`, so that badge could not light up
     no matter what an admin typed. Nothing failed; the number was just wrong.
     ⇒ the rule is: no card reaches into `errors` for a count. */
  it('⭐⭐ no section counts errors by hand — all of them go through errorsIn', () => {
    const inline = modal.match(/errorCount=\{errors\./g) ?? [];
    expect(
      { handRolledErrorCounts: inline.length },
      'errorCount ต้องมาจาก errorsIn เท่านั้น ไม่งั้นป้ายกับ rail จะไม่ตรงกัน',
    ).toEqual({ handRolledErrorCounts: 0 });
  });

  it('⭐ and every step id in BROADCAST_STEPS is actually rendered as a pane', () => {
    /* A step the rail can select but no pane answers to is a dead page: next/back
       walks onto a blank screen. */
    for (const s of BROADCAST_STEPS) {
      expect(modal, `ขั้น ${s.id} ต้องมี BroadcastStepPane จริง`)
        .toContain(`<BroadcastStepPane stepId="${s.id}"`);
    }
  });

  it('⭐ the group card is reachable through the field validate really sets', () => {
    // the defect in one line: 'group' is not a key validate ever writes
    expect(firstStepWithError({ assign_group: 'x' })).toBe(
      BROADCAST_STEPS.findIndex(s => s.id === 'section-group'),
    );
  });
});
