/**
 * [FEAT-20260909-DSREASONING] Four cells, two lanes — and an OA that set none of
 * it must be untouched, at code level.
 * ============================================================================
 * Owner, 09/09, twice and then a third time with emphasis:
 *
 *   *"an OA using the main Gemini bot needs NO backfill of any kind — the only
 *     new thing is being able to choose an AI for translate"* … *"at CODE level
 *     too, this must not slip."*
 *
 * That sentence is what this file exists to enforce. It is easy to satisfy by
 * accident and easy to break by accident, because every new column is null on
 * every existing row: the wrong wiring looks identical to the right wiring
 * until an admin fills a box, and then it is a live OA that finds out.
 *
 * ## The matrix
 *
 *                  main (reply + summary)      translate
 *   Gemini         gemini_thinking_budget      gemini_thinking_budget_translate
 *   DeepSeek       deepseek_thinking           deepseek_thinking_translate
 *                  deepseek_reasoning_effort   deepseek_reasoning_effort_translate
 *
 * ## What is deliberately NOT here
 *
 * A case asserting the reply lane still works. It does, and its own specs say
 * so; re-asserting it here would be this feature grading its own homework in a
 * file it wrote. What IS here is narrower and harder to fake: that the reply
 * lane's column name has not moved, and that neither lane can read the other's.
 *
 * revert: delete this spec with `hooks/ai-reasoning/`.
 */
import {
  REASONING_COLUMNS,
  NEW_REASONING_COLUMNS,
  reasoningColumns,
} from '@/modules/hooks/ai-reasoning/reasoning-columns';
import {
  resolveDeepSeekReasoning,
  resolveGeminiReasoning,
} from '@/modules/hooks/ai-reasoning/resolve-reasoning';
import { FIELD_TAB } from '@/modules/hooks/hook-field-tabs';
import { HookSchema } from '@/modules/hooks/schemas/hook.schema';

/** A row exactly as it exists today: none of the new columns present at all. */
const legacyRow = (over: Record<string, unknown> = {}) => ({
  _id: 'oa-1',
  alias: 'omnidesk-like',
  ai_vendor: null,
  ...over,
});

describe('🔴 [DSREASONING] an existing OA is untouched — the no-backfill rule', () => {
  it('⭐ N1 · a row with NO new column resolves to null on every cell', () => {
    /* Four cells, one row, and every answer must be "say nothing". If any of
       these ever returns an object, an OA that configured nothing starts
       sending a field it never chose. */
    const row = legacyRow();
    expect(resolveGeminiReasoning(row, 'main')).toBeNull();
    expect(resolveGeminiReasoning(row, 'translate')).toBeNull();
    expect(resolveDeepSeekReasoning(row, 'main')).toBeNull();
    expect(resolveDeepSeekReasoning(row, 'translate')).toBeNull();
  });

  it('⭐ N2 · a row carrying ONLY the pre-existing Gemini budget is unchanged', () => {
    /* The `omnideskoa` shape: an OA configured before any of this existed. Its
       main-lane budget still resolves, and the three new cells stay silent. */
    const row = legacyRow({ gemini_thinking_budget: 2048 });
    expect(resolveGeminiReasoning(row, 'main')).toEqual({ budget: 2048 });
    expect(resolveGeminiReasoning(row, 'translate')).toBeNull();
    expect(resolveDeepSeekReasoning(row, 'main')).toBeNull();
    expect(resolveDeepSeekReasoning(row, 'translate')).toBeNull();
  });

  it('⭐ N3 · the live column name has NOT moved', () => {
    /* `webhook/ai-vendors/request-credentials.ts` reads this literal, and
       `ask-model.step.ts` and the Gemini reply transport carry it onward.
       Renaming it — to `_main`, for symmetry with the new names — would be a
       migration on a running system. It was considered and refused. */
    expect(REASONING_COLUMNS['gemini']?.main.budgetField).toBe(
      'gemini_thinking_budget',
    );
    /* And it is NOT claimed as one of this feature's own columns, because it
       was registered long before. */
    expect(NEW_REASONING_COLUMNS).not.toContain('gemini_thinking_budget');
  });

  it('⭐ N4 · every NEW column defaults to null in the schema', () => {
    /* `null`, not `''` and not a vendor default. An unset column has to be
       distinguishable from a deliberate choice, or "the OA said nothing"
       becomes unrepresentable. */
    for (const name of NEW_REASONING_COLUMNS) {
      const path = HookSchema.path(name) as unknown as {
        defaultValue: unknown;
      };
      expect({ name, present: path !== undefined }).toEqual({
        name,
        present: true,
      });
      expect({ name, def: path.defaultValue }).toEqual({ name, def: null });
    }
  });

  it('N5 · every new column is registered on the AI tab', () => {
    for (const name of NEW_REASONING_COLUMNS) {
      expect({ name, tab: FIELD_TAB[name] }).toEqual({ name, tab: 'ai' });
    }
  });
});

describe('🔴 [DSREASONING] the two lanes cannot read each other', () => {
  it('⭐ L1 · the main lane does not see a translate-lane value', () => {
    /* The mistake this whole split exists to prevent, and the one nothing
       downstream could catch: both columns are strings and both are usually
       null, so a lane reading the wrong one fails silently and forever. */
    const row = legacyRow({
      deepseek_thinking_translate: 'enabled',
      deepseek_reasoning_effort_translate: 'max',
    });
    expect(resolveDeepSeekReasoning(row, 'main')).toBeNull();
    expect(resolveDeepSeekReasoning(row, 'translate')).toEqual({
      type: 'enabled',
      effort: 'max',
    });
  });

  it('⭐ L2 · and the translate lane does not see a main-lane value', () => {
    const row = legacyRow({
      deepseek_thinking: 'disabled',
      deepseek_reasoning_effort: 'low',
    });
    expect(resolveDeepSeekReasoning(row, 'translate')).toBeNull();
    expect(resolveDeepSeekReasoning(row, 'main')).toEqual({
      type: 'disabled',
      effort: 'low',
    });
  });

  it('L3 · the same is true for Gemini’s two budgets', () => {
    const row = legacyRow({ gemini_thinking_budget_translate: 512 });
    expect(resolveGeminiReasoning(row, 'main')).toBeNull();
    expect(resolveGeminiReasoning(row, 'translate')).toEqual({ budget: 512 });
  });

  it('L4 · the six names are all distinct — a duplicate would silently merge two cells', () => {
    const all = [
      REASONING_COLUMNS['gemini']?.main.budgetField,
      REASONING_COLUMNS['gemini']?.translate.budgetField,
      REASONING_COLUMNS['deepseek']?.main.thinkingField,
      REASONING_COLUMNS['deepseek']?.main.effortField,
      REASONING_COLUMNS['deepseek']?.translate.thinkingField,
      REASONING_COLUMNS['deepseek']?.translate.effortField,
    ];
    expect(new Set(all).size).toBe(6);
  });
});

describe('[DSREASONING] what a stored value resolves to', () => {
  it('R1 · blank, whitespace and a non-string all read as "not set"', () => {
    for (const blank of ['', '   ', null, undefined, 0, false, {}]) {
      expect(
        resolveDeepSeekReasoning(
          legacyRow({ deepseek_thinking: blank }),
          'main',
        ),
      ).toBeNull();
    }
  });

  it('R2 · an effort with no switch still answers, with the vendor’s own default type', () => {
    /* Reporting the operator's intent rather than completing it. Whether the
       vendor honours an effort while thinking is off is an open question that a
       live call has to settle; the resolver does not pretend to know. */
    expect(
      resolveDeepSeekReasoning(
        legacyRow({ deepseek_reasoning_effort: 'high' }),
        'main',
      ),
    ).toEqual({ type: 'enabled', effort: 'high' });
  });

  it('R3 · a switch with no effort omits the effort entirely', () => {
    const out = resolveDeepSeekReasoning(
      legacyRow({ deepseek_thinking: 'disabled' }),
      'main',
    );
    expect(out).toEqual({ type: 'disabled' });
    expect('effort' in (out as object)).toBe(false);
  });

  it('R4 · Gemini’s budget accepts 0 — the hotfix decides what 0 means, not us', () => {
    /* Owner, 09/09: do it the same way as `[HOTFIX-20260826-THINK36]`, or the
       same number means two different things in two boxes. `0` is a real,
       storable choice here exactly as it is for the main-lane column; the
       caller hands it to `resolveThinkingConfig`, which answers `0` with
       `thinkingBudget: 0` for the 2.5 family and a `thinkingLevel` for Gemini 3.
       An UNSET column is the different case, and it is N1 above. */
    expect(
      resolveGeminiReasoning(
        legacyRow({ gemini_thinking_budget_translate: 0 }),
        'translate',
      ),
    ).toEqual({ budget: 0 });
  });

  it('R5 · an unknown vendor falls back to gemini’s columns', () => {
    expect(reasoningColumns('openai', 'main').budgetField).toBe(
      'gemini_thinking_budget',
    );
    expect(reasoningColumns(null, 'translate').budgetField).toBe(
      'gemini_thinking_budget_translate',
    );
  });
});

/**
 * [FEAT-20260909-DSREASONING] The spine hand-off — the hop that was reverted
 * once and is now paid for.
 *
 * 🔴 THIS IS THE CASE THAT WOULD HAVE CAUGHT THE GAP. For one commit the summary
 *    lane was built end to end and fed by nothing, and every test stayed green:
 *    a lane that is never fed simply never sends the field, which on the wire is
 *    identical to an OA that set nothing. Only asserting the HAND-OFF — that the
 *    args actually carry the resolved value — can tell the two apart.
 *
 * ⚠️ `assistAiFields` exists because the ratchet forbids growing the spine
 *    method, ever. Replacing two lines with one spread made the method smaller
 *    while carrying one more field. If someone later inlines these three fields
 *    back into the spine, the ratchet catches the growth and this file explains
 *    why the indirection was there.
 */
import { assistAiFields } from '@/modules/webhook/assist/assist-ai-fields';

describe('🔴 [DSREASONING] the summary hand-off is actually wired', () => {
  it('⭐ H1 · the resolved setting reaches the assist args', () => {
    const out = assistAiFields({
      aiVendor: 'deepseek',
      aiModel: 'deepseek-chat',
      deepseekReasoning: { type: 'enabled', effort: 'high' },
    });
    expect(out.aiReasoning).toEqual({ type: 'enabled', effort: 'high' });
  });

  it('⭐ H2 · an OA that set nothing hands over null, never undefined', () => {
    /* Null says the lookup ran and found nothing. Undefined cannot be told
       apart from a field nobody wired — which is exactly the ambiguity that hid
       the missing hop for a whole commit. */
    const out = assistAiFields({ aiVendor: null, aiModel: null });
    expect(out.aiReasoning).toBeNull();
    expect('aiReasoning' in out).toBe(true);
  });

  it('H3 · it carries the vendor and model too, so one spread replaces two lines', () => {
    const out = assistAiFields({ aiVendor: 'gemini', aiModel: null });
    expect(out).toEqual({
      aiVendor: 'gemini',
      aiModel: null,
      aiReasoning: null,
    });
  });
});

/**
 * [FEAT-20260909-DSREASONING] The allow-list, and the probe that set it.
 *
 * 🔴 THREE QUESTIONS WERE FIRED AT THE REAL VENDOR ON 09/09, with a real key,
 *    because the documentation could not answer them and guessing was forbidden:
 *
 *      medium accepted?            YES — 200, reasoning_content populated,
 *                                  though the docs list only low/high/max
 *      effort + type:'disabled'?   ACCEPTED and IGNORED — 200, no reasoning
 *                                  content. Not an error, just inert.
 *      deepseek-chat still valid?  YES — it is an alias; the response's own
 *                                  `model` field came back deepseek-v4-flash
 *
 * ⚠️ THE THIRD ANSWER CORRECTED ME, not the code. I had written in the plan that
 *    `deepseek-chat` vanishing from the docs might mean the DeepSeek side was
 *    already broken. The owner said the model id is a per-OA setting and not a
 *    crisis; the probe then showed the id works anyway. Two independent reasons
 *    the alarm was wrong, and neither was visible from the documentation.
 */
import {
  DEEPSEEK_REASONING_EFFORT,
  DEEPSEEK_THINKING,
} from '@/modules/hooks/ai-vendor/parse-ai-vendor';

describe('[DSREASONING] the allow-lists, as the probe left them', () => {
  it('⭐ E1 · four efforts, including the one the docs do not list', () => {
    expect([...DEEPSEEK_REASONING_EFFORT]).toEqual([
      'low',
      'medium',
      'high',
      'max',
    ]);
  });

  it('E2 · two switch values, and neither is a synonym for "unset"', () => {
    expect([...DEEPSEEK_THINKING]).toEqual(['enabled', 'disabled']);
    /* `null` is the third state and it lives outside this list on purpose:
       unset leaves the vendor's own default in force, `disabled` turns thinking
       off. A list of three would make them the same thing. */
    expect(DEEPSEEK_THINKING).not.toContain('none');
  });
});
