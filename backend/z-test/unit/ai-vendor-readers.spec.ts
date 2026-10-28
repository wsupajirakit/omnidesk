/**
 * [FEAT-20260907-AIVENDORCORE] The two response readers, and the guards a naive
 * version drops.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md
 *
 * WHY THIS FILE EXISTS. While moving the DeepSeek reader into the shared door,
 * the first draft walked straight to `choices[0].message.content` — dropping two
 * guards that both existing readers carried. **No test in the repo failed.**
 * The filtered-turn case had never been covered anywhere, so the weakening would
 * have shipped behind a green suite and reached customers as "whatever the
 * content filter left behind".
 *
 * Caught by reading the callers before replacing them. Pinned here so the next
 * person does not have to be as lucky.
 */
import { readDeepSeekText, readGeminiText } from '../../src/modules/ai-vendor';

describe('[FEAT-20260907-AIVENDORCORE] readGeminiText', () => {
  it('returns the first candidate part', () => {
    expect(
      readGeminiText({
        candidates: [{ content: { parts: [{ text: 'hi' }] } }],
      }),
    ).toBe('hi');
  });

  it.each([
    ['no data', undefined],
    ['null', null],
    ['no candidates', {}],
    ['empty candidates', { candidates: [] }],
    ['no content', { candidates: [{}] }],
    ['no parts', { candidates: [{ content: {} }] }],
    ['empty parts', { candidates: [{ content: { parts: [] } }] }],
  ])('answers undefined for %s', (_l, data) => {
    expect(readGeminiText(data)).toBeUndefined();
  });
});

describe('[FEAT-20260907-AIVENDORCORE] readDeepSeekText', () => {
  it('returns the first choice message content', () => {
    expect(
      readDeepSeekText({ choices: [{ message: { content: 'hi' } }] }),
    ).toBe('hi');
  });

  it('🔴 a CONTENT-FILTERED turn is not an answer, even though a choice is present', () => {
    /* The guard the naive version dropped. A filtered turn answers 200 with a
       populated choice; reading it would send the customer the remains. */
    expect(
      readDeepSeekText({
        choices: [
          { finish_reason: 'content_filter', message: { content: 'partial…' } },
        ],
      }),
    ).toBeUndefined();
  });

  it('🔴 `content: null` is not an answer — the type says string, the wire says null', () => {
    /* This data came from `unknown`; the declared type cannot be trusted. Both
       interpreters gate on `rawText === undefined`, so returning null would slip
       past that gate and survive downstream only by `||` truthiness. */
    expect(
      /* `null`, not `undefined` — the wire shape the declared type denies. Cast at
         the VALUE so the assertion stays honest about what arrives. */
      readDeepSeekText({
        choices: [{ message: { content: null as unknown as string } }],
      }),
    ).toBeUndefined();
  });

  it('🔴 an EMPTY string is not an answer either', () => {
    expect(
      readDeepSeekText({ choices: [{ message: { content: '' } }] }),
    ).toBeUndefined();
  });

  it('a normal finish_reason does not block the answer', () => {
    expect(
      readDeepSeekText({
        choices: [{ finish_reason: 'stop', message: { content: 'hi' } }],
      }),
    ).toBe('hi');
  });

  it.each([
    ['no data', undefined],
    ['no choices', {}],
    ['empty choices', { choices: [] }],
    ['no message', { choices: [{}] }],
  ])('answers undefined for %s', (_l, data) => {
    expect(readDeepSeekText(data)).toBeUndefined();
  });
});
