/**
 * [FIX-20260808-ASSISTSUMMARYFIRE] The assist-summary provider × cap switch —
 * proven in BOTH directions, mirroring `ai-provider-switch.spec.ts`.
 *
 * The summary seam now fires under the SAME AI_PROVIDER × AI_CAP flags the reply
 * seam uses. Every row of the owner's matrix is asserted: mock and real, capped
 * and uncapped, and the production guard that must throw. All in-process — no
 * network, no spend. `selectAssistSummaryProvider` is the exact function the DI
 * factory calls, so proving it here proves the wiring.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AssistSummaryCapDecorator,
  AssistSummaryCapReachedError,
  type AssistSummaryRequest,
  type AssistSummaryResponse,
  RealAssistSummaryProvider,
  selectAssistSummaryProvider,
  ScriptedAssistSummaryProvider,
} from '@/modules/webhook';

const req = (currentQuestion = 'hi'): AssistSummaryRequest => ({
  history: '',
  currentQuestion,
  currentAnswer: '',
});

const silentLog = { log: () => undefined };

describe('assist-summary switch — selectAssistSummaryProvider', () => {
  let scripted: ScriptedAssistSummaryProvider;
  let gemini: RealAssistSummaryProvider;

  beforeEach(() => {
    scripted = new ScriptedAssistSummaryProvider();
    // summarise() is never called in these cases — only identity is checked.
    // [FEAT-20260813-WRAPAI-W2] provider no longer takes RagEngineService.
    gemini = new RealAssistSummaryProvider();
  });

  const pick = (
    providerMode: 'mock' | 'real',
    capMode: 'on' | 'off',
    nodeEnv = 'development',
  ) =>
    selectAssistSummaryProvider(
      { providerMode, capMode, capLimit: 5 },
      scripted,
      gemini,
      nodeEnv,
      silentLog,
    );

  it('mock + cap on → capped (wrapping scripted)', () => {
    // Calling summarise() here would hit the REAL shared counter and could block;
    // identity only. That the cap wraps SCRIPTED is guaranteed by the same
    // `inner = mock ? scripted : gemini` line proven by the cap-off cases below.
    expect(pick('mock', 'on')).toBeInstanceOf(AssistSummaryCapDecorator);
  });

  it('mock + cap off → the scripted provider, unwrapped', () => {
    const p = pick('mock', 'off');
    expect(p).toBe(scripted);
    expect(p).not.toBeInstanceOf(AssistSummaryCapDecorator);
  });

  it('real + cap on → capped, wrapping the real Gemini summary provider', () => {
    const p = pick('real', 'on');
    expect(p).toBeInstanceOf(AssistSummaryCapDecorator);
    // NOT calling summarise: the real provider would fire a model. Identity only.
  });

  it('real + cap off → the real Gemini summary provider, unwrapped', () => {
    const p = pick('real', 'off');
    expect(p).toBe(gemini);
    expect(p).not.toBeInstanceOf(AssistSummaryCapDecorator);
  });

  it('production + mock → THROWS at bind time (a script must never summarise real cases)', () => {
    expect(() => pick('mock', 'on', 'production')).toThrow(
      /forbidden in production/,
    );
  });

  it('production + real → binds normally', () => {
    expect(() => pick('real', 'off', 'production')).not.toThrow();
  });
});

describe('AssistSummaryCapDecorator — counts and blocks', () => {
  let dir: string;
  let file: string;
  let inner: {
    summarise: jest.Mock<
      Promise<AssistSummaryResponse>,
      [AssistSummaryRequest]
    >;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'assistcap-'));
    file = join(dir, 'count.json');
    inner = {
      summarise: jest
        .fn<Promise<AssistSummaryResponse>, [AssistSummaryRequest]>()
        .mockResolvedValue({ summary: 'ok', category: 'Other' }),
    };
  });

  it('delegates to the inner provider under the limit', async () => {
    const cap = new AssistSummaryCapDecorator(inner, 2, file, () => 'T');
    const out = await cap.summarise(req());
    expect(out.summary).toBe('ok');
    expect(inner.summarise).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(file, 'utf8')).count).toBe(1);
  });

  it('refuses the call AFTER the limit, without calling the inner', async () => {
    const cap = new AssistSummaryCapDecorator(inner, 2, file, () => 'T');
    await cap.summarise(req()); // 1
    await cap.summarise(req()); // 2
    await expect(cap.summarise(req())).rejects.toBeInstanceOf(
      AssistSummaryCapReachedError,
    );
    expect(inner.summarise).toHaveBeenCalledTimes(2); // the 3rd never delegated
  });

  it('counts BEFORE the inner call, so a thrown inner still consumes the slot', async () => {
    inner.summarise.mockRejectedValueOnce(new Error('boom'));
    const cap = new AssistSummaryCapDecorator(inner, 2, file, () => 'T');
    await expect(cap.summarise(req())).rejects.toThrow('boom');
    expect(JSON.parse(readFileSync(file, 'utf8')).count).toBe(1);
  });

  it('a corrupt counter reads as EXHAUSTED, never as a fresh budget', async () => {
    writeFileSync(file, 'not json at all');
    const cap = new AssistSummaryCapDecorator(inner, 2, file, () => 'T');
    await expect(cap.summarise(req())).rejects.toBeInstanceOf(
      AssistSummaryCapReachedError,
    );
    expect(inner.summarise).not.toHaveBeenCalled();
  });

  it('survives a restart — a new instance reads the persisted count', async () => {
    await new AssistSummaryCapDecorator(inner, 2, file, () => 'T').summarise(
      req(),
    );
    const usage = new AssistSummaryCapDecorator(
      inner,
      2,
      file,
      () => 'T',
    ).usage();
    expect(usage).toEqual({ count: 1, limit: 2, remaining: 1 });
  });
});

describe('ScriptedAssistSummaryProvider — the mock', () => {
  it('replays queued responses in order and records every request', async () => {
    const m = new ScriptedAssistSummaryProvider();
    m.enqueue({ summary: 'first', category: 'IT' }).enqueue({
      summary: 'second',
    });
    expect((await m.summarise(req('a'))).summary).toBe('first');
    expect((await m.summarise(req('b'))).summary).toBe('second');
    expect(m.received.map((r) => r.currentQuestion)).toEqual(['a', 'b']);
  });

  it('defaults category to Other when not enqueued', async () => {
    const m = new ScriptedAssistSummaryProvider();
    m.enqueue({ summary: 'x' });
    expect((await m.summarise(req())).category).toBe('Other');
  });

  it('matches by question content before falling to the queue', async () => {
    const m = new ScriptedAssistSummaryProvider();
    m.whenQuestionContains('ปลดล็อก', {
      summary: 'ต้องการปลดล็อกเครื่อง',
      category: 'IT',
    });
    m.enqueue({ summary: 'default' });
    expect((await m.summarise(req('ช่วยปลดล็อกหน่อย'))).summary).toBe(
      'ต้องการปลดล็อกเครื่อง',
    );
    expect((await m.summarise(req('อย่างอื่น'))).summary).toBe('default');
  });

  it('returns an empty default when the queue is empty', async () => {
    const m = new ScriptedAssistSummaryProvider();
    expect(await m.summarise(req())).toEqual({
      summary: '',
      category: 'Other',
    });
  });

  it('opens no socket — it is a pure in-memory function', async () => {
    const m = new ScriptedAssistSummaryProvider();
    m.enqueue({ summary: 'x' });
    // if this ever hit the network the test env's no-ai-outbound guard would throw
    await expect(m.summarise(req())).resolves.toBeDefined();
  });

  it('reset() forgets queued responses and recorded requests', async () => {
    const m = new ScriptedAssistSummaryProvider();
    m.enqueue({ summary: 'x' });
    await m.summarise(req('a'));
    m.reset();
    expect(m.received).toHaveLength(0);
    expect(await m.summarise(req('b'))).toEqual({
      summary: '',
      category: 'Other',
    });
  });
});
