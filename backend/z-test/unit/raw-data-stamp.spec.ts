import {
  hasContent,
  isFetchOk,
  isFresh,
  SITE_RULES_TTL_MS,
  withStamp,
} from '@/common/utils/raw-data-stamp';

describe('rawDataStamp', () => {
  it('checks content availability', () => {
    expect(hasContent(null)).toBe(false);
    expect(hasContent('')).toBe(false);
    expect(hasContent({})).toBe(false);
    expect(hasContent([])).toBe(false);
    expect(hasContent('data')).toBe(true);
    expect(hasContent({ a: 1 })).toBe(true);
    expect(hasContent([1])).toBe(true);
    expect(hasContent(0)).toBe(true);
  });

  it('evaluates isFetchOk correctly', () => {
    expect(isFetchOk({ success: true, status: 200, data: 'payload' })).toBe(
      true,
    );
    expect(isFetchOk({ success: true, status: 200, data: {} })).toBe(false);
    expect(isFetchOk({ success: false, status: 200, data: 'ok' })).toBe(false);
  });

  it('attaches stamp to update object', () => {
    const setObj: Record<string, unknown> = {};
    withStamp(setObj, 'raw_profile_data', 'profile_updated_at', {
      name: 'John',
    });

    expect(setObj.raw_profile_data).toEqual({ name: 'John' });
    expect(setObj.profile_updated_at).toBeInstanceOf(Date);
  });

  it('checks freshness window', () => {
    const now = Date.now();
    const recent = new Date(now - 1000);
    const old = new Date(now - SITE_RULES_TTL_MS - 1000);

    expect(isFresh(recent)).toBe(true);
    expect(isFresh(old)).toBe(false);
    expect(isFresh(null)).toBe(false);
  });
});
