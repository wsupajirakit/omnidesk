/**
 * [FEAT-20260824-BCASTMINT] The mint button — what it must fill in, and what it
 * must warn about first.
 * ===========================================================================
 * Owner 24/08: *"เพิ่มปุ่ม mint for create multicast · mint ใส่ข้อมูล where member
 * follow up [deposit at] จำไม่ได้ ลืมชื่อคีย์"* · *"กดปุ่ม modal เตือน ให้เลือก dep หรือ with
 * แล้วมิ้นค่าให้ในฟอร์ม"* · *"ทำเป็น module … จะมี mint อื่น ๆ อีก ห้ามสร้างหนี้ ต้องเพิ่มง่าย"*.
 *
 * Each case defends a way this feature could be WORSE than typing by hand:
 *
 *  1. A wrong `key` produces a condition the backend drops in silence, and the
 *     campaign then reaches MORE people than the screen shows. So the keys are
 *     pinned against the exact spellings the BE registry declares.
 *  2. A hand-built ISO string would be a second spelling of "what time is
 *     this". The minted value must be the same SHAPE the date box produces.
 *  3. The mint replaces every rule. An action that destroys must warn first —
 *     and must NOT warn when there is nothing to lose.
 *  4. "เพิ่ม mint ใหม่ = แก้ registry ไฟล์เดียว" is a claim about the code, so it is
 *     asserted as one: the UI renders from the table, not from a literal.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';

vi.mock('../services/admin', () => ({
  getInitialPreferences: () => null,
  savePreferences: () => Promise.resolve(),
}));

import {
  MintButton,
  MINTS,
  mintById,
  applyMint,
  rulesForChoices,
} from '../components/campaign/mint';
import { toLocalInput } from '../components/campaign/audience/RuleValueInput';
import { I18nProvider } from '../i18n';
import th from '../i18n/translations/th.json';
import en from '../i18n/translations/en.json';
import zh from '../i18n/translations/zh.json';

const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

const followUp = () => {
  const m = mintById('follow_up_notice');
  if (!m) throw new Error('the follow_up mint is missing from the registry');
  return m;
};

const choice = (id: string) => {
  const c = followUp().choices.find(x => x.id === id);
  if (!c) throw new Error(`no choice ${id}`);
  return c;
};

describe('the registry — the keys must be ones the backend actually knows', () => {
  /**
   * 🔴 THE ONE THAT MATTERS. `audience-source.registry.ts` on the BE declares
   *    these exact strings. A typo here does not error: the rule is stored, the
   *    filter builder finds no source for the key and drops the clause, and the
   *    campaign goes out WIDER than the admin asked. Pinning the spelling is
   *    the only thing standing between a typo and sending to everyone.
   *    สะกดผิด = เงื่อนไขถูกทิ้งเงียบ ๆ แล้วยิงกว้างกว่าที่ตั้งไว้.
   */
  it('pins the two follow-up keys exactly as the BE registry spells them', () => {
    expect(choice('deposit').rule_key).toBe('follow_up.notice_deposit_at');
    expect(choice('withdraw').rule_key).toBe('follow_up.notice_withdraw_at');
  });

  /* [FIX-20260826-MINTHASVALUE] สองเคสล่างนี้ **ถูกพลิก ไม่ได้ถูกลบ**
     เดิมตรึงไว้ว่า mint ต้องใช้ `lte` เพราะตอนนั้น BE ประกาศ `ops: ['lte','gte']`
     ⇒ 25/08 BE เปลี่ยนเป็น `ops: ['has_value']` สำหรับคีย์กลุ่มนี้
       (`[UI-20260825-LOCKHASVALUE]` — stamp เป็น rolling ถูกทับทุกครั้งที่ส่งซ้ำ
        เงื่อนไขอิงเวลาจึงเปลี่ยนความหมายเอง เคยทำผู้รับเหลือ 0 คนมาแล้ว)
     ⇒ เคสยังทำหน้าที่เดิมคือ "operator ต้องเป็นตัวที่ BE ยอมรับ" แค่ตัวที่ยอมรับเปลี่ยนไป */
  it('uses only the operators those keys accept', () => {
    for (const c of followUp().choices) {
      expect(['has_value']).toContain(c.op);
    }
  });

  it('mints "มีค่า" — ไม่ใช่การเทียบเวลาอีกแล้ว', () => {
    expect(choice('deposit').op).toBe('has_value');
    expect(choice('withdraw').op).toBe('has_value');
    expect(choice('customer_helper').op).toBe('has_value');
  });

  it('⭐ ตัวเลือก "เคยได้รับการ์ด" ผูกกับคีย์ที่ BE รู้จัก', () => {
    /* เจ้าของสั่งเพิ่ม 26/08 · ชื่อคีย์ไม่ตรงกับ path ในฐานโดยธรรมชาติของ registry
       (`customer_helper_at` → `config.follow_up.line.customer_helper_trigger_at`)
       ⇒ ต้องส่ง key ให้ BE แปล ห้ามเดา path เอง */
    expect(choice('customer_helper').rule_key).toBe('follow_up.customer_helper_at');
  });

  it('has an i18n key for every label in all three locales', () => {
    const dicts: Record<string, string>[] = [th, en, zh];
    const keys = MINTS.flatMap(m => [
      m.label_key,
      m.title_key,
      ...m.choices.flatMap(c => [c.label_key, c.hint_key]),
    ]);
    for (const k of keys) {
      for (const d of dicts) expect(Object.keys(d)).toContain(k);
    }
  });
});

describe('rulesForChoice — the value is the same shape a typed date is', () => {
  const NOW = new Date('2026-08-24T18:30:00+07:00');

  /* [FIX-20260826-MINTHASVALUE] **พลิกเคส ไม่ลบ** — เดิมพิสูจน์ว่า mint ถอยเวลา
     กลับไปกี่วัน · ตอนนี้ mint กรอก `has_value` ซึ่งไม่มีเวลา ตามที่ BE ล็อกไว้
     (stamp เป็น rolling · เงื่อนไขอิงเวลาเคยทำผู้รับเหลือ 0 คน 25/08)
     ⇒ เคสเปลี่ยนไปกันสิ่งตรงข้าม: **ห้ามมีเวลาโผล่กลับมาใน value** */
  it('ไม่มีค่าเวลาใน rule ที่ mint สร้าง', () => {
    const [rule] = rulesForChoices([choice('deposit')], NOW);
    expect(rule!.op).toBe('has_value');
    expect(rule!.value).toBe('');
  });

  /* [FIX-20260826-MINTHASVALUE] สามเคสเรื่อง "ประตูเวลา" ถูก **พลิก ไม่ลบ**
     เดิมพิสูจน์ว่าค่าที่ mint สร้างมี offset · อ่านกลับเข้ากล่องวันที่ได้ · และ
     เปลี่ยนตามวันที่กด · ทั้งหมดตั้งอยู่บนสมมติฐานว่า mint กรอก "เวลา"
     ตอนนี้ mint กรอก `has_value` ซึ่งไม่มีเวลา ⇒ ประตูนั้นไม่มีอะไรให้ผ่าน
     ⚠️ `docs/TIME-RULE.md` ยังใช้กับค่าที่ **คนกรอกเอง** เหมือนเดิมทุกประการ
        เคสที่เฝ้าประตูนั้นอยู่ที่ `RuleValueInput` ไม่ใช่ที่นี่ — ไม่ได้หายไปไหน
     ⇒ เคสใหม่เฝ้าสิ่งที่ต้องจริงตอนนี้แทน: ค่าต้องคงที่และว่างเสมอ */
  it('ค่าเหมือนกันเสมอ ไม่ว่ากดตอนไหน — เพราะไม่มีเวลาให้ต่างกัน', () => {
    const a = rulesForChoices([choice('deposit')], new Date('2026-08-24T10:00:00+07:00'));
    const b = rulesForChoices([choice('deposit')], new Date('2026-08-25T10:00:00+07:00'));
    expect(a[0]!.value).toBe(b[0]!.value);
    expect(a[0]!.value).toBe('');
  });

  it('ทุก choice ให้ rule ที่ไม่มีเวลาติดมา', () => {
    for (const c of followUp().choices) {
      const [rule] = rulesForChoices([c], NOW);
      expect({ id: c.id, op: rule!.op, value: rule!.value })
        .toEqual({ id: c.id, op: 'has_value', value: '' });
    }
  });
});

describe('applyMint — it REPLACES, and says so', () => {
  it('returns exactly one rule and resets match to and', () => {
    const out = applyMint([choice('deposit')], new Date('2026-08-24T18:30:00+07:00'));
    expect(out.rules).toHaveLength(1);
    expect(out.match).toBe('and');
  });

  /**
   * 🔴 Appending instead of replacing would quietly NARROW the audience: an
   *    `and` with a leftover rule intersects, and the screen would show both as
   *    if that were the intent. เพิ่มต่อท้าย = โดน and ตัดคนออกเงียบ ๆ.
   */
  it('does not carry any previous rule through', () => {
    const out = applyMint([choice('withdraw')]);
    expect(out.rules.map(r => r.key)).toEqual(['follow_up.notice_withdraw_at']);
  });
});

describe('MintButton — the modal, the warning, and the hand-off', () => {
  it('renders one button per registry entry, not a hardcoded list', () => {
    const { getByTestId, getAllByRole } = wrap(
      <MintButton existingRuleCount={0} onMint={() => {}} />,
    );
    expect(getByTestId('mint-buttons')).toBeTruthy();
    for (const m of MINTS) expect(getByTestId(`mint-open-${m.id}`)).toBeTruthy();
    /* One per mint — proof the count follows the table. */
    expect(
      getAllByRole('button').filter(b =>
        (b.getAttribute('data-testid') ?? '').startsWith('mint-open-'),
      ),
    ).toHaveLength(MINTS.length);
  });

  it('opens a modal offering both deposit and withdraw', () => {
    const { getByTestId, queryByTestId } = wrap(
      <MintButton existingRuleCount={0} onMint={() => {}} />,
    );
    expect(queryByTestId('mint-choice-modal')).toBeNull();
    fireEvent.click(getByTestId('mint-open-follow_up_notice'));
    expect(getByTestId('mint-choice-modal')).toBeTruthy();
    expect(getByTestId('mint-choice-deposit')).toBeTruthy();
    expect(getByTestId('mint-choice-withdraw')).toBeTruthy();
  });

  /** 🔴 It destroys work — it has to say so BEFORE, because there is no undo. */
  it('warns, naming the count, when conditions would be lost', () => {
    const { getByTestId } = wrap(
      <MintButton existingRuleCount={3} onMint={() => {}} />,
    );
    fireEvent.click(getByTestId('mint-open-follow_up_notice'));
    const warn = getByTestId('mint-replace-warning');
    expect(warn.textContent).toContain('3');
  });

  /** ⚠️ …and does NOT warn on an empty form. A warning that cries wolf gets clicked through. */
  it('stays quiet when there is nothing to lose', () => {
    const { getByTestId, queryByTestId } = wrap(
      <MintButton existingRuleCount={0} onMint={() => {}} />,
    );
    fireEvent.click(getByTestId('mint-open-follow_up_notice'));
    expect(queryByTestId('mint-replace-warning')).toBeNull();
  });

  it('hands the form a finished {match, rules} and closes', () => {
    const onMint = vi.fn();
    const { getByTestId, queryByTestId } = wrap(
      <MintButton existingRuleCount={2} onMint={onMint} />,
    );
    fireEvent.click(getByTestId('mint-open-follow_up_notice'));
    fireEvent.click(getByTestId('mint-choice-deposit'));
    /* [FIX-20260825-MINTMULTI] ติ๊กแล้วโมดัลยังไม่ปิด — ต้องกด "ตกลง" อีกที
       เพราะเจ้าของสั่งให้เลือกฝาก+ถอนพร้อมกันได้ ⇒ การกดเลือกเป็น toggle ไม่ใช่ยืนยัน */
    fireEvent.click(getByTestId('mint-confirm'));

    expect(onMint).toHaveBeenCalledTimes(1);
    const arg = onMint.mock.calls[0]![0] as {
      match: string;
      rules: { key: string; op: string; value: string }[];
    };
    expect(arg.match).toBe('and');
    expect(arg.rules[0]!.key).toBe('follow_up.notice_deposit_at');
    /* [FIX-20260826-MINTHASVALUE] พลิกตาม registry ที่ย้ายไป `has_value`
       (เดิม `lte` + ค่าที่มี offset) — เหตุผลเต็มอยู่ที่ mint.registry.ts */
    expect(arg.rules[0]!.op).toBe('has_value');
    expect(arg.rules[0]!.value).toBe('');
    expect(queryByTestId('mint-choice-modal')).toBeNull();
  });

  it('cancel closes without minting anything', () => {
    const onMint = vi.fn();
    const { getByTestId, queryByTestId } = wrap(
      <MintButton existingRuleCount={1} onMint={onMint} />,
    );
    fireEvent.click(getByTestId('mint-open-follow_up_notice'));
    fireEvent.click(getByTestId('mint-cancel'));
    expect(onMint).not.toHaveBeenCalled();
    expect(queryByTestId('mint-choice-modal')).toBeNull();
  });

  it('is disabled on a read-only record', () => {
    const { getByTestId } = wrap(
      <MintButton disabled existingRuleCount={0} onMint={() => {}} />,
    );
    expect(
      (getByTestId('mint-open-follow_up_notice') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('🌐 shows words, never a raw i18n key', () => {
    const { getByTestId } = wrap(
      <MintButton existingRuleCount={1} onMint={() => {}} />,
    );
    fireEvent.click(getByTestId('mint-open-follow_up_notice'));
    const modal = getByTestId('mint-choice-modal');
    expect(modal.textContent ?? '').not.toMatch(/broadcast\.mint_/);
    expect(modal.textContent ?? '').not.toMatch(/common\./);
  });
});
