/**
 * [FIX-20261018-NOWLEAK] A "now" block must never reach a customer — whatever the model echoes.
 * ============================================================================
 * Seen live 18/10/2026 22:55 on the loan OA `demo-acme` (owner: "ตอนตอบลูกค้า ต้องไม่หลุด now
 * เข้าไป"). The customer asked "ยอดเท่าไหร่" and got, verbatim, a `[NOW] … [/NOW]` block of
 * `key = value` lines followed by the real answer. The system did NOT send a now block that turn
 * (`AI_NOW_BLOCK` unset ⇒ off); the OA's Training Document names `[NOW]` 5× / `[/NOW]` 1× /
 * `append_time_suffix` 5×, so the model invented the block it was told about and printed it.
 *
 * The outbound sweep (`stripUnknownMarkers`, reply-tags.util.ts) is the one place a reply passes
 * before LINE, on the AI path and on the hook-field path alike. It removed only `[START_OF_*]` /
 * `[END_OF_*]` FENCES — the lines between them stayed — and did not know `[NOW]` at all.
 *
 * TARGET — every now-block shape is removed WHOLE (fence + lines): the system's own
 *          `[START_OF_NOW]…[END_OF_NOW]`, the Training Document's `[NOW]…[/NOW]`, an opener the
 *          model never closed, a stray closer.
 * PIN    — everything else the sweep does is unchanged; ordinary text, other fences (content kept)
 *          and `x = y` lines outside a now block survive.
 */
import {
  resolveReplyTags,
  stripUnknownMarkers,
} from '@/modules/webhook/hook-reply/reply-tags.util';

/* the bubble from the owner's screenshot, verbatim (no personal data in it) */
const LEAKED = [
  '[NOW]',
  'datetime_th = วันอาทิตย์ที่ 18 ตุลาคม 2569 22:55:49',
  'date_iso = 2026-10-18',
  'time_24h = 22:55',
  'office_hours = 10:00-19:00 ทุกวัน',
  'is_holiday = false',
  'holiday_name = -',
  'status = AFTER_CLOSE',
  'append_time_suffix = YES',
  '[/NOW]',
  '',
  'เดี๋ยวในส่วนนี้น้องเป๋าตังจะประสานงานกับพี่แอดมินให้มาช่วยดูแลนะคะ',
  'แต่เนื่องจากตอนนี้อยู่นอกช่วงเวลาทำการ 10:00-19:00 น. พี่แอดมินจะมาตอบคุณลูกค้าในวันถัดไปนะคะ',
].join('\n');
const ANSWER = [
  'เดี๋ยวในส่วนนี้น้องเป๋าตังจะประสานงานกับพี่แอดมินให้มาช่วยดูแลนะคะ',
  'แต่เนื่องจากตอนนี้อยู่นอกช่วงเวลาทำการ 10:00-19:00 น. พี่แอดมินจะมาตอบคุณลูกค้าในวันถัดไปนะคะ',
].join('\n');

const noNowTrace = (s: string) => {
  expect(s).not.toMatch(/\[\/?NOW\]|START_OF_NOW|END_OF_NOW/i);
  expect(s).not.toMatch(/datetime_th|append_time_suffix|status = |is_holiday/);
};

describe('[NOWLEAK] TARGET — the sweep removes a now block whole', () => {
  it('⭐ the live bubble: only the answer reaches the customer', () => {
    const out = stripUnknownMarkers(LEAKED);
    noNowTrace(out);
    expect(out).toBe(ANSWER);
  });
  it("⭐ the system's own fence echoed back: fences AND lines go (today only the fences did)", () => {
    const out = stripUnknownMarkers(
      `ยอดงวดนี้ 1,234 บาทค่ะ\n[START_OF_NOW]\nstatus = OPEN\ntime_24h = 11:00\n[END_OF_NOW]`,
    );
    noNowTrace(out);
    expect(out).toBe('ยอดงวดนี้ 1,234 บาทค่ะ');
  });
  it('an opener the model never closed: the opener and its key = value lines go, the answer stays', () => {
    const out = stripUnknownMarkers(
      `[NOW]\nstatus = OPEN\nis_holiday = false\nยอดงวดนี้ 1,234 บาทค่ะ`,
    );
    noNowTrace(out);
    expect(out).toBe('ยอดงวดนี้ 1,234 บาทค่ะ');
  });
  it('a closed block with a sentence inside it still goes whole (not only its key = value lines)', () => {
    const out = stripUnknownMarkers(
      `[NOW]\nstatus = OPEN\nหมายเหตุ: เวลาทำการตามประกาศ\n[/NOW]\nยอดงวดนี้ 1,234 บาทค่ะ`,
    );
    noNowTrace(out);
    expect(out).toBe('ยอดงวดนี้ 1,234 บาทค่ะ');
  });
  it('the fences match whatever case the model types', () => {
    const out = stripUnknownMarkers(`[now]\nstatus = OPEN\n[/Now]\nได้เลยค่ะ`);
    noNowTrace(out);
    expect(out).toBe('ได้เลยค่ะ');
  });
  it('a stray closer or a fence mid-sentence goes; the sentence stays', () => {
    expect(stripUnknownMarkers('ได้เลยค่ะ [/NOW]')).toBe('ได้เลยค่ะ');
    expect(stripUnknownMarkers('ตอนนี้ [NOW] เปิดทำการค่ะ')).toBe(
      'ตอนนี้ เปิดทำการค่ะ',
    );
  });
  it('⭐ the AI path end to end (resolveReplyTags → finalReplyForLine)', () => {
    const r = resolveReplyTags(LEAKED, '');
    noNowTrace(r.finalReplyForLine);
    expect(r.finalReplyForLine).toBe(ANSWER);
  });
  it('⭐ the hook-field path (keepAssist): the now block goes, [[[assist]]] is kept', () => {
    const out = stripUnknownMarkers(
      `[NOW]\nstatus = AFTER_CLOSE\n[/NOW]\nรอแอดมินสักครู่นะคะ [[[assist]]]`,
      {
        keepAssist: true,
      },
    );
    noNowTrace(out);
    expect(out).toBe('รอแอดมินสักครู่นะคะ [[[assist]]]');
  });
});

describe('[NOWLEAK] PIN — nothing else the sweep does moves', () => {
  it('🔴 ordinary text, "now" in prose, bracketed prose and x = y lines outside a block survive', () => {
    const text = 'Right now ยอด = 1,234 บาท [ดูรูป] [1]\nstatus = รอโอน';
    expect(stripUnknownMarkers(text)).toBe(text);
  });
  it('🔴 other fences: only the fence goes, its content stays (legacy behaviour)', () => {
    expect(
      stripUnknownMarkers('[START_OF_BASIC_INFO]\nข้อมูล\n[END_OF_BASIC_INFO]'),
    ).toBe('ข้อมูล');
  });
  it('🔴 the bracket families are still swept as before', () => {
    expect(stripUnknownMarkers('ยอด [[[history]]] คือ [[x]] 10 บาท')).toBe(
      'ยอด คือ 10 บาท',
    );
  });
});
