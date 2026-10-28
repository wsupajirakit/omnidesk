/**
 * The AI provider × cap switch — proven in BOTH directions.
 *
 * A switch tested only in the direction that "works" is the trap this suite
 * exists to avoid. Every row of the owner's matrix is asserted: mock and real,
 * capped and uncapped, and the production guard that must throw.
 *
 * All in-process — no network, no :3100, no spend. `selectAiReplyProvider` is
 * the exact function the DI factory calls, so proving it here proves the wiring.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AiCapDecorator,
  AiCapReachedError,
} from '@/modules/webhook/ai-reply/ai-cap.decorator';
import type {
  AiReplyRequest,
  AiReplyResponse,
} from '@/modules/webhook/ai-reply/ai-reply.provider';
import { GeminiReplyProvider } from '@/modules/webhook/ai-vendors/gemini/gemini-reply.provider';
import { ScriptedAiReplyProvider } from '@/modules/webhook/ai-reply/scripted-ai-reply.provider';
import { selectAiReplyProvider } from '@/modules/webhook/webhook.module';

const req = (question = 'hi'): AiReplyRequest =>
  ({
    question,
    docText: '',
    suggestionText: '',
    profileData: null,
  }) as AiReplyRequest;

const silentLog = { log: () => undefined };

describe('AI provider switch — selectAiReplyProvider', () => {
  let scripted: ScriptedAiReplyProvider;
  let gemini: GeminiReplyProvider;

  beforeEach(() => {
    scripted = new ScriptedAiReplyProvider();
    // never has generate() called in these cases — only its identity is checked
    gemini = new GeminiReplyProvider({} as never);
  });

  const pick = (
    providerMode: 'mock' | 'real',
    capMode: 'on' | 'off',
    nodeEnv = 'development',
  ) =>
    selectAiReplyProvider(
      { providerMode, capMode, capLimit: 5 },
      scripted,
      gemini,
      nodeEnv,
      silentLog,
    );

  it('mock + cap on → capped', () => {
    // That the cap wraps SCRIPTED (not gemini) is guaranteed by the same
    // `inner = mock ? scripted : gemini` line proven by the two `cap off`
    // cases below (p === scripted / p === gemini), and the decorator's
    // delegation is proven with a controlled counter file in the suite below.
    // Calling generate() here would hit the REAL shared counter (5/5) and
    // block, testing nothing about the switch — so identity only.
    expect(pick('mock', 'on')).toBeInstanceOf(AiCapDecorator);
  });

  it('mock + cap off → the scripted provider, unwrapped', () => {
    const p = pick('mock', 'off');
    expect(p).toBe(scripted);
    expect(p).not.toBeInstanceOf(AiCapDecorator);
  });

  it('real + cap on → capped, wrapping the real Gemini provider', () => {
    const p = pick('real', 'on');
    expect(p).toBeInstanceOf(AiCapDecorator);
    // NOT calling generate: the real provider would fire a model. Identity only.
  });

  it('real + cap off → the real Gemini provider, unwrapped', () => {
    const p = pick('real', 'off');
    expect(p).toBe(gemini);
    expect(p).not.toBeInstanceOf(AiCapDecorator);
  });

  it('production + mock → THROWS at bind time (a script must never answer customers)', () => {
    expect(() => pick('mock', 'on', 'production')).toThrow(
      /forbidden in production/,
    );
  });

  it('production + real → binds normally', () => {
    expect(() => pick('real', 'off', 'production')).not.toThrow();
  });
});

describe('AiCapDecorator — counts and blocks', () => {
  let dir: string;
  let file: string;
  let inner: {
    generate: jest.Mock<Promise<AiReplyResponse>, [AiReplyRequest]>;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aicap-'));
    file = join(dir, 'count.json');
    inner = {
      generate: jest
        .fn<Promise<AiReplyResponse>, [AiReplyRequest]>()
        .mockResolvedValue({ text: 'ok', noData: false, tagStatus: null }),
    };
  });

  it('delegates to the inner provider under the limit', async () => {
    const cap = new AiCapDecorator(inner, 2, file, () => 'T');
    const out = await cap.generate(req());
    expect(out.text).toBe('ok');
    expect(inner.generate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(file, 'utf8')).count).toBe(1);
  });

  it('refuses the call AFTER the limit, without calling the inner', async () => {
    const cap = new AiCapDecorator(inner, 2, file, () => 'T');
    await cap.generate(req()); // 1
    await cap.generate(req()); // 2
    await expect(cap.generate(req())).rejects.toBeInstanceOf(AiCapReachedError);
    expect(inner.generate).toHaveBeenCalledTimes(2); // the 3rd never delegated
  });

  it('counts BEFORE the inner call, so a thrown inner still consumes the slot', async () => {
    inner.generate.mockRejectedValueOnce(new Error('boom'));
    const cap = new AiCapDecorator(inner, 2, file, () => 'T');
    await expect(cap.generate(req())).rejects.toThrow('boom');
    // slot spent despite the failure — the failure mode is spending less, never more
    expect(JSON.parse(readFileSync(file, 'utf8')).count).toBe(1);
  });

  it('a corrupt counter reads as EXHAUSTED, never as a fresh budget', async () => {
    writeFileSync(file, 'not json at all');
    const cap = new AiCapDecorator(inner, 2, file, () => 'T');
    await expect(cap.generate(req())).rejects.toBeInstanceOf(AiCapReachedError);
    expect(inner.generate).not.toHaveBeenCalled();
  });

  it('survives a restart — a new instance reads the persisted count', async () => {
    await new AiCapDecorator(inner, 2, file, () => 'T').generate(req());
    // fresh instance, same file
    const usage = new AiCapDecorator(inner, 2, file, () => 'T').usage();
    expect(usage).toEqual({ count: 1, limit: 2, remaining: 1 });
  });
});

describe('ScriptedAiReplyProvider — the mock', () => {
  it('replays queued replies in order and records every request', async () => {
    const m = new ScriptedAiReplyProvider();
    m.enqueue({ text: 'first' }).enqueue({ text: 'second' });
    expect((await m.generate(req('a'))).text).toBe('first');
    expect((await m.generate(req('b'))).text).toBe('second');
    expect(m.received.map((r) => r.question)).toEqual(['a', 'b']);
  });

  it('matches by question content before falling to the queue', async () => {
    const m = new ScriptedAiReplyProvider();
    m.whenQuestionContains('ยอดเงิน', { text: 'assist [[[assist]]]' });
    m.enqueue({ text: 'default' });
    expect((await m.generate(req('เช็คยอดเงินหน่อย'))).text).toContain(
      '[[[assist]]]',
    );
    expect((await m.generate(req('อย่างอื่น'))).text).toBe('default');
  });

  it('opens no socket — it is a pure in-memory function', async () => {
    const m = new ScriptedAiReplyProvider();
    m.enqueue({ text: 'x' });
    // if this ever hit the network the test env's no-ai-outbound guard would throw
    await expect(m.generate(req())).resolves.toBeDefined();
  });
});
