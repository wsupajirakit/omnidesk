import {
  checkHeaderToken,
  isHeaderSafeToken,
} from '@/common/utils/header-safe-token';

describe('headerSafeToken', () => {
  it('accepts valid ascii and latin1 header tokens', () => {
    expect(isHeaderSafeToken('Bearer eyJhbGciOiJIUzI1NiJ9')).toBe(true);
    expect(isHeaderSafeToken('café')).toBe(true);
  });

  it('rejects empty or non-string inputs with detailed message', () => {
    expect(checkHeaderToken(null)).toEqual({
      ok: false,
      reason: 'empty',
      message: 'ไม่มี token',
    });
    expect(checkHeaderToken(123)).toEqual({
      ok: false,
      reason: 'not_string',
      message:
        'token ที่ได้ไม่ใช่ข้อความ (ได้ number) — ตรวจสอบ token_path ว่าชี้ตรงช่องที่เก็บ token หรือยัง',
    });
    expect(checkHeaderToken('   ')).toEqual({
      ok: false,
      reason: 'empty',
      message: 'token ว่างเปล่า',
    });
  });

  it('rejects control chars and non-latin1 characters', () => {
    const res = checkHeaderToken('(ได้ token แล้ว — ถูกซ่อนไว้)');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('invalid_char');
  });
});
