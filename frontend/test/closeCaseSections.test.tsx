import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import {
  CloseCaseSections,
  closeCaseTopicsFor,
  missingTopics,
} from '../components/member/follow-up/CloseCaseSections';
import type { ChatRoom } from '../services/chat/chatService';

/**
 * [FEAT-20260827-PATCHAFTERCLOSE] กล่องยืนยันปิดเคสแบบแบ่ง section
 * ===========================================================================
 * ⭐ ประโยคที่เจ้าของย้ำสองรอบ 27/08 และเป็นเหตุผลที่ไฟล์นี้เรียงเคสแบบนี้:
 *    *"ข้อสองต้องไม่กระทบ กรณีไม่มีให้ติ๊ก = ปิดเคสปกติ"*
 * ⇒ เคส "ไม่ขึ้น / ไม่ทำอะไร" มาก่อน และมีมากกว่าเคสที่ทำงานจริง
 *    ของใหม่ที่ทำให้ของเดิมพัง ไม่ใช่ของใหม่ที่ใช้ได้
 */

const room = (line: Record<string, unknown> | null): ChatRoom =>
  ({
    _id: 'r1',
    user_data: line === null ? {} : { config: { follow_up: { line } } },
  }) as unknown as ChatRoom;

const D = '2026-08-20T03:00:00.000Z';
const BOTH_REG = { abandon_trigger_at: D, request_reg_at: D };

describe('[PATCHAFTERCLOSE] หัวข้อไหนขึ้นบ้าง', () => {
  it('🔴 ไม่มี stamp เลย ⇒ ไม่มีหัวข้อ (ปิดเคสปกติ)', () => {
    expect(closeCaseTopicsFor(room(null), 2)).toEqual([]);
    expect(closeCaseTopicsFor(room({}), 2)).toEqual([]);
  });

  it('🔴 ไม่ใช่การปิดเคส (รับเคส = 1) ⇒ ไม่มีหัวข้อ แม้ stamp ครบ', () => {
    expect(
      closeCaseTopicsFor(
        room({ ...BOTH_REG, notice_deposit_at: D, notice_withdraw_at: D }),
        1,
      ),
    ).toEqual([]);
  });

  /* [FEAT-20260904-REGANYSTAMP] เดิมเคสนี้ปักว่า "ใบเดียวไม่ขึ้น" ซึ่งเป็นกฎ pair
     เก่า · เจ้าของสั่งเปลี่ยน 04/09 เพราะ `request_reg_at` เขียนเฉพาะคนที่ตอบกลับจริง
     ⇒ คนที่โดนตามแล้วเงียบมีแค่ `abandon_trigger_at` ใบเดียว แล้วหัวข้อไม่เคยขึ้นให้เลย
     เขียนใหม่เป็น "ใบเดียวก็ขึ้น" ครบทั้งสามคีย์ */
  it('🔴 stamp ลงทะเบียนใบเดียวก็ขึ้น — ครบทั้งสามคีย์', () => {
    expect(closeCaseTopicsFor(room({ abandon_trigger_at: D }), 2)).toEqual([
      'registration',
    ]);
    expect(closeCaseTopicsFor(room({ request_reg_at: D }), 2)).toEqual([
      'registration',
    ]);
    expect(
      closeCaseTopicsFor(room({ customer_helper_trigger_at: D }), 2),
    ).toEqual(['registration']);
  });

  it('🔴 มีโปรไฟล์แล้ว ⇒ หัวข้อลงทะเบียนห้ามขึ้นเด็ดขาด แม้ stamp ครบทุกใบ', () => {
    /* เส้นตายที่เจ้าของย้ำ 04/09: *"ถ้ามี profile ห้ามมีตัวเลือกเคลียร์ติดตามเด็ดขาด"*
       คีย์ทั้งสามอยู่รอดหลังสมัคร (สองใบเป็น RECORD) ⇒ ถ้าไม่กันตรงนี้ คนที่สมัคร
       ไปแล้วนานจะโดนเสนอให้ "หยุดตาม" และการกดจะลบประวัติที่สร้างคืนไม่ได้ */
    const withProfile = {
      _id: 'r1',
      user_data: {
        raw_profile_data: { phone: '0900000000' },
        config: {
          follow_up: {
            line: {
              abandon_trigger_at: D,
              request_reg_at: D,
              customer_helper_trigger_at: D,
            },
          },
        },
      },
    } as unknown as ChatRoom;
    expect(closeCaseTopicsFor(withProfile, 2)).toEqual([]);
  });

  it('🔴 ไม่มี stamp ลงทะเบียนเลย ⇒ ยังไม่ขึ้น (ขอบเขตเดิมที่ต้องอยู่)', () => {
    /* "ใบใดใบหนึ่ง" ไม่ใช่ "ไม่มีเลยก็ได้" — มีแต่ notice ต้องไม่ทำให้หัวข้อ
       ลงทะเบียนโผล่ */
    expect(closeCaseTopicsFor(room({ notice_deposit_at: D }), 2)).toEqual([
      'deposit',
    ]);
  });

  it('⭐ แต่ละหัวข้อขึ้นอิสระจากกัน', () => {
    expect(closeCaseTopicsFor(room({ notice_deposit_at: D }), 2)).toEqual([
      'deposit',
    ]);
    expect(closeCaseTopicsFor(room({ notice_withdraw_at: D }), 2)).toEqual([
      'withdraw',
    ]);
    expect(closeCaseTopicsFor(room(BOTH_REG), 2)).toEqual(['registration']);
  });

  it('⭐ มีครบทุกอย่าง ⇒ ขึ้นทั้งสามหัวข้อ เรียงคงที่', () => {
    expect(
      closeCaseTopicsFor(
        room({ ...BOTH_REG, notice_deposit_at: D, notice_withdraw_at: D }),
        2,
      ),
    ).toEqual(['registration', 'deposit', 'withdraw']);
  });

  it('🔴 stamp ที่เป็น null/ว่าง นับว่าไม่มี', () => {
    /* [FEAT-20260904-REGANYSTAMP] fixture ต้องเปลี่ยนเพื่อให้ยัง **วัดสิ่งเดิม** ได้
       ของเดิมใส่ `abandon_trigger_at: D` (มีค่าจริง) ไว้ด้วย ⇒ ตอนกฎเป็น pair มัน
       ตกเพราะ "ไม่ครบคู่" ไม่ใช่เพราะค่าว่าง · พอกฎเป็น "ใบใดใบหนึ่ง" ใบที่มีค่าจริง
       จะทำให้หัวข้อขึ้นทันที เคสนี้จึงต้องให้ **ทุกคีย์เป็นค่าว่าง** ถึงจะพิสูจน์เรื่อง
       ค่าว่างได้จริง ⇒ เทสที่ผ่านด้วยเหตุผลอื่น = ไม่ได้วัดอะไรเลย */
    expect(
      closeCaseTopicsFor(
        room({
          abandon_trigger_at: '',
          request_reg_at: null,
          customer_helper_trigger_at: '',
          notice_deposit_at: '',
        }),
        2,
      ),
    ).toEqual([]);
  });
});

describe('[PATCHAFTERCLOSE] บังคับตอบเฉพาะหัวข้อที่ขึ้น', () => {
  it('🔴 ไม่มีหัวข้อ ⇒ ไม่มีอะไรค้าง ⇒ กดยืนยันได้ทันที', () => {
    expect(missingTopics([], {})).toEqual([]);
  });

  it('⭐ ตอบครบเฉพาะหัวข้อที่ขึ้น = ผ่าน (คำตอบส่วนเกินไม่นับ)', () => {
    expect(missingTopics(['deposit'], { deposit: 'follow' })).toEqual([]);
    // withdraw ไม่ได้ขึ้น จึงไม่ถูกเรียกร้อง แม้จะไม่มีคำตอบ
    expect(missingTopics(['deposit'], { deposit: 'unfollow' })).toEqual([]);
  });

  it('⭐ ตอบไม่ครบ = คืนเฉพาะหัวข้อที่ค้าง', () => {
    expect(
      missingTopics(['registration', 'deposit', 'withdraw'], {
        registration: 'stop',
      }),
    ).toEqual(['deposit', 'withdraw']);
  });
});

describe('[PATCHAFTERCLOSE] การเรนเดอร์', () => {
  it('🔴 ไม่มีหัวข้อ ⇒ ไม่เรนเดอร์อะไรเลย (DOM กล่องยืนยันเท่าเดิม)', () => {
    const { container } = render(
      <CloseCaseSections topics={[]} answers={{}} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('⭐ ขึ้นเฉพาะหัวข้อที่ส่งมา — หัวข้ออื่นไม่มีใน DOM', () => {
    render(
      <CloseCaseSections
        topics={['deposit']}
        answers={{}}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('close-case-topic-deposit')).toBeTruthy();
    expect(screen.queryByTestId('close-case-topic-withdraw')).toBeNull();
    expect(screen.queryByTestId('close-case-topic-registration')).toBeNull();
  });

  it('⭐ ฝากกับถอนอยู่ใต้หัว section เดียวกัน ไม่ซ้ำหัว', () => {
    render(
      <CloseCaseSections
        topics={['deposit', 'withdraw']}
        answers={{}}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getAllByText('การติดตามฝากถอน')).toHaveLength(1);
  });

  it('⭐ แต่ละ step โชว์ชื่อ section ของหัวข้อนั้น', () => {
    /* [FEAT-20260830-CLOSEWIZARD] เดิมเรนเดอร์ทุกหัวข้อพร้อมกันจึงเห็นสอง section
       ในจอเดียว · ตอนนี้เดินทีละ step — เจตนาที่เคสนี้กัน (แต่ละหัวข้ออยู่ใต้
       ชื่อ section ที่ถูกต้อง ไม่สลับกัน) ยังจริงและวัดทีละ step */
    const a = render(
      <CloseCaseSections topics={['registration', 'deposit']} answers={{}} onChange={vi.fn()} stepIndex={0} />,
    );
    expect(screen.getByText('การติดตามลงทะเบียน')).toBeTruthy();
    expect(screen.queryByText('การติดตามฝากถอน')).toBeNull();
    a.unmount();
    render(
      <CloseCaseSections topics={['registration', 'deposit']} answers={{}} onChange={vi.fn()} stepIndex={1} />,
    );
    expect(screen.getByText('การติดตามฝากถอน')).toBeTruthy();
    expect(screen.queryByText('การติดตามลงทะเบียน')).toBeNull();
  });

  it('⭐ คลิกแล้วรายงานหัวข้อ+ค่าที่เลือกกลับไป', () => {
    const onChange = vi.fn();
    render(
      <CloseCaseSections
        topics={['registration', 'withdraw']}
        answers={{}}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId('close-case-registration-stop'));
    expect(onChange).toHaveBeenCalledWith('registration', 'stop');
    cleanup();
    // [FEAT-20260830-CLOSEWIZARD] the second topic is reached at its own step
    render(
      <CloseCaseSections
        topics={['registration', 'withdraw']}
        answers={{}}
        onChange={onChange}
        stepIndex={1}
      />,
    );
    fireEvent.click(screen.getByTestId('close-case-withdraw-unfollow'));
    expect(onChange).toHaveBeenCalledWith('withdraw', 'unfollow');
  });

  it('⭐ เป็น radiogroup ไม่ใช่ checkbox — ติ๊กพร้อมกันไม่ได้', () => {
    render(
      <CloseCaseSections
        topics={['deposit']}
        answers={{ deposit: 'follow' }}
        onChange={vi.fn()}
      />,
    );
    const group = screen.getByTestId('close-case-topic-deposit');
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(
      screen.getByTestId('close-case-deposit-follow').getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen
        .getByTestId('close-case-deposit-unfollow')
        .getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('⭐ เตือนเฉพาะหัวข้อที่ยังไม่ตอบ ไม่เตือนหัวข้อที่ตอบแล้ว', () => {
    /* [FEAT-20260830-CLOSEWIZARD] วัดทีละ step: step ที่ตอบแล้วต้องไม่เตือน
       step ที่ยังไม่ตอบต้องเตือน — กฎเดิมเป๊ะ แค่ทีละจอ */
    const answered = render(
      <CloseCaseSections
        topics={['deposit', 'withdraw']}
        answers={{ deposit: 'follow' }}
        onChange={vi.fn()}
        showMissing
        stepIndex={0}
      />,
    );
    expect(screen.queryByText('กรุณาเลือกหนึ่งตัวเลือก')).toBeNull();
    answered.unmount();
    render(
      <CloseCaseSections
        topics={['deposit', 'withdraw']}
        answers={{ deposit: 'follow' }}
        onChange={vi.fn()}
        showMissing
        stepIndex={1}
      />,
    );
    expect(screen.getAllByText('กรุณาเลือกหนึ่งตัวเลือก')).toHaveLength(1);
  });
});
