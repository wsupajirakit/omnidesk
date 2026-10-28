/* eslint-disable no-restricted-imports -- these specs unit-test the rag engine's internals;
   production code reaches rag only through '@/modules/rag' (rag-engine-wiring.spec.ts pins the leaf rule) */
/**
 * [FEAT-20261026-RAGENGINE] Index lifecycle, the front door, the Gemini embedder wire and the
 * embedding cap. Every embedder here is a STUB or a mocked `postToVendor` — no request leaves
 * the process (the shared guard cannot see axios, so nothing real may be reachable).
 * ทุก embedder เป็น stub — ไม่มีการยิง AI จริง
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mongo } from 'mongoose';

jest.mock('@/modules/ai-vendor', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@/modules/ai-vendor',
  );
  return { ...actual, postToVendor: jest.fn() };
});

import { postToVendor } from '@/modules/ai-vendor';
import {
  EmbedderCapDecorator,
  RagEmbedCapReachedError,
} from '@/modules/rag/embedding/embedder-cap.decorator';
import { selectRagEmbedder } from '@/modules/rag/embedding/embedder.factory';
import { GeminiEmbedder } from '@/modules/rag/embedding/gemini-embedder';
import { RagIndexService } from '@/modules/rag/indexing/rag-index.service';
import type {
  RagEmbedInput,
  RagEmbedder,
} from '@/modules/rag/ports/embedder.port';
import type {
  RagVectorRow,
  RagVectorStore,
} from '@/modules/rag/ports/vector-store.port';
import { RagRetrievalService } from '@/modules/rag/rag-retrieval.service';
import { NO_RAG_CONTEXT, type RagSection } from '@/modules/rag/rag.types';
import { MongoVectorStore } from '@/modules/rag/store/mongo-vector-store';
import { l2Normalise, vectorToBuffer } from '@/modules/rag/vector/vector-math';

const HOOK = 'a0d000000000000000000079';
const doc = (extra = ''): RagSection[] => [
  {
    start: '[START_OF_BASIC_INFO]',
    end: '[END_OF_BASIC_INFO]',
    text: `แนะนำร้าน\n\nเวลาทำการ:\nเปิดทุกวัน 10:00-19:00 น.\n\nการผ่อน:\nผ่อนได้ 12 งวด${extra}`,
  },
];

class MemoryStore implements RagVectorStore {
  rows = new Map<string, Float32Array>();
  replaced = 0;
  load(_h: string, hashes: readonly string[]) {
    const m = new Map<string, Float32Array>();
    for (const h of hashes) if (this.rows.has(h)) m.set(h, this.rows.get(h)!);
    return Promise.resolve(m);
  }
  replace(_h: string, _v: string, rows: readonly RagVectorRow[]) {
    this.replaced++;
    for (const r of rows) this.rows.set(r.hash, r.vector);
    return Promise.resolve();
  }
}

class StubEmbedder implements RagEmbedder {
  readonly model = 'stub';
  readonly dim = 4;
  docCalls: number[] = [];
  queryCalls = 0;
  failDocs = false;
  failQuery = false;
  private vec = (s: string) =>
    l2Normalise([
      s.length % 7,
      (s.charCodeAt(0) || 1) % 5,
      1,
      s.includes('ผ่อน') ? 3 : 0,
    ]);
  embedDocuments(items: readonly RagEmbedInput[]) {
    if (this.failDocs) return Promise.reject(new Error('stub down'));
    this.docCalls.push(items.length);
    return Promise.resolve(items.map((it) => this.vec(it.text)));
  }
  embedQuery(text: string) {
    if (this.failQuery) return Promise.reject(new Error('stub query down'));
    this.queryCalls++;
    return Promise.resolve(this.vec(text));
  }
}

const hybridHook = { doc_retrieval: true, rag_search_mode: 'hybrid' };

describe('[RAGENGINE] index lifecycle', () => {
  it('⭐ embeds every chunk once, then serves the cached index', async () => {
    const store = new MemoryStore();
    const emb = new StubEmbedder();
    const svc = new RagIndexService(store, emb);
    const req = {
      hookId: HOOK,
      sections: doc(),
      wantVectors: true,
      apiKey: 'k',
    };
    const a = await svc.getIndex(req);
    const b = await svc.getIndex(req);
    expect(b).toBe(a);
    expect(emb.docCalls).toEqual([a.chunks.length]);
    expect(a.vectors!.every(Boolean)).toBe(true);
  });

  it('🔴 a burst of messages on a fresh document embeds it ONCE (single-flight)', async () => {
    const store = new MemoryStore();
    const emb = new StubEmbedder();
    const svc = new RagIndexService(store, emb);
    const req = {
      hookId: HOOK,
      sections: doc(),
      wantVectors: true,
      apiKey: 'k',
    };
    const [a, b, c] = await Promise.all([
      svc.getIndex(req),
      svc.getIndex(req),
      svc.getIndex(req),
    ]);
    expect(emb.docCalls).toEqual([a.chunks.length]);
    expect(store.replaced).toBe(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('a fresh process reuses stored vectors; an edit embeds only the changed chunk', async () => {
    const store = new MemoryStore();
    await new RagIndexService(store, new StubEmbedder()).getIndex({
      hookId: HOOK,
      sections: doc(),
      wantVectors: true,
      apiKey: 'k',
    });
    const emb = new StubEmbedder();
    const svc = new RagIndexService(store, emb);
    await svc.getIndex({
      hookId: HOOK,
      sections: doc(),
      wantVectors: true,
      apiKey: 'k',
    });
    expect(emb.docCalls).toEqual([]); // all loaded by hash
    await svc.getIndex({
      hookId: HOOK,
      sections: doc(' ดาวน์ 0 บาท'),
      wantVectors: true,
      apiKey: 'k',
    });
    expect(emb.docCalls).toEqual([1]); // only the edited chunk
  });

  it('embedding failure ⇒ lexical index, not cached (the next message may embed)', async () => {
    const emb = new StubEmbedder();
    emb.failDocs = true;
    const svc = new RagIndexService(new MemoryStore(), emb);
    const req = {
      hookId: HOOK,
      sections: doc(),
      wantVectors: true,
      apiKey: 'k',
    };
    const a = await svc.getIndex(req);
    expect(a.vectors).toBeNull();
    expect(a.bm25.size).toBeGreaterThan(0);
    emb.failDocs = false;
    const b = await svc.getIndex(req);
    expect(b.vectors).not.toBeNull();
  });

  it('no embedder / no key ⇒ never asks for vectors', async () => {
    const store = new MemoryStore();
    const svc = new RagIndexService(store, null);
    const idx = await svc.getIndex({
      hookId: HOOK,
      sections: doc(),
      wantVectors: true,
      apiKey: 'k',
    });
    expect(idx.vectors).toBeNull();
    const emb = new StubEmbedder();
    await new RagIndexService(store, emb).getIndex({
      hookId: HOOK,
      sections: doc(),
      wantVectors: true,
      apiKey: null,
    });
    expect(emb.docCalls).toEqual([]);
  });
});

describe('[RAGENGINE] front door', () => {
  const make = (emb: StubEmbedder | null = new StubEmbedder()) => {
    const indexes = new RagIndexService(new MemoryStore(), emb);
    return { svc: new RagRetrievalService(indexes), indexes, emb };
  };

  it('🔴 PIN off ⇒ NO_RAG_CONTEXT and the index is never touched', async () => {
    const { svc, indexes } = make();
    const spy = jest.spyOn(indexes, 'getIndex');
    for (const hook of [
      {},
      { doc_retrieval: false },
      { doc_retrieval: 'true' },
      null,
    ]) {
      await expect(
        svc.retrieveContext({
          question: 'เปิดกี่โมง',
          hookId: HOOK,
          hook,
          sections: doc(),
          apiKey: 'k',
        }),
      ).resolves.toBe(NO_RAG_CONTEXT);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('⭐ on + add ⇒ passages; on + replace ⇒ override', async () => {
    const { svc } = make();
    const add = await svc.retrieveContext({
      question: 'เปิดกี่โมงครับ',
      hookId: HOOK,
      hook: { doc_retrieval: true },
      sections: doc(),
    });
    expect(add.docText).toContain('10:00-19:00');
    expect(add.suggestionOverride).toBeNull();
    const rep = await svc.retrieveContext({
      question: 'เปิดกี่โมงครับ',
      hookId: HOOK,
      hook: { doc_retrieval: true, rag_prompt_mode: 'replace' },
      sections: doc(),
    });
    expect(rep.docText).toBe('');
    expect(rep.suggestionOverride).toContain('10:00-19:00');
  });

  it('default search is bm25 — the embedder is never called', async () => {
    const { svc, emb } = make();
    await svc.retrieveContext({
      question: 'ผ่อนได้กี่งวด',
      hookId: HOOK,
      hook: { doc_retrieval: true },
      sections: doc(),
      apiKey: 'k',
    });
    expect(emb!.docCalls).toEqual([]);
    expect(emb!.queryCalls).toBe(0);
  });

  it('hybrid embeds the query; a failed query embedding still answers lexically', async () => {
    const { svc, emb } = make();
    await svc.retrieveContext({
      question: 'ผ่อนได้กี่งวด',
      hookId: HOOK,
      hook: hybridHook,
      sections: doc(),
      apiKey: 'k',
    });
    expect(emb!.queryCalls).toBe(1);
    emb!.failQuery = true;
    const ctx = await svc.retrieveContext({
      question: 'ผ่อนได้กี่งวด',
      hookId: HOOK,
      hook: hybridHook,
      sections: doc(),
      apiKey: 'k',
    });
    expect(ctx.docText).toContain('12 งวด');
  });

  it('any failure inside ⇒ NO_RAG_CONTEXT (the customer still gets the old answer)', async () => {
    const { svc, indexes } = make();
    jest.spyOn(indexes, 'getIndex').mockRejectedValue(new Error('boom'));
    await expect(
      svc.retrieveContext({
        question: 'x',
        hookId: HOOK,
        hook: { doc_retrieval: true },
        sections: doc(),
      }),
    ).resolves.toBe(NO_RAG_CONTEXT);
    await expect(
      svc.retrieve({
        question: 'x',
        hookId: HOOK,
        hook: { doc_retrieval: true },
        sections: doc(),
      }),
    ).resolves.toBe('');
  });

  it('empty question or empty document ⇒ NO_RAG_CONTEXT', async () => {
    const { svc } = make();
    await expect(
      svc.retrieveContext({
        question: '  ',
        hook: { doc_retrieval: true },
        sections: doc(),
      }),
    ).resolves.toBe(NO_RAG_CONTEXT);
    await expect(
      svc.retrieveContext({
        question: 'x',
        hook: { doc_retrieval: true },
        sections: [{ start: '', end: '', text: ' ' }],
      }),
    ).resolves.toBe(NO_RAG_CONTEXT);
  });
});

describe('[RAGENGINE] MongoVectorStore reads what Mongo really returns', () => {
  /* Found LIVE 26/10 (real gemini-embedding-2, throwaway DB): after a restart every cosine was
     0.000. `.lean()` hands back a BSON `Binary`, and `new Uint8Array(binary)` is EMPTY — the
     MemoryStore used everywhere above never sees a Binary, so no test could catch it. */
  const vec = l2Normalise([0.1, 0.2, 0.3, 0.4]);
  const storeWith = (vector: unknown) =>
    new MongoVectorStore({
      find: () => ({
        lean: () => Promise.resolve([{ hash: 'h1', vector }]),
      }),
    } as never);

  it('🔴 a BSON Binary from .lean() decodes to the stored vector', async () => {
    const got = await storeWith(new mongo.Binary(vectorToBuffer(vec))).load(
      HOOK,
      ['h1'],
      'm',
      4,
    );
    expect(Array.from(got.get('h1') ?? [])).toEqual(Array.from(vec));
  });

  it('a plain Buffer (hydrated document) still decodes', async () => {
    const got = await storeWith(vectorToBuffer(vec)).load(HOOK, ['h1'], 'm', 4);
    expect(Array.from(got.get('h1') ?? [])).toEqual(Array.from(vec));
  });

  it('⭐ a vector of the wrong length counts as MISSING (re-embedded), never as a zero cosine', async () => {
    const got = await storeWith(
      new mongo.Binary(vectorToBuffer(l2Normalise([1, 2]))),
    ).load(HOOK, ['h1'], 'm', 4);
    expect(got.has('h1')).toBe(false);
  });
});

describe('[RAGENGINE] Gemini embedder wire (postToVendor mocked)', () => {
  const post = postToVendor as jest.MockedFunction<typeof postToVendor>;
  beforeEach(() => post.mockReset());

  it('⭐ one request per text, documented prefixes, key in the header, normalised vectors', async () => {
    post.mockResolvedValue({
      data: { embeddings: [{ values: [3, 4] }, { values: [0, 2] }] },
    });
    const vs = await new GeminiEmbedder().embedDocuments(
      [
        { title: 'เวลาทำการ:', text: 'เปิด 10 โมง' },
        { title: '', text: 'ผ่อน' },
      ],
      'KEY',
    );
    const [url, body, cfg] = post.mock.calls[0]!;
    expect(url).toMatch(/\/models\/gemini-embedding-2:batchEmbedContents$/);
    expect(url).not.toContain('KEY');
    const reqs = (
      body as {
        requests: Array<{
          content: { parts: Array<{ text: string }> };
          outputDimensionality: number;
        }>;
      }
    ).requests;
    expect(reqs).toHaveLength(2);
    expect(reqs[0]!.content.parts[0]!.text).toBe(
      'title: เวลาทำการ: | text: เปิด 10 โมง',
    );
    expect(reqs[1]!.content.parts[0]!.text).toBe('title: none | text: ผ่อน');
    expect(reqs[0]!.outputDimensionality).toBe(768);
    expect(JSON.stringify(cfg)).toContain('KEY');
    expect(Array.from(vs[0]!).map((x) => +x.toFixed(2))).toEqual([0.6, 0.8]);
  });

  it('query prefix, and a count mismatch is an error (never a silent aggregate)', async () => {
    post.mockResolvedValue({ data: { embeddings: [{ values: [1, 0] }] } });
    await new GeminiEmbedder().embedQuery('เปิดกี่โมง', 'KEY');
    expect(
      (
        post.mock.calls[0]![1] as {
          requests: Array<{ content: { parts: Array<{ text: string }> } }>;
        }
      ).requests[0]!.content.parts[0]!.text,
    ).toBe('task: search result | query: เปิดกี่โมง');
    post.mockResolvedValue({ data: { embeddings: [{ values: [1, 0] }] } });
    await expect(
      new GeminiEmbedder().embedDocuments(
        [
          { title: '', text: 'a' },
          { title: '', text: 'b' },
        ],
        'KEY',
      ),
    ).rejects.toThrow(/1 vectors for 2 texts/);
  });
});

describe('[RAGENGINE] embedding cap + factory', () => {
  it('⭐ own ledger: counts calls, refuses at the limit, inner not called when refused', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'rag-cap-')), 'ledger.json');
    const inner = new StubEmbedder();
    const capped = new EmbedderCapDecorator(inner, 2, file);
    await capped.embedQuery('a', 'k', HOOK);
    await capped.embedQuery('b', 'k', HOOK);
    await expect(capped.embedQuery('c', 'k', HOOK)).rejects.toBeInstanceOf(
      RagEmbedCapReachedError,
    );
    expect(inner.queryCalls).toBe(2);
    expect(JSON.parse(readFileSync(file, 'utf8')).count).toBe(2);
  });

  it('documents cost one call per batch', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'rag-cap-')), 'ledger.json');
    const capped = new EmbedderCapDecorator(new StubEmbedder(), 10, file);
    await capped.embedDocuments(
      Array.from({ length: 130 }, (_, i) => ({ title: '', text: `t${i}` })),
      'k',
      HOOK,
    );
    expect(JSON.parse(readFileSync(file, 'utf8')).count).toBe(3); // 130 / 64 → 3
  });

  it('🔴 AI_PROVIDER=mock ⇒ no embedder at all (hybrid runs as bm25)', () => {
    const silent = { log: () => undefined };
    expect(
      selectRagEmbedder(
        { providerMode: 'mock', capMode: 'on', capLimit: 5 } as never,
        silent,
      ),
    ).toBeNull();
    expect(
      selectRagEmbedder(
        { providerMode: 'real', capMode: 'on', capLimit: 5 } as never,
        silent,
      ),
    ).toBeInstanceOf(EmbedderCapDecorator);
    expect(
      selectRagEmbedder(
        { providerMode: 'real', capMode: 'off', capLimit: 5 } as never,
        silent,
      ),
    ).toBeInstanceOf(GeminiEmbedder);
  });
});
