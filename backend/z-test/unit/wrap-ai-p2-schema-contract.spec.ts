/**
 * [TEST-20260813-P2-SCHEMA] RED-FIRST schema contract for `hook.ai_vendor`.
 *
 * ⚠️ THIS SPEC IS EXPECTED TO FAIL UNTIL THE OWNER APPROVES THE DB CHANGE AND
 *    T05 ADDS THE `@Prop`. That red is the whole point: Mongoose runs with
 *    `strict: true`, so a field the schema does not declare is DROPPED SILENTLY
 *    on write — no error, no warning, and the dashboard would report a happy
 *    200 while the value never persisted. The repo has been bitten by exactly
 *    that before, so the persistence claim gets a test that can fail, taken
 *    BEFORE the schema line exists rather than after.
 *
 * Pattern copied from `paytool-p1-schema-binding.spec.ts`: a throwaway model is
 * built from the REAL `HookSchema`, and constructing a document applies schema
 * defaults + strict filtering WITHOUT a live connection — no DB, no network.
 *
 * When T05 lands, this file needs NO edit; it simply turns green, and the
 * red→green flip is the evidence recorded in the task note.
 *
 * revert: delete this file together with the `ai_vendor` work.
 */
import mongoose from 'mongoose';

import { HookSchema } from '@/modules/hooks';

const HookModel = mongoose.model('P2Schema_Hook', HookSchema);

describe('[P2 SCHEMA] hook.ai_vendor must survive a write (red until T05)', () => {
  it('a declared value is kept on the document — strict mode drops undeclared fields', () => {
    const doc = new HookModel({ alias: 'p2-schema', ai_vendor: 'deepseek' });
    // ⚠️ RED until the @Prop exists: strict:true silently removes the key, so
    //    `get` returns undefined and this assertion fails for the RIGHT reason.
    expect(doc.get('ai_vendor')).toBe('deepseek');
  });

  it("defaults to null so every existing row keeps behaving like 'gemini'", () => {
    const doc = new HookModel({ alias: 'p2-schema-default' });
    // `null`, not undefined: the resolver's `provider ?? DEFAULT` treats both the
    // same, but the announce block promises an explicit null column.
    expect(doc.get('ai_vendor')).toBeNull();
  });

  it('accepts the gemini value too (the field is a plain string, not an enum trap)', () => {
    const doc = new HookModel({
      alias: 'p2-schema-gemini',
      ai_vendor: 'gemini',
    });
    expect(doc.get('ai_vendor')).toBe('gemini');
  });

  it('an unknown vendor still persists — the REGISTRY, not the schema, decides safety', () => {
    // Deliberate: the resolver falls back to gemini for anything it does not
    // know (reply-transport.registry.ts), so a typo can never break a reply.
    // Rejecting it at the schema would move that decision to the wrong layer and
    // would also make the write path throw where legacy never threw.
    const doc = new HookModel({
      alias: 'p2-schema-typo',
      ai_vendor: 'deepsek',
    });
    expect(doc.get('ai_vendor')).toBe('deepsek');
  });
});

describe('[P2 SCHEMA] the strict-drop hazard this spec exists for', () => {
  it('proves strict mode really does drop an undeclared field (control case)', () => {
    const doc = new HookModel({
      alias: 'p2-schema-control',
      totally_undeclared_field_xyz: 'value',
    });
    // If this ever returns the value, the schema stopped being strict and the
    // red-first reasoning above no longer holds — that would need a look.
    expect(doc.get('totally_undeclared_field_xyz')).toBeUndefined();
  });
});
