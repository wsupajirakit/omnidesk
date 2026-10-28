import { escapeRegex } from '@/common/utils/escape-regex';

describe('escapeRegex', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegex('hello.world*+?^${}()|[]\\')).toBe(
      'hello\\.world\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\',
    );
  });

  it('handles null, undefined and empty strings', () => {
    expect(escapeRegex(null)).toBe('');
    expect(escapeRegex(undefined)).toBe('');
    expect(escapeRegex('')).toBe('');
  });
});
