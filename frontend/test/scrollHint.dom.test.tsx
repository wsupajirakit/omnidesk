/**
 * [UI-20260828-SCROLLHINT] ลูกศรบอกว่ายังเลื่อนต่อได้
 * ===========================================================================
 * เจ้าของ 28/08: *"ถ้ามัน scroll ได้ต้องมี guide arrow เด้งบอกว่าเลื่อนลง + ขึ้นด้วย
 * ถ้ามีพื้นที่ให้ไปทางนั้น"*
 *
 * 🔴 กฎที่สำคัญที่สุดคือ **โชว์เฉพาะทางที่ไปได้จริง** · ลูกศรลงตอนอยู่ล่างสุดแล้ว
 *    คือสัญญาณที่โกหก และพอโกหกครั้งเดียว ครั้งต่อไปผู้ใช้ก็จะไม่เชื่อมันอีก
 *    ⇒ เคสในไฟล์นี้จึงวัด "ทิศที่โชว์" ไม่ใช่แค่ "มีลูกศรไหม"
 */
import { describe, it, expect } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React, { useRef } from 'react';

import { ScrollHint } from '../components/common/ScrollHint';
import { I18nProvider } from '../i18n';

/** jsdom ไม่คำนวณ layout ⇒ ต้องป้อนค่าความสูงเอง */
const setMetrics = (el: HTMLElement, scrollHeight: number, clientHeight: number, scrollTop = 0) => {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
};

const Host: React.FC<{ scrollHeight: number; clientHeight: number; scrollTop: number }> = (p) => {
  const ref = useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    if (ref.current) setMetrics(ref.current, p.scrollHeight, p.clientHeight, p.scrollTop);
  });
  return (
    <div>
      <ScrollHint targetRef={ref} />
      <div ref={ref} data-testid="box" />
    </div>
  );
};

const mount = (scrollHeight: number, clientHeight: number, scrollTop: number) =>
  render(
    <I18nProvider>
      <Host scrollHeight={scrollHeight} clientHeight={clientHeight} scrollTop={scrollTop} />
    </I18nProvider>,
  );

describe('[SCROLLHINT] โชว์เฉพาะทางที่ไปได้จริง', () => {
  it('⭐⭐ 🔴 อยู่บนสุด ⇒ โชว์ลงอย่างเดียว ไม่โชว์ขึ้น', async () => {
    const { queryByTestId, getByTestId } = mount(1000, 400, 0);
    fireEvent.scroll(getByTestId('box'));

    await waitFor(() => expect(queryByTestId('scroll-hint-down')).not.toBeNull());
    expect(queryByTestId('scroll-hint-up')).toBeNull();
  });

  it('⭐⭐ 🔴 อยู่ล่างสุด ⇒ โชว์ขึ้นอย่างเดียว ไม่โชว์ลง', async () => {
    const { queryByTestId, getByTestId } = mount(1000, 400, 600);
    fireEvent.scroll(getByTestId('box'));

    await waitFor(() => expect(queryByTestId('scroll-hint-up')).not.toBeNull());
    expect(queryByTestId('scroll-hint-down')).toBeNull();
  });

  it('⭐⭐ อยู่กลาง ⇒ โชว์ทั้งสองทาง', async () => {
    const { queryByTestId, getByTestId } = mount(1000, 400, 300);
    fireEvent.scroll(getByTestId('box'));

    await waitFor(() => expect(queryByTestId('scroll-hint-up')).not.toBeNull());
    expect(queryByTestId('scroll-hint-down')).not.toBeNull();
  });

  it('⭐⭐ 🔴 เนื้อหาสั้นกว่ากรอบ ⇒ ไม่มีลูกศรสักอัน', async () => {
    /* ลูกศรที่ขึ้นทั้งที่ไปไหนไม่ได้ = สัญญาณรบกวนล้วน ๆ */
    const { queryByTestId, getByTestId } = mount(300, 400, 0);
    fireEvent.scroll(getByTestId('box'));

    await waitFor(() => {
      expect(queryByTestId('scroll-hint-up')).toBeNull();
      expect(queryByTestId('scroll-hint-down')).toBeNull();
    });
  });

  it('⭐ ลูกศรต้องไม่กินคลิก — มันลอยทับเนื้อหาอยู่', async () => {
    const { getByTestId, findByTestId } = mount(1000, 400, 0);
    fireEvent.scroll(getByTestId('box'));

    const hint = await findByTestId('scroll-hint-down');
    expect(hint.className).toContain('pointer-events-none');
  });
});
