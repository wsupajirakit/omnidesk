import {
  evaluateResult,
  mapResult,
  matchRule,
  pickByPath,
  type ResultRule,
} from '@/common/utils/result-rules';

describe('resultRules', () => {
  it('picks values by dot path', () => {
    const data = { user: { profile: { code: 200 } } };
    expect(pickByPath(data, 'user.profile.code')).toBe(200);
    expect(pickByPath(data, 'user.unknown')).toBeNull();
  });

  it('matches rules correctly', () => {
    const rule: ResultRule = {
      path: 'res.status',
      op: 'eq',
      value: 'SUCCESS',
    };

    expect(matchRule(rule, { res: { status: 'SUCCESS' } }, 200)).toBe(true);
    expect(matchRule(rule, { res: { status: 'FAIL' } }, 200)).toBe(false);
  });

  it('evaluates rules array into verdict', () => {
    const rules: ResultRule[] = [
      {
        path: 'code',
        op: 'eq',
        value: 0,
        action: 'success',
      },
    ];

    const passVerdict = evaluateResult(rules, { code: 0 }, 200);
    expect(passVerdict).toEqual({
      ok: true,
      matched: true,
      error_code: 'LINK_OK',
      failure_type: '',
      vendor_message: null,
    });

    const failVerdict = evaluateResult(rules, { code: 999 }, 200);
    expect(failVerdict?.ok).toBe(false);
    expect(failVerdict?.error_code).toBe('LINK_UNKNOWN');
  });

  it('maps result using resultMap config', () => {
    const body = { data: { uid: 'M123', tel: '0812345678' } };
    const resultMap = { member_id: 'data.uid', phone: 'data.tel' };

    expect(mapResult(resultMap, body)).toEqual({
      member_id: 'M123',
      phone: '0812345678',
      name: null,
    });
  });
});
