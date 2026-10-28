/**
 * Header Safe Token validation utility.
 * Ported from legacy headerSafeToken.js.
 */

export const HEADER_SAFE = /^[\x20-\x7E\t\x80-\xFF]*$/;

export interface CheckHeaderTokenResult {
  ok: boolean;
  value?: string;
  reason?: string;
  message?: string;
}

export function checkHeaderToken(raw: unknown): CheckHeaderTokenResult {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: false, reason: 'empty', message: 'ไม่มี token' };
  }
  if (typeof raw !== 'string') {
    return {
      ok: false,
      reason: 'not_string',
      message: `token ที่ได้ไม่ใช่ข้อความ (ได้ ${Array.isArray(raw) ? 'array' : typeof raw}) — ตรวจสอบ token_path ว่าชี้ตรงช่องที่เก็บ token หรือยัง`,
    };
  }
  const value = raw.trim();
  if (!value) {
    return { ok: false, reason: 'empty', message: 'token ว่างเปล่า' };
  }
  if (!HEADER_SAFE.test(value)) {
    const preview = value.length > 60 ? `${value.slice(0, 60)}…` : value;
    return {
      ok: false,
      reason: 'invalid_char',
      message:
        `ค่าที่ได้ไม่ใช่ token ที่ใช้งานได้ (มีอักขระที่ใส่ใน header ไม่ได้): "${preview}" — ` +
        `มักเกิดจาก token_path ตั้งผิด หรือขั้นตอน login ยังไม่สำเร็จจริง`,
    };
  }
  return { ok: true, value };
}

export function isHeaderSafeToken(raw: unknown): boolean {
  return checkHeaderToken(raw).ok;
}
