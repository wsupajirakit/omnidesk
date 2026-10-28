/**
 * ⚠️ [HOTFIX-20260826-THINK36] ค่าที่ตรึงไว้ในไฟล์นี้ถูก **พลิก** เมื่อ 26/08/2026
 * ---------------------------------------------------------------------------
 * ก้อน `thinkingConfig` บนสายเปลี่ยนจาก `{"thinkingBudget":0}` เป็น
 * `{"thinkingLevel":"minimal"}` สำหรับกรณี "ปิดความคิด" บนโมเดล Gemini 3
 *
 * เหตุผล (วัดจากของจริง ไม่ใช่จากเอกสาร): `gemini-3.6-flash` **ตอบ 400
 * INVALID_ARGUMENT** เมื่อได้รับ `thinkingBudget: 0` และ error ที่ส่งกลับมาไม่มี
 * คำว่า "think" ⇒ ตาข่ายกู้ชีพ (`em.includes('think')`) ไม่ติด ⇒ ลูกค้าไม่ได้
 * คำตอบเลย · 24 จาก 29 hook ตั้งค่า "ปิด" ไว้ ⇒ สลับรุ่นเมื่อไหร่ตายพร้อมกัน 24 ตัว
 * `thinkingLevel:"minimal"` ให้ผลเท่ากันเป๊ะบน 3.5 (ไม่มี thoughtsTokenCount =
 * ไม่คิดเลย) และใช้ได้บน 3.6 ด้วย — ยิงยืนยันรุ่นละ 2 รอบ ผ่านทั้ง 4
 *
 * ผู้ตัดสิน: เจ้าของ 26/08 — *"สรุปใช้ minimal ทั้งสองนะ"*
 * รายละเอียดครบ: `src/modules/webhook/ai-vendors/gemini/thinking-config.ts`
 *
 * 🔴 เคสเดิม**ไม่ถูกลบ** แค่พลิกค่าที่คาดหวัง — ถ้าวันหลังใครทำให้สายกลับไปส่ง
 *    `thinkingBudget: 0` บน Gemini 3 เคสพวกนี้จะแดงทันที ซึ่งคือหน้าที่ของมัน
 */
/**
 * [WRAP-AI W1b] GeminiReplyTransport + the registry (the DeepSeek insertion point).
 *
 * Proves:
 *   · the transport turns a NeutralReplyCall into the SAME wire body askGemini
 *     sends — byte-equal against the W0 pack (via the assembler, end to end).
 *   · the 400 thinking-retry re-fires once without thinkingConfig.
 *   · a vendor error becomes a vendor-free TransportResult (no throw).
 *   · the registry resolves 'gemini', defaults an unknown provider, and does NOT
 *     let a vendor word escape the transport file (the "no hard gemini" rule).
 *
 * ⚠️ NO NETWORK. axios.post is spied and refuses/arms per test; `no-ai-outbound`
 *    still guards the process.
 */
import axios from 'axios';
import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GeminiReplyTransport } from '@/modules/webhook/ai-vendors/gemini/gemini-reply.transport';
import {
  REPLY_TRANSPORTS,
  DEFAULT_REPLY_PROVIDER,
  resolveReplyTransport,
} from '@/modules/webhook/ai-reply/reply-transport.registry';
import { assembleReply } from '@/modules/webhook/ai-reply/reply-prompt-assembler';
import type { AiReplyRequest } from '@/modules/webhook/ai-reply/ai-reply.provider';
import type { NeutralReplyCall } from '@/modules/webhook/ai-reply/reply-neutral';

// ── HTTP capture (same discipline as W0) ───────────────────────────────────
type HttpArgs = unknown[];
const posts: Array<{ url: string; body: unknown; config?: unknown }> = [];
const httpPost = jest.fn(
  (...args: HttpArgs): Promise<{ status: number; data: unknown }> => {
    posts.push({
      url: String(args[0]),
      body: JSON.parse(JSON.stringify(args[1])),
      config: args[2],
    });
    return Promise.reject(new Error('[W1b] no response armed'));
  },
);
jest
  .spyOn(axios, 'post')
  .mockImplementation((...a: HttpArgs) => httpPost(...a));
globalThis.fetch = () => Promise.reject(new Error('[W1b] fetch blocked'));

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
beforeEach(() => {
  posts.length = 0;
  httpPost.mockClear();
});

const OK = {
  candidates: [{ content: { parts: [{ text: 'answer [[[FOUND]]]' }] } }],
};
function armOnce(data: unknown) {
  httpPost.mockImplementationOnce((...args: HttpArgs) => {
    posts.push({
      url: String(args[0]),
      body: JSON.parse(JSON.stringify(args[1])),
      config: args[2],
    });
    return Promise.resolve({ status: 200, data });
  });
}

// deterministic env
const savedEnv: Record<string, string | undefined> = {};
const ENV = ['MODEL_ID', 'GEMINI_TEMPERATURE', 'GEMINI_TOP_P', 'GEMINI_TOP_K'];
beforeAll(() => {
  for (const k of ENV) savedEnv[k] = process.env[k];
  process.env['MODEL_ID'] = 'gemini-3.5-flash';
  for (const k of ['GEMINI_TEMPERATURE', 'GEMINI_TOP_P', 'GEMINI_TOP_K'])
    delete process.env[k];
});
afterAll(() => {
  for (const k of ENV)
    savedEnv[k] === undefined
      ? delete process.env[k]
      : (process.env[k] = savedEnv[k]!);
});

function req(over: Partial<AiReplyRequest> = {}): AiReplyRequest {
  return {
    question: 'ยอดหนี้เท่าไหร่',
    docText: '',
    suggestionText: '',
    profileData: null,
    temperature: 0.4,
    topK: 20,
    topP: 0.4,
    thinkingBudget: null,
    hookId: 'hook-1',
    hookGroupId: 'grp-1',
    sendRawJson: false,
    rawJsonRules: '',
    sendSiteRules: false,
    siteRulesGuide: '',
    dictOpts: { tool: null, scope: null },
    apiKey: 'unit-test-key-not-real',
    ...over,
  };
}
function callFor(over: Partial<AiReplyRequest>): NeutralReplyCall {
  const a = assembleReply({
    request: req(over),
    substitutedSuggestion: (over.suggestionText as string) ?? '',
  });
  if (a.kind !== 'call') throw new Error('expected call');
  return a.call;
}

// ── W0 body reader (shared shape with the W1a spec) ─────────────────────────
function w0Body(title: string): string {
  const snap = readFileSync(
    join(__dirname, '__snapshots__', 'wrap-ai-w0-before-pack.spec.ts.snap'),
    'utf8',
  );
  const at = snap.indexOf(
    `wire snapshots — the frozen matrix (B-W1) ${title} 1`,
  );
  if (at < 0) throw new Error(`W0 scenario not found: ${title}`);
  const seg = snap.slice(at, at + 6000);
  const start = seg.indexOf('"body": "') + '"body": "'.length;
  const end = seg.indexOf('}}",', start) + 2;
  return seg
    .slice(start, end)
    .replace(/\\\\n/g, '\\n')
    .replace(/\\\\"/g, '\\"');
}

describe('[WRAP-AI W1b] transport wire body is byte-equal to the W0 record', () => {
  it('plain question', async () => {
    armOnce(OK);
    await new GeminiReplyTransport().send(callFor({}));
    expect(JSON.stringify(posts[0]!.body)).toBe(w0Body('plain question'));
  });

  it('all blocks on together — same bytes, same order', async () => {
    armOnce(OK);
    await new GeminiReplyTransport().send(
      callFor({
        docText: 'doc',
        sendRawJson: true,
        rawJsonRules: 'json rules',
        sendSiteRules: true,
        siteRulesGuide: 'site guide',
        profileData: {
          'Path : api/v1/customer': { data: { name: 'x' } },
          SITE_RULES: { role: 'site_rules', data: { min_deposit: 100 } },
        },
      }),
    );
    expect(JSON.stringify(posts[0]!.body)).toBe(
      w0Body('all blocks on together (proves block ORDER)'),
    );
  });

  it('url carries the model; the key rides a header, not the query', async () => {
    /* [FEAT-20260908-GEMINIKEYHEADER] this pinned legacy parity — "unencoded key"
       on the query string. The key left the URL; both halves are asserted so the
       case cannot pass on a build that simply stopped sending a key. */
    armOnce(OK);
    await new GeminiReplyTransport().send(callFor({ apiKey: 'K123' }));
    expect(posts[0]!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
    );
    expect(
      (posts[0]!.config as { headers?: Record<string, string> })?.headers?.[
        'x-goog-api-key'
      ],
    ).toBe('K123');
  });
});

describe('[WRAP-AI W1b] the 400 thinking-retry', () => {
  it('re-fires once without thinkingConfig on a 400 that mentions think', async () => {
    let n = 0;
    httpPost.mockImplementation((...args: HttpArgs) => {
      posts.push({
        url: String(args[0]),
        body: JSON.parse(JSON.stringify(args[1])),
        config: args[2],
      });
      n += 1;
      if (n === 1)
        return Promise.reject({
          response: { status: 400, data: { error: 'thinking unsupported' } },
        });
      return Promise.resolve({ status: 200, data: OK });
    });

    const res = await new GeminiReplyTransport().send(
      callFor({ thinkingBudget: 128 }),
    );
    expect(posts).toHaveLength(2);
    expect(JSON.stringify(posts[0]!.body)).toContain('thinkingConfig');
    expect(JSON.stringify(posts[1]!.body)).not.toContain('thinkingConfig');
    expect(res.rawText).toBe('answer [[[FOUND]]]');
    expect(res.httpStatus).toBe(200);
  });
});

describe('[WRAP-AI W1b] vendor error → vendor-free result, never a throw', () => {
  it('a 500 becomes { rawText: undefined, httpStatus: 500 }', async () => {
    httpPost.mockImplementationOnce(() =>
      Promise.reject({ response: { status: 500, data: 'boom' } }),
    );
    const res = await new GeminiReplyTransport().send(callFor({}));
    expect(res.rawText).toBeUndefined();
    expect(res.httpStatus).toBe(500);
    expect(res.errorMessage).toContain('boom');
  });

  it('a non-http error becomes httpStatus 0', async () => {
    httpPost.mockImplementationOnce(() =>
      Promise.reject(new Error('socket died')),
    );
    const res = await new GeminiReplyTransport().send(callFor({}));
    expect(res.httpStatus).toBe(0);
  });

  it('empty candidates → rawText undefined, httpStatus 200 (no error)', async () => {
    armOnce({ candidates: [] });
    const res = await new GeminiReplyTransport().send(callFor({}));
    expect(res.rawText).toBeUndefined();
    expect(res.httpStatus).toBe(200);
    expect(res.errorMessage).toBeNull();
  });
});

describe('[WRAP-AI W1b] the registry — the DeepSeek insertion point', () => {
  it('resolves the gemini transport by name', () => {
    expect(resolveReplyTransport('gemini')).toBe(REPLY_TRANSPORTS.gemini);
  });

  it('an unknown provider falls back to the default, never undefined', () => {
    /* [P2-20260813] This case used to use 'deepseek' as its unknown name. That
       vendor is now REGISTERED, so a real name is no longer a stand-in for an
       unknown one — the assertion moved to a name nobody will ever register.
       The behaviour under test is unchanged: an unrecognised value must resolve
       to the default rather than undefined, so a typo in hook.ai_vendor can
       never break a reply. ค่าที่ไม่รู้จักต้องตกกลับ default ไม่ใช่พัง. */
    expect(resolveReplyTransport('no-such-vendor-xyz')).toBe(
      REPLY_TRANSPORTS[DEFAULT_REPLY_PROVIDER],
    );
    expect(resolveReplyTransport(null)).toBeDefined();
    expect(resolveReplyTransport(undefined)).toBeDefined();
  });

  it('[P2] resolves the registered deepseek transport by name — and it is NOT the gemini one', () => {
    expect(resolveReplyTransport('deepseek')).toBe(
      REPLY_TRANSPORTS['deepseek'],
    );
    expect(resolveReplyTransport('deepseek')).not.toBe(
      REPLY_TRANSPORTS[DEFAULT_REPLY_PROVIDER],
    );
  });

  it('⭐ no hard gemini: no vendor REQUEST STRUCTURE outside the transport file', () => {
    /**
     * The rule that actually matters is "no vendor JSON/URL/API shape leaks past
     * the transport", NOT "the string gemini never appears". Two shared names
     * legitimately appear in the assembler because W transcribes them verbatim:
     *   · the knob env vars `GEMINI_TEMPERATURE/TOP_P/TOP_K` (same names every
     *     vendor's knobs resolve from today — renaming them is K/M/T's job)
     *   · the `'gemini-3.5-flash'` MODEL_ID fallback (legacy default)
     * Those are configuration names, not request structure. What must NOT appear
     * in a vendor-free file is a Gemini request shape: the endpoint, or the
     * `system_instruction` / `generationConfig` / `thinkingConfig` body keys.
     */
    const dir = join(
      __dirname,
      '..',
      '..',
      'src',
      'modules',
      'webhook',
      'ai-reply',
    );
    const vendorFree = [
      'reply-neutral.ts',
      'reply-blocks.ts',
      'reply-prompt-assembler.ts',
      'reply-transport.ts',
    ];
    const VENDOR_STRUCTURE = [
      'generativelanguage.googleapis.com', // the endpoint
      'system_instruction', // gemini body key
      'generationConfig', // gemini body key
      'thinkingConfig', // gemini body key
      'generateContent', // gemini path
    ];
    for (const f of vendorFree) {
      const src = readFileSync(join(dir, f), 'utf8');
      const codeLines = src
        .split('\n')
        .filter(
          (l) =>
            l.trim() &&
            !l.trim().startsWith('*') &&
            !l.trim().startsWith('//') &&
            !l.trim().startsWith('/*'),
        )
        .join('\n');
      for (const marker of VENDOR_STRUCTURE) {
        expect(codeLines).not.toContain(marker);
      }
    }
  });
});
