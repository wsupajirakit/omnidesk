/* [FEAT-20261016-DOC60K] the SERVER's limit, mirrored (omnidesk-api `hooks/hook-write.helpers.ts`
   SUGGESTION_TEXT_MAX_LENGTH — one value for both sites, owner 16/10). It was 100,000 here while the
   server refused above 50,000/60,000, so a long doc passed the form and failed on save.
   `test/trainingDocLimit.value.test.ts` reads the server's number and goes red if they part. */
export const SUGGESTION_TEXT_MAX_LENGTH = 60000;

/**
 * Trims and enforces the maximum character limit for suggestion_text.
 * Ensures the field is required and within length limits.
 * Returns the trimmed string when valid.
 */
export const normalizeSuggestionText = (value?: string | null): string => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    throw new Error('Suggestion text is required and cannot be empty.');
  }
  if (trimmed.length > SUGGESTION_TEXT_MAX_LENGTH) {
    throw new Error(`Suggestion text must be ${SUGGESTION_TEXT_MAX_LENGTH} characters or fewer.`);
  }
  return trimmed;
};
