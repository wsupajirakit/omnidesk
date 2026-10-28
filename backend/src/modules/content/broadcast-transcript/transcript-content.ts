/**
 * [FIX-20260828-TRANSCRIPTVARS] สำเนาในห้องแชทต้องเป็น "ข้อความที่ส่งจริง"
 * ===========================================================================
 * เจ้าของ 28/08: *"multicast แบบ tag profile/site (`_x`) ต้องเก็บ msg ที่ส่งจริง
 * เข้า chat msg · แอป LINE ฝั่งลูกค้าถูกแล้ว ได้ข้อความถูกแล้ว"*
 *
 * 🔴 ต้นเหตุที่วัดได้: ตัวส่งอ่านข้อความจาก `PlainCardMessageBuilder` ซึ่ง
 *    **แทนค่าแท็กต่อ OA** ไว้แล้ว · ส่วนตัวเขียนสำเนาอ่าน `card.text` ซึ่งเป็น
 *    การ์ดที่เซฟไว้ ⇒ สองที่อ่านคนละแหล่ง · ลูกค้าเห็นข้อความถูก แต่ห้องแชท
 *    เก็บ `{{hook_domain}}` ดิบไว้ และไม่มีอะไรฟ้อง เพราะการส่งสำเร็จทุกประการ
 *
 * 🔴 เป็นฟังก์ชันบริสุทธิ์แยกไฟล์ ไม่ใช่ ternary ในตัวส่ง เพราะ:
 *    · `new-send.service.ts` ยาวมากแล้ว การตัดสินใจนี้ควรอ่านได้โดยไม่ต้องอ่านทั้งไฟล์
 *    · เทสได้ตรง ๆ — การขับทั้ง service เพื่อวัดสองบรรทัดนี้ต้องสร้าง pager double
 *      ทั้งใบ ซึ่งบวมเกินกว่าสิ่งที่พิสูจน์
 *
 * ⚠️ รูปของ payload มาจาก `buildBroadcastMessage` (`build-payload.broadcast.ts`)
 *      text  → `{ type:'text', text }`
 *      image → `{ type:'image', originalContentUrl, previewImageUrl }`
 *      flex  → `{ type:'flex', altText, contents }`
 *    เปลี่ยนที่นั่นเมื่อไหร่ ต้องมาแก้ที่นี่ด้วย — เทสของไฟล์นี้ปักรูปเหล่านั้นไว้
 *
 * revert: ลบไฟล์นี้แล้วให้ตัวส่งอ่าน `card` ตรง ๆ เหมือนเดิม (สำเนาจะกลับไปเก็บ
 *   แท็กดิบ ซึ่งคือบั๊กที่ไฟล์นี้แก้)
 */

/** การ์ดที่เซฟไว้ เท่าที่สำเนาต้องรู้ */
export interface SavedCardLike {
  readonly type?: string;
  readonly text?: string;
  readonly image_url?: string;
  readonly flex_json?: unknown;
}

export interface TranscriptContent {
  /** ⚠️ string เสมอ — หน้าแชทเรียก `.includes()` บนค่านี้ ยัด object แล้วพังทั้งหน้า */
  readonly content: string;
  /** เฉพาะ flex — ตัวการ์ดไปอยู่ `metadata.flex_json` ไม่ใช่ `content` */
  readonly flexJson?: unknown;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;

/**
 * สิ่งที่ควรถูกบันทึกลงห้องแชท จาก payload ที่ยิงออกไปจริง
 *
 * @param sentPayload ข้อความ LINE ที่ถูกยิงจริงของ OA นั้น · `undefined` ได้เมื่อ
 *   ยังไม่มีข้อมูล (OA ที่ builder ไม่ได้สร้างไว้ หรือโหมด `personal` ที่แทนค่า
 *   ต่อคน จึงไม่มีคำตอบเดียวสำหรับทั้ง OA)
 * @param card การ์ดที่เซฟไว้ — ใช้เป็น **ตาข่ายรับ** เท่านั้น
 * @param jobName ชื่อแคมเปญ สำหรับป้ายของ flex
 *
 * 🔴 ค่าที่ส่งจริงมาก่อนเสมอ · ตกกลับไปใช้การ์ดที่เซฟไว้เมื่อไม่มีเท่านั้น —
 *    ข้อความที่ยังไม่แทนค่า ยังอ่านรู้เรื่องกว่าห้องแชทที่ว่างเปล่า
 * ⚠️ **ชนิดมาจากการ์ด ไม่ใช่จาก payload** — `chat_messages.message_type` เป็น
 *    คำศัพท์ของฝั่งแชท และชนิดไม่มีทางเปลี่ยนระหว่างแทนค่าอยู่แล้ว
 */
export function transcriptContentFrom(
  sentPayload: Record<string, unknown> | undefined,
  card: SavedCardLike,
  jobName?: string,
): TranscriptContent {
  if (card.type === 'text') {
    return { content: str(sentPayload?.['text']) ?? card.text ?? '' };
  }
  if (card.type === 'image') {
    return {
      content: str(sentPayload?.['originalContentUrl']) ?? card.image_url ?? '',
    };
  }
  return {
    content: `[Flex] ${jobName ?? 'broadcast'}`,
    flexJson: sentPayload?.['contents'] ?? card.flex_json,
  };
}
