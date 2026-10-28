/**
 * [FIX-20260902-MDBOLD] LINE has no bold — paired `**` must not reach a customer.
 * ===========================================================================
 * THE DEFECT, from production 01/09: the bot sent `**"ฝากเงิน"**` and the customer
 * read the asterisks. A LINE text message is plain text.
 *
 * Two causes, both verified against the code rather than assumed:
 *   · nothing on the outbound path strips markdown (grepped `modules/webhook/`
 *     and `modules/ai/` — the only "markdown" hit peels ```json off a TOOL
 *     response, `rag-engine.service.ts:2021`, and never touches a reply)
 *   · the prompt never forbids it — `ai-reply/reply-blocks.ts:59-69` is the whole
 *     system instruction and says nothing about formatting
 *
 * The fix lives in the reply, not the prompt: `buildInstruction` is transcribed
 * byte-for-byte from legacy and the W0 snapshot fails on any drift.
 *
 * ⚠️ THE NEGATIVE CASES BELOW ARE THE IMPORTANT HALF. The rule is deliberately
 *    narrow — paired `**` only — and these pin that a lone `*` survives. A
 *    customer can legitimately receive one, and every widening is another way to
 *    mangle real text. ห้ามแตะดอกจันเดี่ยว
 *
 * revert: delete this file and the `[FIX-20260902-MDBOLD]` block in
 *         `reply-tags.util.ts`.
 */
import { resolveReplyTags } from '@/modules/webhook/hook-reply/reply-tags.util';

const reply = (text: string): string =>
  resolveReplyTags(text, 'https://x.test').finalReplyForLine;

describe('[FIX-20260902-MDBOLD] POSITIVE — bold markers are removed', () => {
  it('🔴 the exact production string loses its asterisks, keeps its words', () => {
    expect(reply('กดเมนู **"ฝากเงิน"** ได้เลยค่ะ')).toBe(
      'กดเมนู "ฝากเงิน" ได้เลยค่ะ',
    );
  });

  it('⭐⭐ several bold runs in one reply', () => {
    expect(reply('**ฝาก** ขั้นต่ำ 100 และ **ถอน** ขั้นต่ำ 200')).toBe(
      'ฝาก ขั้นต่ำ 100 และ ถอน ขั้นต่ำ 200',
    );
  });

  it('⭐⭐ bold spanning a newline still unwraps', () => {
    expect(reply('**บรรทัดหนึ่ง\nบรรทัดสอง**')).toBe('บรรทัดหนึ่ง\nบรรทัดสอง');
  });

  it('⭐ a whole reply that is one bold run', () => {
    expect(reply('**ยินดีต้อนรับค่ะ**')).toBe('ยินดีต้อนรับค่ะ');
  });
});

describe('[FIX-20260902-MDBOLD] NEGATIVE — everything else is left alone', () => {
  /* 🔴 The rule that keeps this from becoming a text mangler. */
  it.each([
    ['a lone asterisk is arithmetic', 'ราคา 5 * 5 บาท'],
    ['a lone asterisk as a footnote', 'ฟรีค่าธรรมเนียม*'],
    ['a bullet list an operator wrote', '* ฝาก\n* ถอน'],
    ['an unpaired opener is not bold', 'ราคา **พิเศษ วันนี้'],
    ['plain text with no asterisk at all', 'สวัสดีค่ะ ยินดีให้บริการ'],
  ])('%s', (_label, text) => {
    expect(reply(text)).toBe(text);
  });

  it('⭐⭐ single underscores and hashes are NOT touched — no evidence, no rule', () => {
    expect(reply('ดูที่ _ตาราง_ หรือ # หัวข้อ')).toBe(
      'ดูที่ _ตาราง_ หรือ # หัวข้อ',
    );
  });
});

describe('[FIX-20260902-MDBOLD] it composes with the rules around it', () => {
  /* ORDER IS THE CONTRACT in this file. The marker sweep runs first, so a marker
     sitting between two asterisks is gone by the time this rule looks — and the
     asterisks it leaves behind must still be unwrapped. */
  it('⭐⭐⭐ a marker between the asterisks is swept, then the bold unwraps', () => {
    expect(reply('**ดูโปร [[[flex_m00019]]] ที่นี่**')).toBe('ดูโปร ที่นี่');
  });

  it('⭐⭐ `[[link]]` is substituted before this rule sees it', () => {
    expect(reply('**สมัครที่ [[link]]**')).toBe('สมัครที่ https://x.test');
  });

  /* A flex_pc reply is PARSED into a card. `**` inside a JSON string is data, and
     rewriting it would change what the card displays. */
  it('⭐⭐⭐ a flex_pc JSON wrapper is exempt, asterisks and all', () => {
    const json = '{"tag":"flex_pc00001","text":"**bold inside json**"}';
    expect(reply(json)).toBe(json);
  });
});
