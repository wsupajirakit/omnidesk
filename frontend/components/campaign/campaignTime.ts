/**
 * [FIX-20260824-ONETIMEZONE] ฝั่งจอมีประตูเวลาเดียว และมันหมายถึงเวลาไทยเสมอ
 * ===========================================================================
 * เจ้าของ 24/08: *"ทำ single truth เรื่องเวลา boardcast ต้องผ่านจุดเดียว"* ·
 * *"อย่าลืมเรื่องว่า single truth ต้องไม่มีปัญหา"*.
 *
 * ── บั๊กที่ไฟล์นี้ปิด วัดจริง 24/08 ไม่ได้เดา ───────────────────────────────────
 * ฟอร์มบรอดแคสต์มีช่องเวลา **สองแบบ** และเดิมมันตีความคนละอย่าง:
 *
 *   ช่อง                     ส่งขึ้นไปเป็น              ใครตัดสินความหมาย
 *   ค่าเงื่อนไข (rule value)  2026-08-24T15:00:00±HH  offset ของ "เบราว์เซอร์"
 *   scheduled_at             2026-08-24T15:00        ค่าคงที่ +07:00 ของ BE
 *
 * แอดมินพิมพ์ `15:00` ในหน้าเดียวกันทั้งสองช่อง แล้ววัดด้วย `TZ` สองแบบ:
 *
 *   เปิดจากไทย       rule → 2026-08-24T08:00Z · scheduled_at → 08:00Z  ✅ ตรง
 *   เปิดจาก New York rule → 2026-08-24T19:00Z · scheduled_at → 08:00Z  🔴 ห่าง 11 ชม.
 *
 * ไม่มี error ไม่มี log — campaign แค่ยิงผิดเวลา และเงื่อนไขก็คัดคนผิดกลุ่ม
 * บนเครื่องที่ TZ เป็นไทยมันตรงกัน **โดยบังเอิญ** ซึ่งคือเหตุผลที่ไม่มีใครเห็น
 *
 * 🔴 ทำไมเลือก "+07:00 คงที่" ไม่ใช่ "offset ของเบราว์เซอร์"
 *    เพราะ `docs/TIME-RULE.md` กฎข้อ 2 เขียนไว้เองว่า *"UI แสดงและรับค่าเป็นเวลาไทย
 *    (+07:00) — คนกรอกไม่ต้องคิดเรื่อง timezone"* และแคมเปญนี้ยิงหาลูกค้าไทย
 *    ⇒ `15:00` ต้องแปลว่า 15:00 เวลาไทย **ไม่ว่าคนตั้งจะนั่งอยู่ที่ไหน**
 *    การอ่าน offset จากเบราว์เซอร์ทำให้แคมเปญใบเดียวกันเปลี่ยนความหมายตามคนเปิด
 *    ซึ่งเป็นบั๊กชนิดเดียวกับที่ BE เคยพึ่ง `process.env.TZ` เป๊ะ ๆ แค่ย้ายมาอยู่ฝั่งจอ
 *    (ย่อหน้าเดิมใน TIME-RULE.md ที่บอกว่า localOffset อ่านจากเบราว์เซอร์ **ขัดกับกฎข้อ 2
 *     ของเอกสารตัวเอง** — แก้เอกสารพร้อมกับ commit นี้)
 *
 * 🔴 ต้องตรงกับ BE เป๊ะ ๆ — `src/modules/content/broadcast-time.ts`
 *    `DEFAULT_INPUT_OFFSET = '+07:00'` แก้ที่นึงต้องแก้อีกที่ ดู `ASSERT` ข้างล่าง
 *
 * ⚠️ ไม่ได้บวก/ลบชั่วโมงก่อนเก็บ — DB ยังเก็บ UTC instant เหมือนเดิมทุกประการ
 *    ที่เปลี่ยนคือ "สตริงที่ส่งขึ้นไปบอกโซนของตัวเองชัดเจน" เท่านั้น
 *
 * ⚠️ ไทยไม่มี DST ⇒ ตัวเลขคงที่ถูกทั้งปี ประเทศที่มี DST จะใช้แบบนี้ไม่ได้
 *    ต้องใช้ฐานข้อมูลโซนจริง — ตอนนั้นค่อยมาแก้ไฟล์นี้ไฟล์เดียว
 *
 * revert: ให้ `CAMPAIGN_OFFSET_MIN` อ่านจาก `-new Date().getTimezoneOffset()`
 * แล้วความหมายจะกลับไปขึ้นกับเครื่องคนเปิดเหมือนเดิม
 */

/**
 * โซนของแคมเปญ เป็น "นาที" ไม่ใช่ชื่อโซน — แบบเดียวกับที่ BE เก็บ
 * `schedule.tz_offset_min` (`broadcast-schedule/schedule-shape.ts`) เพื่อไม่ต้อง
 * พึ่งฐานข้อมูล timezone ที่อาจไม่มีใน container
 */
export const CAMPAIGN_OFFSET_MIN = 420; // +07:00

/**
 * `'+07:00'` — รูปแบบที่ต่อท้ายสตริงได้ตรง ๆ
 *
 * 🔴 ต้องเท่ากับ `DEFAULT_INPUT_OFFSET` ใน `omnidesk-api/src/modules/content/broadcast-time.ts`
 *    ถ้าสองค่านี้ไม่ตรงกัน ค่าที่ฟอร์มส่งกับค่าที่ BE เดาให้ script เก่าจะคนละความหมาย
 */
export const CAMPAIGN_OFFSET = formatOffset(CAMPAIGN_OFFSET_MIN);

function formatOffset(mins: number): string {
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * ค่าที่กล่อง `<input type="datetime-local">` ให้มา → ISO ที่บอกโซนของตัวเอง
 *
 * `"2026-08-24T15:00"` → `"2026-08-24T15:00:00+07:00"`
 *
 * ⚠️ กล่องว่างคืน `''` — ว่างต้องอยู่ว่าง ห้ามกลายเป็น "ตอนนี้"
 *    ค่าที่มี offset ติดมาแล้วจะถูกปล่อยผ่าน ไม่ปั๊มซ้ำ
 */
export function toCampaignIso(localValue: string): string {
  const v = localValue.trim();
  if (v === '') return '';
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(v)) return v;
  return `${v.length === 16 ? `${v}:00` : v}${CAMPAIGN_OFFSET}`;
}

/**
 * ทางกลับ: instant ที่เก็บไว้ → ตัวเลขที่กล่องต้องแสดง **ตามเวลาไทย**
 *
 * 🔴 อ่านด้วย `getUTC*` หลังเลื่อน instant ไปตามโซนของแคมเปญ — ห้ามใช้
 *    `getFullYear()/getHours()` ตรง ๆ เพราะนั่นคือเวลาของเครื่องคนเปิด
 *    ⇒ แอดมินที่ New York จะเห็น `04:00` ทั้งที่แคมเปญหมายถึง `15:00` ไทย
 *    แล้วพอเขา "แก้ให้ถูก" ก็จะทับเวลาที่ตั้งไว้ถูกอยู่แล้ว
 *    แสดงกับความหมายต้องเป็นโซนเดียวกัน ไม่งั้นกล่องโกหกคนกรอก.
 *
 * ⚠️ คืน `''` เมื่ออ่านไม่ได้ — ไม่ใช่วันนี้ ไม่ใช่ epoch. absent ≠ default.
 */
export function fromCampaignIso(stored: unknown): string {
  if (typeof stored !== 'string' || stored.trim() === '') return '';
  const d = new Date(stored);
  if (Number.isNaN(d.getTime())) return '';

  const shifted = new Date(d.getTime() + CAMPAIGN_OFFSET_MIN * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  );
}

/**
 * "ตอนนี้ ลบ N วัน" ในรูปที่กล่องแสดงได้ — ใช้โดยปุ่ม mint
 *
 * ⚠️ รับ `now` เป็นพารามิเตอร์ ไม่อ่านนาฬิกาเอง แท็บที่เปิดค้างข้ามวันจะได้ค่า
 *    ของตอนกด ไม่ใช่ของตอนโหลดไฟล์
 */
export function campaignDaysAgo(days: number, now: Date): string {
  return fromCampaignIso(
    new Date(now.getTime() - days * 86_400_000).toISOString(),
  );
}

/**
 * [FEAT-20260825-THAIDISPLAY] ชื่อโซนสำหรับ "แสดงผล" — ต้องหมายถึงโซนเดียวกับ
 * `CAMPAIGN_OFFSET_MIN` เสมอ
 *
 * 🔴 ทำไมต้องมีสองรูป: การคำนวณใช้ **ตัวเลข** ได้ (ไทยไม่มี DST) แต่การ format
 *    ด้วย `Intl` ต้องใช้ **ชื่อโซน** ⇒ ประกาศคู่กันตรงนี้ พร้อมกฎว่าต้องตรงกัน
 *    ห้ามแยกไปประกาศคนละไฟล์ เพราะวันที่แก้อันเดียวจะเพี้ยนแบบเงียบ
 *
 * ⚠️ `toLocaleString('th-TH')` เฉย ๆ **ไม่พอ** — มันตั้งแค่ *ภาษา* ไม่ได้ตั้ง *โซน*
 *    ⇒ แอดมินที่เปิดจาก New York จะเห็นเวลานิวยอร์กที่เขียนเป็นเลขไทย
 *    ต้องส่ง `timeZone` เข้าไปด้วยเสมอ ซึ่งคือเหตุผลที่ฟังก์ชันข้างล่างมีอยู่
 *    ตั้งภาษาไม่ได้แปลว่าตั้งโซน — สองอย่างนี้คนละเรื่องกัน.
 */
export const CAMPAIGN_TZ = 'Asia/Bangkok';

/**
 * instant → ข้อความเวลาไทย สำหรับ "แสดงผลอย่างเดียว"
 *
 * ⚠️ คืน `'-'` เมื่ออ่านไม่ได้ ไม่ใช่ "Invalid Date" และไม่ใช่วันนี้
 * ⚠️ ห้ามเอาผลลัพธ์ไปคำนวณต่อ — มันคือข้อความสำหรับคนอ่าน
 */
export function formatCampaignTime(
  value: unknown,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  if (typeof value !== 'string' && !(value instanceof Date)) return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', {
    timeZone: CAMPAIGN_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...opts,
  });
}
