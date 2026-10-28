/**
 * [REFACTOR-20260824-SLIPSPLIT] BEFORE pack — ถ่ายพฤติกรรมทุกสาขาไว้ "ก่อน" แยกไฟล์
 * ===========================================================================
 * `handleSlipFlex` ยาว 495 บรรทัดโค้ดจริง (max-lines เตือน) และจะถูกแยกบล็อก
 * "ส่งการ์ด + log + chat history" ออกไป — แต่มันคือ **เส้นทางเงิน**: `isFlexSent`
 * เป็นตัวคีย์ deposit callback (คอมเมนต์ในโค้ดเขียนเองว่า "ถ้าเปลี่ยนเป็น false
 * ตอน suppress = callback ไม่ยิง = เครดิตหาย") ⇒ ห้ามพลาดแม้แต่นิดเดียว
 *
 * ไฟล์นี้จึงถูกเขียน **ก่อนแตะโค้ด** เพื่อให้ "ผลไม่เปลี่ยน" เป็นการ **วัด**
 * ไม่ใช่การอ้าง — ตามมาตรฐานที่ commit `5a25571` วางไว้ตอนแยก
 * `flex-slip-tags.util.ts` ("the golden test was written and seen to FAIL before
 * the util existed").
 *
 * ⚠️ ห้ามแก้ไฟล์นี้ตอนแยก — ถ้าเทสแดงหลังแยก แปลว่าการแยกเปลี่ยนพฤติกรรมจริง
 * ให้ไปแก้โค้ด ไม่ใช่มาแก้เทสให้ผ่าน
 *
 * ครอบ 4 สาขาหลักของ `handleSlipFlex` + ตัวแปรที่ข้ามขอบเขตทุกตัวที่บล็อกแตะ
 */
import { handleSlipFlex } from '@/modules/webhook/slip-flex/slip-flex.handler';

const CARD = {
  _id: 'flex-ok-1',
  name: 'สลิปถูกต้อง',
  content_json: JSON.stringify({
    type: 'bubble',
    body: { text: '{{amount}}' },
  }),
};

const okSlip = () => ({
  success: true,
  data: {
    rawSlip: {
      amount: 500,
      transRef: 'TX1',
      sender: { bank: { id: '004' }, account: { name: { th: 'ผู้ส่ง' } } },
      receiver: { bank: { id: '014' }, account: { name: { th: 'ผู้รับ' } } },
    },
    isDuplicate: false,
  },
});

function makeDeps() {
  const sendLineFlexReply = jest
    .fn()
    .mockResolvedValue({ status: 200, data: { ok: true } });
  const findFlexById = jest.fn().mockResolvedValue(CARD);
  const persistWebhookLog = jest.fn().mockResolvedValue(undefined);
  const logMessage = jest.fn().mockResolvedValue(undefined);
  return {
    sendLineFlexReply,
    findFlexById,
    persistWebhookLog,
    logMessage,
    deps: {
      findFlexById,
      sendLineFlexReply,
      persistWebhookLog,
      logMessage,
      checkQrCode: jest.fn().mockResolvedValue(true),
      formatThaiDateTime: (d: unknown) => String(d),
      lineReplyEndpoint: 'https://api.line.me/v2/bot/message/reply',
    },
  };
}

const input = (over: Record<string, unknown> = {}) => ({
  slipVerifyResult: okSlip(),
  hook: { flex_success: 'flex-ok-1' },
  slipCreatedAt: new Date('2026-08-24T10:00:00Z'),
  slipRecordId: 'slip-1',
  userId: 'U1',
  mediaUrl: 'https://example.invalid/img',
  accessToken: 'token',
  replyToken: 'rt-1',
  eventId: 'ev-1',
  incomingType: 'image',
  baseUrl: 'https://example.invalid',
  logContext: {},
  ...over,
});

describe('[BEFORE] ส่งการ์ดสำเร็จ — เส้นทางปกติ', () => {
  it('⭐ ส่งการ์ด + isFlexSent + log + chat history ครบ', async () => {
    const { deps, sendLineFlexReply, persistWebhookLog, logMessage } =
      makeDeps();
    const r = await handleSlipFlex(input(), deps);

    expect(sendLineFlexReply).toHaveBeenCalledTimes(1);
    expect(r.isFlexSent).toBe(true);
    expect(persistWebhookLog).toHaveBeenCalledTimes(1);
    expect(logMessage).toHaveBeenCalledTimes(1);
  });

  it('⭐ webhook log บันทึก status=success + flex_doc_id + condition', async () => {
    const { deps, persistWebhookLog } = makeDeps();
    await handleSlipFlex(input(), deps);

    const row = persistWebhookLog.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.action_type).toBe('slip_flex_reply');
    expect(row.status).toBe('success');
    expect(row.http_status).toBe(200);
    const summary = row.payload_summary as Record<string, unknown>;
    expect(summary.flex_doc_id).toBe('flex-ok-1');
    expect(summary.reply_token).toBe('rt-1');
    expect(summary).not.toHaveProperty('suppressed_by');
  });

  it('⭐ chat history เขียนชื่อการ์ดจริง + metadata ครบ', async () => {
    const { deps, logMessage } = makeDeps();
    await handleSlipFlex(input(), deps);

    const row = logMessage.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.senderType).toBe('bot');
    expect(row.messageType).toBe('flex');
    expect(row.content).toBe('[Flex] สลิปถูกต้อง');
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.auto_reply_type).toBe('slip_flex_reply');
    expect(meta.flex_doc_id).toBe('flex-ok-1');
    expect(meta).toHaveProperty('slip_verify_result');
  });
});

describe('[BEFORE] 🔴 suppressSlipReply — เส้นทางเงินที่ห้ามพลาด', () => {
  it('⭐ ไม่ส่งการ์ด แต่ isFlexSent ยังเป็น true (คีย์ deposit callback)', async () => {
    const { deps, sendLineFlexReply } = makeDeps();
    const r = await handleSlipFlex(input({ suppressSlipReply: true }), deps);

    expect(sendLineFlexReply).not.toHaveBeenCalled();
    // คอมเมนต์ในโค้ด: "ถ้าเปลี่ยนเป็น false ตอน suppress = callback ไม่ยิง = เครดิตหาย"
    expect(r.isFlexSent).toBe(true);
  });

  it('⭐ webhook log ยังเขียน แต่ status=suppressed ไม่มี http_status', async () => {
    const { deps, persistWebhookLog } = makeDeps();
    await handleSlipFlex(input({ suppressSlipReply: true }), deps);

    const row = persistWebhookLog.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.status).toBe('suppressed');
    expect(row).not.toHaveProperty('http_status');
    const summary = row.payload_summary as Record<string, unknown>;
    expect(summary.suppressed_by).toBe('payment_tool_replied');
  });

  it('⭐ chat history ไม่เขียนเลย — การ์ดที่ไม่ได้ส่ง ไม่ต้องบันทึก', async () => {
    const { deps, logMessage } = makeDeps();
    await handleSlipFlex(input({ suppressSlipReply: true }), deps);
    expect(logMessage).not.toHaveBeenCalled();
  });
});

describe('[BEFORE] ไม่มีการ์ด / ไม่มีผลตรวจ — ต้องไม่ส่งอะไร', () => {
  it('ไม่มี slipVerifyResult ⇒ ออกทันที ไม่แตะ deps', async () => {
    const { deps, sendLineFlexReply, persistWebhookLog } = makeDeps();
    const r = await handleSlipFlex(input({ slipVerifyResult: null }), deps);

    expect(r.isFlexSent).toBeFalsy();
    expect(sendLineFlexReply).not.toHaveBeenCalled();
    expect(persistWebhookLog).not.toHaveBeenCalled();
  });

  it('hook ไม่ผูกการ์ด success ⇒ ไม่ส่งการ์ด', async () => {
    const { deps, sendLineFlexReply } = makeDeps();
    const r = await handleSlipFlex(input({ hook: {} }), deps);
    expect(sendLineFlexReply).not.toHaveBeenCalled();
    expect(r.isFlexSent).toBeFalsy();
  });
});
