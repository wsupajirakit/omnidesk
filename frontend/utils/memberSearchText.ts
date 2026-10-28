/**
 * ==== [FIX-20260817-SEARCHRAWPROFILE] แหล่งเดียวของ "ข้อความที่ค้นลูกค้าได้" ====
 *
 * ## ปัญหาที่แก้ (รายงานเข้ามา 17/08)
 * ค้นด้วย **เลขบัญชี** ที่ panel ขวาโชว์อยู่ (`5864854725`) แล้วหน้า ticket-support
 * ไม่เจออะไรเลย
 *
 * ## ต้นเหตุจริง — ค้น field ที่ไม่มีอยู่ในฐานข้อมูล
 * `TicketChat` เคยประกอบ haystack จาก `ud.bank_account` · `ud.bank_name` ·
 * `ud.account_name` · `ud.true_wallet` · `ud.domain` · `ud.agent` · `ud.agent_code`
 * — **ทั้ง 7 ตัวไม่มีอยู่ใน `member.schema.ts` เลย** (ตรวจแถวจริง: `undefined` ทุกตัว)
 * ค่าจริงอยู่ใน `raw_profile_data` ที่ปลายทางส่งมา:
 *
 * ```
 * raw.data.profile.bank.account_no    = "5864854725"   ← เลขบัญชี
 * raw.data.profile.bank.account_name  = "judy"
 * raw.data.profile.bank.code          = "BBL"
 * raw.data.profile.phone              = "0955550010"
 * ```
 * (`web_code` = domain และ `line_of_work` = agent มีอยู่ใน raw เหมือนกัน แต่ข้อกำหนด
 *  ระบุว่า **ไม่ต้อง** ค้นสองตัวนี้ จึงไม่อยู่ในรายการ path ด้านล่าง)
 * ⇒ คำค้นพวกนั้น "ตาย" มาตลอด ไม่ใช่ค้นแล้วพลาด
 *
 * ## ทำไมอยู่ไฟล์นี้
 * แพตเทิร์นเดียวกับ `utils/memberTier.ts` (`[FIX-20260810-TIERSOURCE]`) ที่ตั้งไว้
 * เพื่อเรื่องนี้พอดี: ค่าลูกค้าที่อยู่ได้ทั้งใน DB field และใน `raw_profile_data`
 * ต้องมี **ที่อ่านที่เดียว** ไม่งั้นแต่ละหน้าจะเห็นไม่เหมือนกัน · และ `TicketChat`
 * เคยมี haystack **ก๊อปไว้ 2 ชุด** (`:1371`, `:1516`) ซึ่งเป็นทางที่มันจะเพี้ยนต่างกันในอนาคต
 *
 * ## ที่ตั้งใจไม่ทำ
 * - **ไม่ยัดทั้ง blob ลง haystack** — `raw_profile_data` หนัก 1.6–7.9 KB/แถว และมี
 *   ทั้ง promotion/finance/transaction/bonus ที่ไม่ใช่ตัวระบุตัวตน · อ่านเฉพาะ path
 *   ที่ระบุไว้ข้างบน ⇒ ไม่มี token/url/id ภายในหลุดเข้าไปในช่องค้นหา
 * - ไม่แตะ BE/DB/webhook: payload ของ ticket list มี `raw_profile_data` มาให้แล้ว
 *   (ตรวจจริง 5/5 แถว)
 *
 * revert: ลบไฟล์นี้ แล้วคืน array เดิมทั้ง 2 จุดใน TicketChat (พฤติกรรมเดิม = ค้นเลขบัญชีไม่เจอ)
 */

/**
 * path ของค่าที่ค้นได้ใน raw profile — **เพิ่ม/ลดที่นี่ที่เดียว**
 *
 * รายการที่ต้องค้นได้: ชื่อไลน์ · เบอร์ · ชื่อ-สกุล · เลขที่บัญชี
 * ⇒ จาก raw ต้องมี 3 ตัวนี้: เบอร์ในโปรไฟล์ · เลขบัญชี · ชื่อบัญชี
 *
 * ⛔ ตั้งใจ **ไม่** ใส่ (ข้อกำหนด 17/08 — ไม่รวม domain และ agent):
 *   `web_code` (domain) · `line_of_work` (agent/สายงาน)
 * และไม่ใส่ `bank.code` / `truewallet` เพราะไม่ได้อยู่ในรายการที่สั่ง — ถ้าต้องการ
 * ภายหลัง เพิ่มบรรทัดเดียวที่นี่ ไม่ต้องแก้ที่หน้าเพจ
 */
const RAW_PROFILE_PATHS = [
  'phone',
  'bank.account_no',
  'bank.account_name',
] as const;

const pick = (obj: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object'
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      obj,
    );

/**
 * ตัว profile ที่แท้จริงในก้อน raw
 *
 * ปลายทางบางเจ้าห่อ `{ data: { profile } }` บางเจ้าเป็น `{ profile }` ตรง ๆ บางเจ้า
 * ส่งเนื้อมาเลย — ลองทั้งสามรูปแบบเดียวกับที่ `tierOfMember` ทำ (ไฟล์นั้นเจอมาแล้วจริง)
 */
const profileOf = (raw: unknown): unknown => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  return r.data?.profile ?? r.profile ?? r;
};

/** เลขล้วนของค่าที่มีตัวเลข เพื่อให้พิมพ์ "586-485-4725" หรือมีเว้นวรรคก็ยังเจอ */
const digitsOnly = (value: string): string | null => {
  const digits = value.replace(/\D+/g, '');
  return digits.length >= 4 && digits !== value ? digits : null;
};

/**
 * ข้อความค้นหาของลูกค้าหนึ่งคน — lowercase, คั่นด้วยช่องว่าง
 *
 * @param member  `line_user_data` ที่มากับ ticket (หรือ member ที่โหลดแยก)
 * @param extras  ค่าที่ผู้เรียกมีเพิ่ม เช่น `line_user_id` ของตั๋ว หรือค่าที่แกะจาก
 *                `detail` ด้วย `parseCustomerDetail` (parser นั้นอยู่ในคอมโพเนนต์
 *                จึงไม่ import เข้ามาที่นี่ — ไฟล์นี้ต้องไม่พึ่ง React)
 *
 * ⚠️ รับ `any` โดยตั้งใจ เหมือน `tierOfMember`: รูปของ raw profile มาจากปลายทางภายนอก
 * ที่ไม่คงที่ การผูกชนิดแน่นจะพังทุกครั้งที่ปลายทางเปลี่ยนรูป
 */
/**
 * [FEAT-20260819-LINEGLOW] Does this customer have a raw profile at all?
 *
 * The LINE mark glows green for customers the site actually knows — the owner's
 * signal that a card is backed by real account data rather than a bare LINE
 * contact. It lives here because this file already owns the shape of
 * `raw_profile_data` (see `profileOf`), and a second opinion about "has a
 * profile" is exactly how two screens start disagreeing.
 *
 * An EMPTY object is not a profile: the sync writes `{}` on a 404, so treating
 * any object as present would light up every unlinked customer.
 * มีจริงเท่านั้นถึงเรือง · {} ที่มาจาก 404 ไม่นับ.
 */
export const hasRawProfile = (member?: { raw_profile_data?: unknown } | null): boolean => {
  const profile = profileOf(member?.raw_profile_data) as Record<string, unknown> | null;
  return !!profile && typeof profile === 'object' && Object.keys(profile).length > 0;
};

export const memberSearchHaystack = (
  member: any,
  extras: Array<string | null | undefined> = [],
): string => {
  const values: Array<string | null | undefined> = [
    // field จริงบน member (มีอยู่ใน schema)
    member?.phone_number,
    member?.display_name,
    member?.nickname,
    member?.full_name,
    member?.contract_code,
    member?.detail,
    member?.line_user_id,
    member?.channel_user_id,
    ...extras,
  ];

  const profile = profileOf(member?.raw_profile_data);
  for (const path of RAW_PROFILE_PATHS) {
    const v = pick(profile, path);
    if (v !== null && v !== undefined && typeof v !== 'object') {
      values.push(String(v));
    }
  }

  const parts: string[] = [];
  for (const v of values) {
    const text = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
    if (!text) continue;
    parts.push(text);
    const digits = digitsOnly(text);
    if (digits) parts.push(digits);
  }

  return parts.join(' ').toLowerCase();
};

/**
 * ลูกค้าคนนี้ตรงกับคำค้นไหม
 *
 * กฎการเทียบอยู่ที่นี่ที่เดียว เพราะหน้า ticket มีตัวกรองนี้ **สองชุด** (`:1371`, `:1516`)
 * ถ้าปล่อยให้แต่ละที่เทียบเอง วันหนึ่งมันจะให้ผลไม่เหมือนกัน
 *
 * - เทียบแบบ "มีคำนี้อยู่ข้างใน" (substring) — ภาษาไทยไม่มีเว้นวรรค การเทียบทีละคำใช้ไม่ได้
 * - คำค้นที่พิมพ์มาพร้อมขีด/เว้นวรรค เช่น `586-485-4725` หรือ `095 555 0010`
 *   จะถูกลองในรูป **เลขล้วน** ด้วย (haystack เก็บทั้งสองรูปไว้แล้ว)
 * - คำค้นว่าง = ไม่กรอง (คืน true) ให้ผู้เรียกไม่ต้องเช็คซ้ำ
 */
export const memberMatchesSearch = (
  member: any,
  rawTerm: string | null | undefined,
  extras: Array<string | null | undefined> = [],
): boolean => {
  const term = (rawTerm ?? '').trim().toLowerCase();
  if (!term) return true;

  const hay = memberSearchHaystack(member, extras);
  if (hay.includes(term)) return true;

  const digits = term.replace(/\D+/g, '');
  return digits.length >= 4 ? hay.includes(digits) : false;
};
