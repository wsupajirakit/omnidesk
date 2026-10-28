/**
 * [FIX-20260818-VENDORKEYPROBE] plan §7.4 — a key is checked against its own vendor
 *
 * The write path used to send every `custom_ai_key` to Google regardless of the
 * hook's `ai_vendor`: a DeepSeek key was handed to Google, rejected, and the save
 * failed — so a DeepSeek key could not be stored at all, and one vendor's
 * credential travelled to another on the way in.
 *
 * ⚠️ NOTHING HERE TOUCHES THE NETWORK. These are pure assertions on the built
 * probe. The suite loads `no-ai-outbound`, and a key check is exactly the kind of
 * call that guard exists to stop.
 *
 * The Gemini rows are the ones that matter most: every key stored today is a
 * Gemini key, so that request must stay byte-identical to what shipped before.
 */
import { buildAiKeyProbe, AI_VENDORS } from '@/modules/hooks';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1/models';

describe('[VENDORKEYPROBE] gemini — unchanged from what shipped', () => {
  it('⭐ key rides in the query string, on the same endpoint, with no headers', () => {
    const probe = buildAiKeyProbe('abc123', 'gemini');
    expect(probe.url).toBe(`${GEMINI_URL}?key=abc123`);
    expect(probe.headers).toEqual({});
  });

  it('encodes a key that needs escaping, exactly as before', () => {
    expect(buildAiKeyProbe('a b/c+d', 'gemini').url).toBe(
      `${GEMINI_URL}?key=${encodeURIComponent('a b/c+d')}`,
    );
  });

  it('a failed gemini probe REJECTS the key — that answer is trusted', () => {
    expect(buildAiKeyProbe('abc123', 'gemini').rejectOnFailure).toBe(true);
  });

  it.each([null, undefined, '', '   ', 'not-a-vendor'])(
    'vendor %p falls back to gemini (same state the transport registry defaults to)',
    (vendor) => {
      const probe = buildAiKeyProbe('abc123', vendor);
      expect(probe.url).toBe(`${GEMINI_URL}?key=abc123`);
    },
  );
});

describe('[VENDORKEYPROBE] deepseek — its own endpoint, and never a paid call', () => {
  it("⭐ goes to DeepSeek's host, not Google's", () => {
    const probe = buildAiKeyProbe('sk-deepseek', 'deepseek');
    expect(probe.url).toContain('api.deepseek.com');
    expect(probe.url).not.toContain('googleapis.com');
  });

  it('⭐ the key rides in an Authorization header, never in the URL', () => {
    const probe = buildAiKeyProbe('sk-deepseek', 'deepseek');
    expect(probe.headers['Authorization']).toBe('Bearer sk-deepseek');
    expect(probe.url).not.toContain('sk-deepseek');
  });

  it('probes a model LIST — a chat completion would be a billed inference call', () => {
    expect(buildAiKeyProbe('sk', 'deepseek').url).not.toContain('completions');
  });

  it('⭐ a failed deepseek probe must NOT reject the key', () => {
    // We have never made this call for real, so its failure is not evidence the
    // key is bad. Rejecting on it would make a working key unsaveable — the very
    // bug this change removes.
    expect(buildAiKeyProbe('sk', 'deepseek').rejectOnFailure).toBe(false);
  });
});

describe('[VENDORKEYPROBE] the table covers every declared vendor', () => {
  it('⭐ every name in AI_VENDORS builds a probe (adding one without an entry fails the build)', () => {
    for (const vendor of AI_VENDORS) {
      const probe = buildAiKeyProbe('k', vendor);
      expect(probe.url).toMatch(/^https:\/\//);
      expect(typeof probe.rejectOnFailure).toBe('boolean');
    }
  });

  it('no vendor leaks its key to another vendor host', () => {
    const hosts = AI_VENDORS.map(
      (v) => new URL(buildAiKeyProbe('k', v).url).host,
    );
    expect(new Set(hosts).size).toBe(AI_VENDORS.length);
  });
});
