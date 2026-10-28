import {
  ForbiddenAiCallError,
  installAiOutboundGuard,
} from '../lib/no-ai-outbound';

/**
 * [TEST-20260813-P2-GUARD] The outbound guard must block DeepSeek too.
 *
 * P2 adds a second vendor; the guard listed only Google/OpenAI hosts,
 * so a spec that forgot to stub the HTTP client would have billed a real
 * DeepSeek account. This spec is written and shipped BEFORE any DeepSeek
 * transport exists — the ordering is the point.
 *
 * revert: drop the `api.deepseek.com` pattern in z-test/lib/no-ai-outbound.ts
 *         and this file.
 */
describe('[P2 GUARD] no-ai-outbound covers DeepSeek', () => {
  beforeEach(() => installAiOutboundGuard());

  it('throws on the DeepSeek chat endpoint', () => {
    expect(() =>
      globalThis.fetch('https://api.deepseek.com/chat/completions'),
    ).toThrow(ForbiddenAiCallError);
  });

  it('throws regardless of case or path (matched on the whole URL)', () => {
    expect(() => globalThis.fetch('https://API.DeepSeek.com/models')).toThrow(
      ForbiddenAiCallError,
    );
  });

  it('still blocks the Gemini hosts it always did', () => {
    expect(() =>
      globalThis.fetch('https://generativelanguage.googleapis.com/v1/models'),
    ).toThrow(ForbiddenAiCallError);
  });

  it('leaves an unrelated host alone (the guard is a filter, not a wall)', () => {
    // ⚠️ Do NOT actually call fetch here: the guard delegates to the real one,
    // and an unhandled rejection from a dead host kills the whole jest process
    // (learned the hard way — it took the entire suite down). Assert the guard
    // DECISION instead, by giving it a fetch we control.
    const original = globalThis.fetch;
    let delegated = '';
    globalThis.fetch = (input: unknown) => {
      delegated = String(input);
      return Promise.resolve(new Response('ok'));
    };
    installAiOutboundGuard(); // wraps the stub above
    try {
      void globalThis.fetch('https://example.test/nothing');
      expect(delegated).toBe('https://example.test/nothing');
    } finally {
      globalThis.fetch = original;
    }
  });
});
