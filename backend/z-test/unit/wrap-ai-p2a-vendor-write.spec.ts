/**
 * [TEST-20260813-P2A-WRITE] The write side of `ai_vendor` / `ai_model`.
 *
 * Covers the parser's decisions and the schema defaults that make the columns
 * additive. The clone rule (vendor drags its key) is exercised separately in
 * the clone spec; here the concern is: what may be written, and what a hook
 * looks like when nobody sets anything.
 */

import mongoose from 'mongoose';

import { HookSchema } from '@/modules/hooks';
import {
  AI_VENDORS,
  parseAiModel,
  parseAiVendor,
} from '@/modules/hooks/ai-vendor/parse-ai-vendor';

const HookModel = mongoose.model('P2AWrite_Hook', HookSchema);

describe('[P2A WRITE] parseAiVendor', () => {
  it('accepts every vendor the registry can resolve', () => {
    for (const v of AI_VENDORS) expect(parseAiVendor(v)).toBe(v);
  });

  it("treats '' and null as 'use the default vendor' → null", () => {
    expect(parseAiVendor('')).toBeNull();
    expect(parseAiVendor(null)).toBeNull();
  });

  it('passes undefined through — an update that omits the key must not clear it', () => {
    expect(parseAiVendor(undefined)).toBeUndefined();
  });

  it('⭐ REJECTS a typo instead of letting it read as "switched"', () => {
    // The runtime registry would fall back to the default and answer normally,
    // so a silently-saved typo looks switched on the dashboard while the OA
    // keeps its old vendor. The write is the only place to say so.
    expect(() => parseAiVendor('deepsek')).toThrow(/ai_vendor must be one of/);
    expect(() => parseAiVendor('DeepSeek')).toThrow(); // case matters: registry keys are exact
    expect(() => parseAiVendor(42)).toThrow();
  });
});

describe('[P2A WRITE] parseAiModel', () => {
  it('keeps a trimmed model name', () => {
    expect(parseAiModel('  deepseek-chat  ')).toBe('deepseek-chat');
  });

  it('null / blank means "use the vendor family default"', () => {
    expect(parseAiModel(null)).toBeNull();
    expect(parseAiModel('   ')).toBeNull();
    expect(parseAiModel('')).toBeNull();
  });

  it('passes undefined through', () => {
    expect(parseAiModel(undefined)).toBeUndefined();
  });

  it('does NOT allow-list model names — vendors ship new ones constantly', () => {
    // A hardcoded list would reject a model that actually works; an unknown id
    // fails at the vendor with its own error, which is the honest place.
    expect(parseAiModel('some-model-shipped-next-week')).toBe(
      'some-model-shipped-next-week',
    );
  });

  it('rejects a non-string and an absurd length', () => {
    expect(() => parseAiModel(123)).toThrow(/ai_model must be a string/);
    expect(() => parseAiModel('x'.repeat(101))).toThrow(/100 characters/);
  });
});

describe('[P2A WRITE] schema columns are additive', () => {
  it('a hook created without them gets null for both — no migration needed', () => {
    const doc = new HookModel({ alias: 'p2a-default' });
    expect(doc.get('ai_vendor')).toBeNull();
    expect(doc.get('ai_model')).toBeNull();
  });

  it('both values survive a write (strict mode would drop an undeclared field)', () => {
    const doc = new HookModel({
      alias: 'p2a-set',
      ai_vendor: 'deepseek',
      ai_model: 'deepseek-reasoner',
    });
    expect(doc.get('ai_vendor')).toBe('deepseek');
    expect(doc.get('ai_model')).toBe('deepseek-reasoner');
  });

  /* ── [FEAT-20260904-VENDORSECCOL] the second vendor's two columns ────────
     Same three questions asked of the first pair, because every one of them has
     a silent failure mode: a column Mongoose does not declare is DROPPED on
     write with a happy 200, a field missing from ALLOWED_UPDATES is dropped by
     the PUT handler with a happy 200, and a key missing from SENSITIVE_FIELDS
     is stored in PLAINTEXT and handed to the browser.
     ทั้งสามข้อพังเงียบทั้งหมด — ต้องมีเทสจับทุกข้อ */
  it('the SEC pair is declared, so strict mode does not drop it', () => {
    const doc = new HookModel({
      alias: 'seccol-set',
      ai_vendor: 'deepseek',
      ai_model_sec: 'deepseek-reasoner',
      custom_ai_key_sec: 'enc:DS',
    });
    expect(doc.get('ai_model_sec')).toBe('deepseek-reasoner');
    expect(doc.get('custom_ai_key_sec')).toBe('enc:DS');
  });

  it('a hook created without the SEC pair reads as "not set" — no migration', () => {
    const doc = new HookModel({ alias: 'seccol-default' });
    expect(doc.get('ai_model_sec')).toBeNull();
    // no default on the key: absent means "this OA has no DeepSeek key".
    expect(doc.get('custom_ai_key_sec')).toBeUndefined();
  });

  it('⭐ both SEC columns are on ALLOWED_UPDATES — or a PUT answers 200 and drops them', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require('fs').readFileSync(
      require('path').join(
        __dirname,
        '../../src/modules/hooks/hooks.service.ts',
      ),
      'utf8',
    ) as string;
    const list = src.slice(
      src.indexOf('ALLOWED_UPDATES'),
      src.indexOf('];', src.indexOf('ALLOWED_UPDATES')),
    );
    expect(list).toContain("'ai_model_sec'");
    expect(list).toContain("'custom_ai_key_sec'");
  });

  it('⭐ the SEC KEY is encrypted like every other credential, the SEC MODEL is not', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SENSITIVE_FIELDS } = require('@/infra/crypto/crypto.service') as {
      SENSITIVE_FIELDS: readonly string[];
    };
    expect(SENSITIVE_FIELDS).toContain('custom_ai_key_sec');
    expect(SENSITIVE_FIELDS).not.toContain('ai_model_sec');
  });

  it('neither is encrypted — they are names, not credentials', () => {
    // custom_ai_key goes through the crypto SENSITIVE_FIELDS list; these must
    // not, or every read would try to decrypt a plain string.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SENSITIVE_FIELDS } = require('@/infra/crypto/crypto.service') as {
      SENSITIVE_FIELDS: readonly string[];
    };
    expect(SENSITIVE_FIELDS).not.toContain('ai_vendor');
    expect(SENSITIVE_FIELDS).not.toContain('ai_model');
  });
});
