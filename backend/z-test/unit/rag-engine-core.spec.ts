/* eslint-disable no-restricted-imports -- these specs unit-test the rag engine's internals;
   production code reaches rag only through '@/modules/rag' (rag-engine-wiring.spec.ts pins the leaf rule) */
/**
 * [FEAT-20261026-RAGENGINE] The pure core of the new RAG engine — text, chunking, BM25,
 * retrieval, composition, settings. No I/O, no AI: everything here runs offline.
 *
 * Plan: `todo/task/26102026/be_todo1_26102026_rag-engine-overhaul_demo.md`
 * แกนของ engine ใหม่ — ไม่มี I/O ไม่มี AI
 */
import {
  chunkSections,
  isHeadingLine,
} from '@/modules/rag/chunking/structural-chunker';
import { composeContext } from '@/modules/rag/compose/prompt-composer';
import { Bm25Index } from '@/modules/rag/lexical/bm25-index';
import { RAG_CONFIG } from '@/modules/rag/rag.config';
import { NO_RAG_CONTEXT, type RagSection } from '@/modules/rag/rag.types';
import {
  retrieveChunks,
  type RetrievalIndex,
} from '@/modules/rag/retrieval/hybrid-retriever';
import { resolveRagSettings } from '@/modules/rag/settings/rag-settings';
import { normaliseText, tokenise } from '@/modules/rag/text/thai-text';
import { l2Normalise } from '@/modules/rag/vector/vector-math';

const SHOP: RagSection[] = [
  {
    start: '[START_OF_BASIC_INFO]',
    end: '[END_OF_BASIC_INFO]',
    text: [
      'คุณคือแอดมินร้านผ่อนมือถือ ตอบสุภาพ กระชับ',
      '[[[history]]]',
      '',
      'เวลาทำการ:',
      'ร้านเปิดทุกวันจันทร์ถึงศุกร์ 10:00-19:00 น. หยุดวันเสาร์อาทิตย์',
      '',
      'การผ่อนชำระ:',
      'ผ่อนได้ 6 ถึง 12 งวด ดาวน์ขั้นต่ำ 0 บาท ค่างวดเริ่มต้น {{installment_min}} บาทต่อเดือน',
      '',
      'สินเชื่อ:',
      'สมัครสินเชื่อใช้บัตรประชาชนใบเดียว อนุมัติไวภายใน 30 นาที',
    ].join('\n'),
  },
  {
    start: '[START_OF_COMPANY_INFO]',
    end: '[END_OF_COMPANY_INFO]',
    text: [
      'ที่อยู่สาขา:',
      'สาขาบางนา ชั้น 2 ห้าง เมกาบางนา โทร {{shop_phone}}',
    ].join('\n'),
  },
];

const indexOf = (
  sections: RagSection[],
  vectors: RetrievalIndex['vectors'] = null,
): RetrievalIndex => {
  const chunks = chunkSections(sections);
  return { chunks, bm25: new Bm25Index(chunks), vectors };
};

describe('[RAGENGINE] Thai text', () => {
  it('normalises Thai digits, the split sara am and zero-width characters', () => {
    expect(normaliseText('ผ่อน๑๒งวด')).toBe('ผ่อน12งวด');
    expect(normaliseText('กํา')).toBe('กำ'); // NIKHAHIT + SARA AA → SARA AM
    expect(normaliseText('สิน\u200Bเชื่อ')).toBe('สินเชื่อ');
  });

  it('adds bigrams so a compound split by ICU still matches as one term', () => {
    const t = tokenise('สมัครสินเชื่อ');
    expect(t).toEqual(expect.arrayContaining(['สินเชื่อ']));
  });

  it('drops polite particles', () => {
    expect(tokenise('ร้านเปิดไหมครับ')).not.toContain('ครับ');
  });
});

describe('[RAGENGINE] structural chunker', () => {
  const chunks = chunkSections(SHOP);

  it('every chunk is an exact slice of its own section', () => {
    for (const c of chunks) expect(SHOP[c.section]!.text).toContain(c.text);
  });

  it('a heading opens a new chunk and travels with it', () => {
    const hours = chunks.find((c) => c.text.includes('10:00-19:00'))!;
    expect(hours.heading).toBe('เวลาทำการ:');
    expect(hours.text.startsWith('เวลาทำการ:')).toBe(true);
  });

  it('pins the preamble and any chunk carrying [[[history]]] or {{ctx}}', () => {
    expect(chunks[0]!.pinned).toBe(true);
    expect(chunks.find((c) => c.text.includes('[[[history]]]'))!.pinned).toBe(
      true,
    );
    const ctx = chunkSections([
      { start: '', end: '', text: 'intro\n\nหัวข้อ:\nลูกค้า {{ctx.name}} ถาม' },
    ]);
    expect(ctx.find((c) => c.text.includes('{{ctx.name}}'))!.pinned).toBe(true);
    expect(chunks.find((c) => c.text.includes('สาขาบางนา'))!.pinned).toBe(
      false,
    );
  });

  it('never cuts inside a dynamic tag or a control marker', () => {
    const tag = '{{a_very_long_dynamic_tag_name_for_testing}}';
    const line = `${'ก'.repeat(50)}${tag}${'ข'.repeat(50)}[[[history]]]${'ค'.repeat(50)}`;
    const cut = chunkSections([{ start: '', end: '', text: line }], {
      targetChars: 40,
      maxChars: 60,
    });
    expect(cut.length).toBeGreaterThan(1);
    expect(cut.map((c) => c.text).join('')).toBe(line); // nothing lost, nothing re-flowed
    for (const c of cut) {
      expect((c.text.match(/\{\{/g) ?? []).length).toBe(
        (c.text.match(/\}\}/g) ?? []).length,
      );
      expect((c.text.match(/\[\[\[/g) ?? []).length).toBe(
        (c.text.match(/\]\]\]/g) ?? []).length,
      );
    }
  });

  it('a tag longer than the window is kept whole (the fallback cut moves to the tag end)', () => {
    const tag = `{{${'x'.repeat(100)}}}`;
    const line = `${'ก'.repeat(10)}${tag}${'ข'.repeat(10)}`;
    const cut = chunkSections([{ start: '', end: '', text: line }], {
      targetChars: 20,
      maxChars: 40,
    });
    expect(cut.map((c) => c.text).join('')).toBe(line);
    expect(cut.some((c) => c.text.includes(tag))).toBe(true);
  });

  it('is deterministic — same text, same ids and hashes', () => {
    expect(chunkSections(SHOP).map((c) => c.hash)).toEqual(
      chunks.map((c) => c.hash),
    );
  });

  it('recognises headings but not control markers', () => {
    expect(isHeadingLine('## สินค้า')).toBe(true);
    expect(isHeadingLine('【โปรโมชัน】')).toBe(true);
    expect(isHeadingLine('[[[history]]]')).toBe(false);
    expect(isHeadingLine('{{shop_phone}}')).toBe(false);
  });

  /* Found 26/10 while writing the demo Training Doc: a heading followed by a block that
     pushed past targetChars was emitted ALONE — a 36-char chunk holding only the heading,
     which was then the PINNED first chunk while the rules under it were not pinned. */
  it('🔴 a heading is never a chunk on its own — the pinned first chunk carries what it heads', () => {
    const rules = Array.from(
      { length: 6 },
      (_, i) => `${i + 1}. กฎข้อ ${i + 1} ${'ก'.repeat(150)}`,
    ).join('\n');
    const doc = chunkSections([
      {
        start: '',
        end: '',
        text: `[หมวด 0: กฎหลัก]\n${rules}\n\n[หมวด 1: อื่น ๆ]\nข้อความ`,
      },
    ]);
    expect(doc.filter((c) => isHeadingLine(c.text.trim()))).toEqual([]);
    expect(doc[0]!.pinned).toBe(true);
    expect(doc[0]!.text).toContain('กฎข้อ 6');
  });

  it('🔴 a multi-line paragraph longer than maxChars is split at a line boundary', () => {
    const lines = Array.from(
      { length: 30 },
      (_, i) => `บรรทัด ${i} ${'ข'.repeat(80)}`,
    );
    const cut = chunkSections([{ start: '', end: '', text: lines.join('\n') }]);
    expect(cut.length).toBeGreaterThan(1);
    expect(Math.max(...cut.map((c) => c.text.length))).toBeLessThanOrEqual(
      RAG_CONFIG.chunk.maxChars,
    );
    for (const c of cut)
      expect(lines.some((l) => c.text.startsWith(l))).toBe(true);
  });
});

describe('[RAGENGINE] retrieval', () => {
  it('⭐ a Thai question finds its section', () => {
    const index = indexOf(SHOP);
    const r = retrieveChunks(index, 'ร้านเปิดกี่โมงครับ', null);
    expect(r.confident).toBe(true);
    expect(r.selected.map((i) => index.chunks[i]!.text).join('\n')).toContain(
      '10:00-19:00',
    );
  });

  it('a compound term matches through its bigram (สินเชื่อ)', () => {
    const index = indexOf(SHOP);
    const r = retrieveChunks(index, 'อยากสมัครสินเชื่อ', null);
    expect(r.selected.map((i) => index.chunks[i]!.text).join('\n')).toContain(
      'อนุมัติไว',
    );
  });

  it('🔴 not confident ⇒ nothing selected (the caller answers as before)', () => {
    const r = retrieveChunks(indexOf(SHOP), 'quantum chromodynamics', null);
    expect(r.confident).toBe(false);
    expect(r.selected).toEqual([]);
  });

  it('🔴 words overlap but the score is under the threshold ⇒ nothing selected', () => {
    const index = indexOf(SHOP);
    const strict = { ...RAG_CONFIG.retrieve, minLexicalScore: 1000 };
    const r = retrieveChunks(index, 'ร้านเปิดกี่โมงครับ', null, strict);
    expect(r.confident).toBe(false);
    expect(r.selected).toEqual([]);
  });

  it('hybrid: a semantic-only hit is found when no word overlaps', () => {
    const index = indexOf(SHOP);
    const target = index.chunks.findIndex((c) => c.text.includes('สาขาบางนา'));
    const dim = 8;
    const basis = (k: number) =>
      l2Normalise(Array.from({ length: dim }, (_, j) => (j === k ? 1 : 0.01)));
    index.vectors = index.chunks.map((_, i) =>
      basis(i === target ? 0 : 1 + (i % (dim - 1))),
    );
    const r = retrieveChunks(index, 'xyz-no-overlap', basis(0));
    expect(r.confident).toBe(true);
    expect(r.selected).toContain(target);
  });

  it('respects the character budget (pinned chunks are outside it)', () => {
    const big: RagSection[] = [
      {
        start: '',
        end: '',
        text: Array.from(
          { length: 30 },
          (_, i) => `หัวข้อ ${i}:\nผ่อนมือถือรุ่น ${i} ${'ก'.repeat(300)}`,
        ).join('\n\n'),
      },
    ];
    const index = indexOf(big);
    const r = retrieveChunks(index, 'ผ่อนมือถือรุ่น', null, {
      ...RAG_CONFIG.retrieve,
      budgetChars: 700,
    });
    const spent = r.selected
      .map((i) => index.chunks[i]!)
      .filter((c) => !c.pinned)
      .reduce((n, c) => n + c.text.length, 0);
    expect(spent).toBeLessThanOrEqual(700 + 400); // the first pick always fits, the rest obey the budget
  });
});

describe('[RAGENGINE] small-to-big stays inside one topic', () => {
  it('a split paragraph pulls its other half; the next heading is not pulled', () => {
    const longPara = `ผ่อนมือถือ ${'ก'.repeat(800)} ${'ข'.repeat(800)}`; // > maxChars ⇒ split in two
    const sections: RagSection[] = [
      {
        start: '',
        end: '',
        text: `แนะนำ\n\nการผ่อน:\n${longPara}\n\nสาขา:\nบางนา ชั้น 2`,
      },
    ];
    const index = indexOf(sections);
    const halves = index.chunks.filter((c) => c.heading === 'การผ่อน:');
    expect(halves.length).toBeGreaterThan(1);
    const r = retrieveChunks(index, 'ผ่อนมือถือ', null, {
      ...RAG_CONFIG.retrieve,
      topK: 1,
    });
    const got = r.selected.map((i) => index.chunks[i]!);
    expect(got.filter((c) => c.heading === 'การผ่อน:').length).toBeGreaterThan(
      1,
    );
    expect(got.some((c) => c.heading === 'สาขา:')).toBe(false);
  });
});

describe('[RAGENGINE] composition', () => {
  const index = indexOf(SHOP);
  const hours = index.chunks.findIndex((c) => c.text.includes('10:00-19:00'));

  it('add ⇒ passages for the Document block, no override', () => {
    const ctx = composeContext(SHOP, index.chunks, [hours], 'add');
    expect(ctx.suggestionOverride).toBeNull();
    expect(ctx.docText).toContain('10:00-19:00');
    expect(ctx.docText).not.toContain('สาขาบางนา');
  });

  it('⭐ replace ⇒ the Training Doc rebuilt in the same box shape, pinned chunks kept', () => {
    const ctx = composeContext(SHOP, index.chunks, [hours], 'replace');
    expect(ctx.docText).toBe('');
    const o = ctx.suggestionOverride!;
    expect(o.startsWith('[START_OF_BASIC_INFO]\n')).toBe(true);
    expect(o).toContain('[[[history]]]'); // pinned
    expect(o).toContain('10:00-19:00'); // selected
    expect(o).not.toContain('อนุมัติไว'); // not selected
    expect(o).not.toContain('[START_OF_COMPANY_INFO]'); // a box with nothing kept is dropped
    expect(o.endsWith('[END_OF_BASIC_INFO]')).toBe(true);
  });

  it('add leaves pinned chunks out (they are already in the full Training Doc)', () => {
    expect(composeContext(SHOP, index.chunks, [0], 'add')).toBe(NO_RAG_CONTEXT);
  });

  it('🔴 nothing selected ⇒ NO_RAG_CONTEXT in both modes', () => {
    expect(composeContext(SHOP, index.chunks, [], 'add')).toBe(NO_RAG_CONTEXT);
    expect(composeContext(SHOP, index.chunks, [], 'replace')).toBe(
      NO_RAG_CONTEXT,
    );
  });
});

describe('[RAGENGINE] settings — defaults touch nobody', () => {
  it('🔴 PIN off unless doc_retrieval is exactly true', () => {
    for (const v of [undefined, null, false, 'true', 1]) {
      expect(resolveRagSettings({ doc_retrieval: v }).enabled).toBe(false);
    }
    expect(resolveRagSettings(null).enabled).toBe(false);
    expect(resolveRagSettings({ doc_retrieval: true }).enabled).toBe(true);
  });

  it('🔴 PIN unset or unknown modes fall back to add + bm25 (no AI, full doc kept)', () => {
    for (const hook of [
      {},
      { rag_prompt_mode: null, rag_search_mode: null },
      { rag_prompt_mode: 'x', rag_search_mode: 'paid' },
    ]) {
      expect(resolveRagSettings(hook)).toMatchObject({
        promptMode: 'add',
        searchMode: 'bm25',
      });
    }
    expect(
      resolveRagSettings({
        rag_prompt_mode: 'replace',
        rag_search_mode: 'hybrid',
      }),
    ).toMatchObject({
      promptMode: 'replace',
      searchMode: 'hybrid',
    });
  });
});
