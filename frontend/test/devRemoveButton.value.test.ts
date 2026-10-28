/**
 * [TEST-20260820-DEVREMOVE] the profile-wipe button is drawn for `dev` alone
 * ===========================================================================
 * Owner, 2026-08-20: "แสดงปุ่มข้างๆ tier + confirm remove" · "fe รอบนี้ให้เห็นแค่
 * username = dev คนเดียว" · "การซ่อนปุ่ม remove ห้ามให้ inspect แก้ไข html เองได้".
 *
 * ⚠️ WHAT THIS SUITE CAN AND CANNOT PROVE. It pins that the dashboard draws the
 * control for one account. It CANNOT prove the capability is closed to anyone
 * else — hiding an element never does. That proof lives in
 * `omnidesk-api/z-test/unit/dev-remove-guard.spec.ts`, which tests the server-side
 * lock. Both are needed; neither is enough alone.
 * เทสนี้พิสูจน์แค่ "วาดปุ่มให้ใคร" · "ใครใช้ได้จริง" อยู่ที่เทสฝั่ง BE.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const panel = src('components/profile-panel/ProfilePanel.tsx');

describe('the button is gated on the username', () => {
  it('⭐ the gate is exactly the `dev` account, lower-cased and trimmed', () => {
    expect(panel).toContain('const canDevRemove =');
    const line = panel
      .split('\n')
      .find((l) => l.includes(".toLowerCase() === 'dev'"));
    expect(line).toBeDefined();
    expect(line).toContain('username');
  });

  it('⭐ the trash button renders behind that gate, not behind `false`', () => {
    /* it was hidden with `{false && (` from 2026-08-14 until this change; if a
       later edit puts that back, the button is gone for `dev` too and this goes
       red so the removal is deliberate. */
    expect(panel).toContain('{canDevRemove && (');
    const btn = panel.slice(panel.indexOf('{canDevRemove && ('));
    expect(btn.slice(0, 400)).toContain('setConfirmUnlink(true)');
  });

  it('⭐ it still asks twice before wiping anything', () => {
    /* the two-step confirm predates this change and must survive it: a single
       misclick must not clear a real customer's profile.
       สองด่านยืนยันต้องยังอยู่ · กดพลาดครั้งเดียวต้องไม่ลบ. */
    expect(panel).toContain('setConfirmUnlink(true)');
    expect(panel).toContain('confirmUnlink2');
    expect(panel).toContain('clearAck');
  });

  it('the note says the FE gate is not the lock', () => {
    /* the next reader must not mistake a hidden button for a closed door. */
    const doc = panel.slice(
      panel.indexOf('[TEST-20260820-DEVREMOVE] TESTING TOOL'),
      panel.indexOf('const canDevRemove ='),
    );
    expect(doc).toContain('NOT A PERMISSION CHECK');
    expect(doc).toContain('dev-remove.guard.ts');
    expect(doc).toContain('DEV_REMOVE_USERNAMES=');
  });
});

describe('it sits where the owner asked — beside the tier badge', () => {
  it('inside the ข้อมูลลูกค้า card header, next to the edit button', () => {
    const header = panel.slice(
      panel.indexOf('{canDevRemove && ('),
    );
    // the pencil (edit) control is its immediate neighbour in that header
    expect(panel.slice(0, panel.indexOf('{canDevRemove && ('))).toContain(
      "openAdminLanding('edit')",
    );
    expect(header.slice(0, 700)).toContain('Trash2');
  });
});
