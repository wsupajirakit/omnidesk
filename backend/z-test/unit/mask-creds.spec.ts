import { maskCredsDeep, maskString } from '@/common/utils/mask-creds';

describe('maskCreds', () => {
  it('masks string revealing head ~20%', () => {
    expect(maskString('123')).toBe('•••');
    expect(maskString('sk_live_abcd1234')).toBe('sk_l••••••••••••');
  });

  it('masks object payload credential values deeply', () => {
    const payload = {
      api_key: 'sk_live_1234567890',
      user: {
        password: 'mySecretPassword123',
        id: 'a0d00000000000000000006a', // ObjectId -> kept
      },
      publicField: 'hello',
    };

    const masked = maskCredsDeep(payload);
    expect(masked.api_key).toMatch(/^sk_l/);
    expect(masked.user.password).toMatch(/^my/);
    expect(masked.user.id).toBe('a0d00000000000000000006a');
    expect(masked.publicField).toBe('hello');
  });
});
