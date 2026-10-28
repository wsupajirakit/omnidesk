/**
 * [FEAT-20260908-AIWIRECENSUS] What every AI lane actually puts on the wire.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md §13 SAVE POINT 3
 * ============================================================================
 * WHY THIS EXISTS, AND WHY IT IS NOT A DUPLICATE OF THE BASELINE SPEC.
 * `ai-vendor-wire-baseline.spec.ts` proves ONE lane deeply (the reply ladder,
 * key order, retry branches). This one goes the other way: it drives **all six
 * transports through their real `send()`** and answers a question no single-lane
 * spec can — *do the lanes agree where they must, and differ only where they
 * are supposed to?*
 *
 * That question is the whole point of the consolidation. The bug it guards is
 * not "this lane is wrong", it is "these two lanes drifted apart and both look
 * fine on their own" — which is exactly how `/v1` and `/v1beta` ended up in the
 * same codebase for months without anybody choosing it.
 *
 * 🔴 THE LIVE RUN COULD NOT PROVE THE LANE THAT CHANGED. A real webhook turn was
 *    fired against this build and the reply lane is proven end to end — but the
 *    reply lane was ALREADY on `/v1beta` before any of this work. The lanes whose
 *    base actually moved are **summary and translate**, and the assist hand-off
 *    that would drive summary live only fires when the MODEL chooses to emit
 *    `[[[assist]]]`, which it declined to do across two real turns. Spending more
 *    of the owner's call budget guessing at the model's mood is not proof; this
 *    is. It exercises the same compiled code with the same inputs and reads the
 *    bytes that would have gone to Google, deterministically and for free.
 *
 * ⚠️ NO NETWORK. `axios.post` is replaced per case; nothing leaves the process.
 *    `z-test/lib/no-ai-outbound.ts` is the second net underneath.
 *
 * revert: delete this file. It asserts, and changes, nothing in src.
 */
import axios from 'axios';

import {
  GEMINI_API_BASE,
  DEEPSEEK_CHAT_URL,
} from '../../src/common/ai-endpoints';
import { translateTimeoutMs } from '@/modules/ai-translate/translate-http-timeout';
import { AI_HTTP_TIMEOUT_MS } from '../../src/modules/ai-vendor';
import { GeminiReplyTransport } from '../../src/modules/webhook/ai-vendors/gemini/gemini-reply.transport';
import { DeepSeekReplyTransport } from '../../src/modules/webhook/ai-vendors/deepseek/deepseek-reply.transport';
import { GeminiSummaryTransport } from '../../src/modules/webhook/ai-vendors/gemini/gemini-summary.transport';
import { DeepSeekSummaryTransport } from '../../src/modules/webhook/ai-vendors/deepseek/deepseek-summary.transport';
import { GeminiTranslateTransport } from '../../src/modules/ai-translate/vendors/gemini-translate.transport';
import { DeepSeekTranslateTransport } from '../../src/modules/ai-translate/vendors/deepseek-translate.transport';

interface Captured {
  url: string;
  body: Record<string, unknown>;
  config: Record<string, unknown> | undefined;
}

/**
 * Run one transport and keep the bytes it handed to axios.
 *
 * 🔴 THE BODY IS DEEP-CLONED AT CAPTURE TIME. The reply transport MUTATES the
 *    body it already passed to axios (the 400-on-"think" branch deletes a key and
 *    re-fires). Capturing by reference records the post-retry object and the
 *    census silently reads a request that was never sent.
 */
async function capture(run: () => Promise<unknown>): Promise<Captured[]> {
  const seen: Captured[] = [];
  const spy = jest
    .spyOn(axios, 'post')
    .mockImplementation((url: string, body: unknown, config: unknown) => {
      seen.push({
        url,
        body: JSON.parse(JSON.stringify(body)) as Record<string, unknown>,
        config: config as Record<string, unknown> | undefined,
      });
      /* A shape both readers accept, so `send()` runs to completion and we
         observe the request it makes on the SUCCESS path. */
      return Promise.resolve({
        status: 200,
        data: {
          candidates: [{ content: { parts: [{ text: 'OK' }] } }],
          choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
        },
      });
    });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return seen;
}

/** The nine block kinds the assembler can emit, in the order it emits them. */
const ALL_BLOCK_KINDS = [
  'raw_json',
  'raw_json_rules',
  'site_rules',
  'site_rules_guide',
  'document',
  'history',
  'today',
  'now',
  'question',
] as const;

const replyCall = {
  instruction: 'SYSTEM-INSTRUCTION',
  blocks: ALL_BLOCK_KINDS.map((kind) => ({ kind, text: `TEXT:${kind}` })),
  knobs: { temperature: 0.7, topP: 0.8, topK: 40 },
  thinkingBudget: null,
  apiKey: 'KEY-REPLY',
  modelId: null,
} as never;

const summaryCall = {
  history: 'H1\nH2',
  currentQuestion: 'Q',
  currentAnswer: 'A',
  apiKey: 'KEY-SUMMARY',
  modelId: null,
} as never;

const translateCall = {
  text: 'สวัสดี',
  targetLang: 'en',
  sourceLang: null,
  apiKey: 'KEY-TRANSLATE',
  modelId: null,
} as never;

/** Every lane, driven through its real transport. */
const LANES = [
  {
    id: 'gemini/reply',
    vendor: 'gemini',
    run: () => new GeminiReplyTransport().send(replyCall),
  },
  {
    id: 'gemini/summary',
    vendor: 'gemini',
    run: () => new GeminiSummaryTransport().send(summaryCall),
  },
  {
    id: 'gemini/translate',
    vendor: 'gemini',
    run: () => new GeminiTranslateTransport().send(translateCall),
  },
  {
    id: 'deepseek/reply',
    vendor: 'deepseek',
    run: () => new DeepSeekReplyTransport().send(replyCall),
  },
  {
    id: 'deepseek/summary',
    vendor: 'deepseek',
    run: () => new DeepSeekSummaryTransport().send(summaryCall),
  },
  {
    id: 'deepseek/translate',
    vendor: 'deepseek',
    run: () => new DeepSeekTranslateTransport().send(translateCall),
  },
] as const;

describe('[FEAT-20260908-AIWIRECENSUS] every lane, one census', () => {
  const shots = new Map<string, Captured>();

  beforeAll(async () => {
    for (const lane of LANES) {
      const seen = await capture(lane.run);
      expect(seen).toHaveLength(1); // one request per lane on the success path
      shots.set(lane.id, seen[0]!);
    }
  });

  it('drives all six lanes — an empty census cannot pass silently', () => {
    expect(shots.size).toBe(6);
  });

  it('🔴 EVERY Gemini lane uses THE SAME base — the drift this work removed', () => {
    /* Before: reply `/v1beta`, summary `/v1`, translate `/v1`. Asserted as one
       object so a failure names WHICH lane wandered, not just that one did. */
    const bases = Object.fromEntries(
      LANES.filter((l) => l.vendor === 'gemini').map((l) => [
        l.id,
        shots.get(l.id)!.url.split('/models/')[0],
      ]),
    );
    expect(bases).toEqual({
      'gemini/reply': GEMINI_API_BASE,
      'gemini/summary': GEMINI_API_BASE,
      'gemini/translate': GEMINI_API_BASE,
    });
  });

  it('🔴 every Gemini URL is base + model + :generateContent, and carries NO KEY', () => {
    /* [FEAT-20260908-GEMINIKEYHEADER] This case used to end "+ the raw key" and
       pinned `:generateContent?key=` with the key UNENCODED — a transcribed
       hazard the door preserved deliberately so that encoding it would have to
       be a decision rather than a side effect. The decision was taken: the key
       left the URL entirely. The case is inverted rather than deleted, so it now
       fails the day a credential returns to a Gemini URL. */
    for (const lane of LANES.filter((l) => l.vendor === 'gemini')) {
      const url = shots.get(lane.id)!.url;
      expect(url.startsWith(`${GEMINI_API_BASE}/models/`)).toBe(true);
      expect(url).toContain(':generateContent');
      expect(url).not.toContain('key=');
      expect(url).not.toContain('?');
    }
  });

  it('🔴 every Gemini lane carries the key in the x-goog-api-key HEADER', () => {
    /* The other half of the move. Without this the case above would pass just as
       well for a build that sent no key at all — which is exactly the failure the
       migration was designed to make impossible (the parameter was deleted, not
       ignored, so a missed call site is a compile error). */
    for (const lane of LANES.filter((l) => l.vendor === 'gemini')) {
      const shot = shots.get(lane.id)!;
      const headers = shot.config?.['headers'] as
        { 'x-goog-api-key'?: string } | undefined;
      expect(headers?.['x-goog-api-key']).toMatch(/^KEY-/);
    }
  });

  it('🔴 every DeepSeek lane posts to one fixed URL and carries the key in a HEADER', () => {
    for (const lane of LANES.filter((l) => l.vendor === 'deepseek')) {
      const shot = shots.get(lane.id)!;
      expect(shot.url).toBe(DEEPSEEK_CHAT_URL);
      expect(shot.url).not.toContain('key=');
      const headers = shot.config?.['headers'] as
        { Authorization?: string } | undefined;
      expect(headers?.Authorization).toMatch(/^Bearer KEY-/);
    }
  });

  it('🔴 the two vendors place the MODEL in different places, and both are right', () => {
    /* Gemini: in the URL path. DeepSeek: in the body. This asymmetry is the one
       the adapter design has to survive when vendor #3 arrives. */
    for (const lane of LANES.filter((l) => l.vendor === 'gemini')) {
      expect(shots.get(lane.id)!.body['model']).toBeUndefined();
      expect(shots.get(lane.id)!.url).toContain('/models/gemini-');
    }
    for (const lane of LANES.filter((l) => l.vendor === 'deepseek')) {
      expect(shots.get(lane.id)!.body['model']).toBe('deepseek-v4-flash');
    }
  });

  it('🔴 every lane carries a stall ceiling, and the split between them is deliberate', () => {
    /* [FEAT-20260908-AITIMEOUT] four lanes read the one shared 45s constant.
       [FEAT-20260918-TRANSLATETIMEOUT] the two TRANSLATE lanes read their own 30s,
       because the owner asked for 30 on that path and the two paths are not
       comparable: a translate stall falls back (inbound keeps the customer's
       original, outbound sends the draft as typed), while a reply stall means the
       customer gets nothing — which is why 45s was chosen there and must stay.

       What this case defends is unchanged in spirit: no lane waits forever, and
       no lane drifts to a value NOBODY CHOSE. Before the door,
       `DEEPSEEK_HTTP_TIMEOUT_MS` was declared three times and equal by luck; now
       there are exactly two values, each named, each read from its own constant
       rather than re-typed here. สองเพดาน ตั้งใจให้ต่าง ไม่ใช่หลุดมาเอง */
    const TRANSLATE_LANES = ['gemini/translate', 'deepseek/translate'];

    expect(AI_HTTP_TIMEOUT_MS).toBe(45000);
    expect(translateTimeoutMs()).toBe(30000);
    expect(translateTimeoutMs()).toBeLessThan(AI_HTTP_TIMEOUT_MS);

    for (const lane of LANES) {
      const timeout = shots.get(lane.id)!.config?.['timeout'];
      const expected = TRANSLATE_LANES.includes(lane.id)
        ? translateTimeoutMs()
        : AI_HTTP_TIMEOUT_MS;

      expect(timeout).toBe(expected);
      expect(timeout).toBeGreaterThan(0); // nobody waits forever
    }

    /* and the census still covers both translate lanes — if one were renamed or
       dropped, the list above would silently stop guarding it. */
    expect(LANES.map((l) => l.id)).toEqual(
      expect.arrayContaining(TRANSLATE_LANES),
    );
  });

  it('🔴 ONLY the reply lane sends a system instruction — absent means absent', () => {
    /* The rule the whole extraction rests on. If the door ever "helpfully"
       defaults one, summary and translate bodies change on the wire and this
       goes red. */
    expect(shots.get('gemini/reply')!.body['system_instruction']).toEqual({
      parts: [{ text: 'SYSTEM-INSTRUCTION' }],
    });
    expect(Object.keys(shots.get('gemini/summary')!.body)).not.toContain(
      'system_instruction',
    );
    expect(Object.keys(shots.get('gemini/translate')!.body)).not.toContain(
      'system_instruction',
    );

    const roles = (id: string) =>
      (shots.get(id)!.body['messages'] as { role: string }[]).map(
        (m) => m.role,
      );
    expect(roles('deepseek/reply')).toEqual(['system', 'user']);
    expect(roles('deepseek/summary')).toEqual(['user']);
    expect(roles('deepseek/translate')).toEqual(['user']);
  });

  it('🔴 ONLY the reply lane sends a thinking config', () => {
    const gen = (id: string) =>
      shots.get(id)!.body['generationConfig'] as Record<string, unknown>;
    expect(Object.keys(gen('gemini/reply'))).toContain('thinkingConfig');
    expect(Object.keys(gen('gemini/summary'))).not.toContain('thinkingConfig');
    expect(Object.keys(gen('gemini/translate'))).not.toContain(
      'thinkingConfig',
    );
  });

  it('🔴 the reply lane carries all nine blocks, in the assembler order', () => {
    /* Order is load-bearing data, not presentation: the blocks are the prompt.
       One part per block for Gemini; DeepSeek has no multi-part message and
       joins them with a blank line — that join is a documented adapter decision
       and is asserted, not assumed. */
    const parts = (
      shots.get('gemini/reply')!.body['contents'] as {
        parts: { text: string }[];
      }[]
    )[0]!.parts.map((p) => p.text);
    expect(parts).toEqual(ALL_BLOCK_KINDS.map((k) => `TEXT:${k}`));

    const messages = shots.get('deepseek/reply')!.body['messages'] as {
      role: string;
      content: string;
    }[];
    expect(messages[1]!.content).toBe(
      ALL_BLOCK_KINDS.map((k) => `TEXT:${k}`).join('\n\n'),
    );
  });

  it('🔴 knob values are per-lane decisions, and each lane keeps its own', () => {
    /* Reply forwards the hook's knobs; summary and translate pin 0.1/0.1/1.
       Consolidating the transports must NOT have averaged them. */
    expect(shots.get('gemini/reply')!.body['generationConfig']).toMatchObject({
      temperature: 0.7,
      topP: 0.8,
      topK: 40,
    });
    for (const id of ['gemini/summary', 'gemini/translate']) {
      expect(shots.get(id)!.body['generationConfig']).toMatchObject({
        temperature: 0.1,
        topP: 0.1,
        topK: 1,
      });
    }
    /* DeepSeek has no topK field at all — the knob is dropped with a notice. */
    for (const id of ['deepseek/summary', 'deepseek/translate']) {
      expect(shots.get(id)!.body).toMatchObject({
        temperature: 0.1,
        top_p: 0.1,
      });
      expect(Object.keys(shots.get(id)!.body)).not.toContain('top_k');
    }
    expect(Object.keys(shots.get('deepseek/reply')!.body)).not.toContain(
      'top_k',
    );
  });

  it('🔴 each lane sends a DIFFERENT prompt, and none leaks into another', () => {
    /* The prompts stay with their features by design. This asserts the design
       held: the reply blocks must not appear in a summary or translate body, and
       the summary and translate prompts must differ from each other. */
    const text = (id: string) => JSON.stringify(shots.get(id)!.body);

    for (const id of ['gemini/summary', 'gemini/translate']) {
      expect(text(id)).not.toContain('TEXT:raw_json_rules');
      expect(text(id)).not.toContain('SYSTEM-INSTRUCTION');
    }
    // the summary lane carries the conversation it was asked to summarise
    expect(text('gemini/summary')).toContain('H1');
    expect(text('deepseek/summary')).toContain('H1');
    // the translate lane carries the text and the target language
    expect(text('gemini/translate')).toContain('สวัสดี');
    expect(text('deepseek/translate')).toContain('สวัสดี');
    // and they are not the same prompt
    expect(text('gemini/summary')).not.toBe(text('gemini/translate'));
  });

  it('🔴 the body key ORDER is stable per vendor', () => {
    /* Not semantically meaningful to the vendor — but a diff here means somebody
       rebuilt a body from memory instead of moving it, which is the exact class
       of change this consolidation exists to make visible. */
    expect(Object.keys(shots.get('gemini/reply')!.body)).toEqual([
      'system_instruction',
      'contents',
      'generationConfig',
    ]);
    for (const id of ['gemini/summary', 'gemini/translate']) {
      expect(Object.keys(shots.get(id)!.body)).toEqual([
        'contents',
        'generationConfig',
      ]);
    }
    for (const id of [
      'deepseek/reply',
      'deepseek/summary',
      'deepseek/translate',
    ]) {
      expect(Object.keys(shots.get(id)!.body)).toEqual([
        'model',
        'messages',
        'temperature',
        'top_p',
      ]);
    }
  });
});
