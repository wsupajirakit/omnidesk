/* eslint-disable no-restricted-imports -- the hook write layer is unit-tested from its files, as
   every sibling hook-field spec does (ignore-abandon-assist.spec.ts) */
/**
 * [FEAT-20261026-RAGENGINE] The engine's per-hook settings on the hook — the write path must not
 * drop them, a bad value must be refused, null must mean "the code default", and a clone must
 * carry them (plus `doc_retrieval`, which a clone dropped since 10/08).
 * Approved DB change 26/10: two additive fields, default null, no migration.
 * field ใหม่ต้องไม่หายระหว่างบันทึก · ค่าผิดได้ 400 · null = ค่าเริ่มต้น · clone ต้องติดไป
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BadRequestException } from '@nestjs/common';

import { FIELD_TAB } from '@/modules/hooks/hook-field-tabs';
import {
  parseRagPromptMode,
  parseRagSearchMode,
} from '@/modules/hooks/hook-write.helpers';
import { HookSchema } from '@/modules/hooks/schemas/hook.schema';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('[RAGENGINE] parsers', () => {
  it('absent ⇒ untouched (undefined); null or empty ⇒ null (= code default)', () => {
    expect(parseRagPromptMode(undefined)).toBeUndefined();
    expect(parseRagPromptMode(null)).toBeNull();
    expect(parseRagSearchMode('')).toBeNull();
  });

  it('accepts exactly the engine values (trimmed)', () => {
    expect(parseRagPromptMode('add')).toBe('add');
    expect(parseRagPromptMode(' replace ')).toBe('replace');
    expect(parseRagSearchMode('bm25')).toBe('bm25');
    expect(parseRagSearchMode('hybrid')).toBe('hybrid');
  });

  it('🔴 refuses anything else — a typo must never land on a paid search', () => {
    for (const bad of ['Hybrid', 'vector', true, 1, {}]) {
      expect(() => parseRagSearchMode(bad)).toThrow(BadRequestException);
    }
    expect(() => parseRagPromptMode('full')).toThrow(BadRequestException);
  });
});

describe('[RAGENGINE] schema defaults — touch nobody', () => {
  it('🔴 PIN both fields default to null; doc_retrieval still defaults to false', () => {
    expect(HookSchema.path('rag_prompt_mode')).toBeDefined();
    expect(
      (
        HookSchema.path('rag_prompt_mode') as unknown as {
          defaultValue: unknown;
        }
      ).defaultValue,
    ).toBeNull();
    expect(
      (
        HookSchema.path('rag_search_mode') as unknown as {
          defaultValue: unknown;
        }
      ).defaultValue,
    ).toBeNull();
    expect(
      (HookSchema.path('doc_retrieval') as unknown as { defaultValue: unknown })
        .defaultValue,
    ).toBe(false);
  });
});

describe('[RAGENGINE] the write path cannot drop them silently', () => {
  const hooks = src('src/modules/hooks/hooks.service.ts');

  it('⭐ both are on ALLOWED_UPDATES — otherwise edit returns 200 and changes nothing', () => {
    expect(hooks).toMatch(/'rag_prompt_mode',/);
    expect(hooks).toMatch(/'rag_search_mode',/);
  });

  it('create AND update run each through its parser', () => {
    expect((hooks.match(/parseRagPromptMode\(/g) ?? []).length).toBe(2);
    expect((hooks.match(/parseRagSearchMode\(/g) ?? []).length).toBe(2);
  });

  it('the update branch keys on hasOwnProperty, so an explicit clear lands', () => {
    expect(hooks).toContain("hasOwnProperty.call(updates, 'rag_prompt_mode')");
    expect(hooks).toContain("hasOwnProperty.call(updates, 'rag_search_mode')");
  });
});

describe('[RAGENGINE] clone carries them', () => {
  it('⭐ FIELD_TAB maps the switch and both modes to the AI tab', () => {
    expect(FIELD_TAB['doc_retrieval']).toBe('ai');
    expect(FIELD_TAB['rag_prompt_mode']).toBe('ai');
    expect(FIELD_TAB['rag_search_mode']).toBe('ai');
  });
});
