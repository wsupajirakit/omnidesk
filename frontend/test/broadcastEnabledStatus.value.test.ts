/**
 * [FEAT-20260824-BCASTENABLED] สถานะ = เปิด/ปิด, and the three states behind it.
 * ===========================================================================
 * Owner, 24/08: "สถานะ คือเปิด ปิด ใช้งาน ไม่ใช่ส่งแล้ว" — the list column used to
 * print the job lifecycle (ฉบับร่าง / ส่งแล้ว). One job now sends many times, so
 * "ส่งแล้ว" says nothing about the job; whether a RUN finished is a ประวัติ
 * question ("การดูว่าเสร็จไหม ไปดูใน history").
 *
 * 🔴 THE PROPERTY THIS FILE DEFENDS: `enabled === false` IS THE ONLY "OFF".
 *    Mongo stores `null` for a declared-but-unset field, so a schedule written
 *    before the toggle existed comes back as `{ enabled: null }`, and a partial
 *    write comes back with the key missing. Both mean the campaign is RUNNING.
 *    A falsy check (`!enabled`, `enabled ?? false`) paints live campaigns as
 *    ปิด — that already happened once and caused a real outage. Every falsy
 *    shape below is asserted as ON so the mutation cannot survive.
 *    null / ไม่มีคีย์ = เปิด. มีแต่ false เท่านั้นที่แปลว่าปิด.
 *
 * 🔴 AND: no `schedule` object AT ALL is a THIRD state, not a synonym for off.
 *    Such a row never had a repeat rule — it is a one-off campaign. Calling it
 *    ปิด tells an admin someone switched it off, which nobody did.
 *    ไม่มีรอบส่งซ้ำ ≠ ปิดอยู่.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveBroadcastEnableState,
  BROADCAST_ENABLE_LABEL,
} from '../components/messaging/enabled/broadcastEnableState';

describe('🔴 only an explicit false is OFF', () => {
  it('enabled: false → off', () => {
    expect(resolveBroadcastEnableState({ enabled: false })).toBe('off');
  });

  it('enabled: true → on', () => {
    expect(resolveBroadcastEnableState({ enabled: true })).toBe('on');
  });

  it('🔴 enabled: null → on — this is what Mongo stores for an unset field', () => {
    /* The outage shape. A `?? false` or `!enabled` here flips this red. */
    expect(resolveBroadcastEnableState({ enabled: null })).toBe('on');
  });

  it('🔴 the key missing from an existing schedule → on', () => {
    /* A partial write (mode/days only) leaves `enabled` absent. Still armed. */
    expect(resolveBroadcastEnableState({})).toBe('on');
  });

  it('🔴 enabled: undefined spelled out → on', () => {
    expect(resolveBroadcastEnableState({ enabled: undefined })).toBe('on');
  });
});

describe('🔴 no schedule at all is its own state, not "off"', () => {
  it('schedule undefined → one_off', () => {
    expect(resolveBroadcastEnableState(undefined)).toBe('one_off');
  });

  it('schedule null → one_off', () => {
    /* The API sends `null` for a job with no repeat rule; the row type says so. */
    expect(resolveBroadcastEnableState(null)).toBe('one_off');
  });

  it('one_off is not collapsed into on or off', () => {
    const noRule = resolveBroadcastEnableState(null);
    expect(noRule).not.toBe('off');
    expect(noRule).not.toBe('on');
  });

  it('and it reads as something honest, not as a toggle position', () => {
    /* Whatever the wording, it must not claim the campaign was switched off. */
    expect(BROADCAST_ENABLE_LABEL.one_off).not.toContain('ปิด');
    expect(BROADCAST_ENABLE_LABEL.off).toContain('ปิด');
    expect(BROADCAST_ENABLE_LABEL.on).toContain('เปิด');
  });

  it('the three labels are three distinct strings', () => {
    const labels = Object.values(BROADCAST_ENABLE_LABEL);
    expect(new Set(labels).size).toBe(3);
  });
});
