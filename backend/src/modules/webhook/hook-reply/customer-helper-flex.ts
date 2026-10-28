/**
 * ==== [FEAT-20260810-HELPERFLEX] การ์ด flex ของ customer-helper ====
 *
 * ## ไฟล์นี้คืออะไร
 * เมื่อ AI ตอบกลับมาพร้อม tag `[[[customer-helper]]]` แปลว่า "เคสนี้ระบบทำให้เองได้
 * ถ้าลูกค้ายอมเชื่อมต่อข้อมูล" — เดิมตอบเป็น **ข้อความ + quick reply** (ปุ่มลอยล่างจอ)
 * ตอนนี้เปลี่ยนเป็น **การ์ด flex** ที่มีปุ่มอยู่บนการ์ดเลย
 *
 * ## ⚠️ ตั้งใจ HARD-CODE — เป็นของชั่วคราว
 * เจ้าของสั่งให้ hard-code ไว้ก่อนเพื่อใช้งานเฉพาะกรณีนี้ ยังไม่ต้องทำเป็นเทมเพลต
 * ที่แก้ได้จากหน้าเว็บ **อย่าเพิ่งไปต่อยอดเป็นระบบเทมเพลต** จนกว่าเจ้าของจะสั่ง
 *
 * ## ถ้าจะย้ายไปเป็นเทมเพลตที่แก้ได้ภายหลัง
 * ทำได้โดยไม่ต้องแตะที่เรียกใช้เลย — แค่เปลี่ยนข้างในฟังก์ชันนี้ให้ไปอ่านจาก
 * `flex_messages` แทน object คงที่ ตราบใดที่ยังคืนรูปเดิม (bubble ที่มี 2 ปุ่ม)
 * โครงข้างนอกไม่รู้ว่าข้อความมาจากไหน — เปลี่ยนแหล่งได้อิสระ
 *
 * ## revert
 * ลบไฟล์นี้ + ลบบล็อก `[FEAT-20260810-HELPERFLEX]` ใน `webhook.service.ts`
 * ⇒ กลับไปตอบเป็นข้อความ + quick reply แบบเดิม 100% ไม่มีอะไรค้าง
 */

/**
 * URL ที่ใช้เมื่อ OA **ไม่ได้ตั้ง** `customer_link_landing_url`
 *
 * ⚠️ ตั้งใจให้ต่างจาก `CUSTOMER_LANDING_DEFAULT_URL` ('https://customer.example.comm')
 * ใน `customer-register.handler.ts:37` — เจ้าของสั่งเฉพาะเจาะจงว่า **การ์ดนี้**
 * ถ้าไม่ตั้งค่าให้ชี้ google.com เพื่อให้เห็นชัดว่า "แอดมินยังไม่ได้ตั้งค่า"
 * ไม่ใช่พาลูกค้าไปหน้า landing กลางที่อาจไม่ใช่ของ OA นั้น
 *
 * ⇒ อย่ารวมสองค่านี้เข้าด้วยกัน มันคนละเจตนา:
 *   - customer-register  : ลงทะเบียนจริง → ใช้ landing กลางที่ใช้งานได้
 *   - customer-helper    : ตั้งใจให้ "ดูออกว่าลืมตั้งค่า"
 * ห้ามรวมสองค่านี้ เจตนาคนละอย่าง.
 */
export const HELPER_FALLBACK_URI = 'https://google.com';

/** ข้อความบนการ์ด — แก้คำที่นี่ที่เดียว */
export const HELPER_BODY_TEXT =
  'สำหรับกรณีนี้ น้องลัคกี้ AI ผู้ช่วย สามารถดำเนินการให้ได้ทันทีโดยไม่ต้องรอพี่แอดมิน ' +
  'แต่ต้องขอเชื่อมต่อข้อมูลของคุณลูกค้าก่อนนะคะ';

/** ป้ายปุ่ม + ข้อความที่ปุ่มที่สองส่งกลับเข้าระบบ */
export const HELPER_BTN_CONNECT_LABEL = 'อนุญาตให้เชื่อมต่อ';
export const HELPER_BTN_ADMIN_LABEL = 'ติดต่อแอดมิน';
export const HELPER_BTN_ADMIN_TEXT = 'ติดต่อแอดมิน';

/** altText ที่โผล่ในรายการแชท/แจ้งเตือน — LINE ไม่ยอมรับค่าว่าง */
export const HELPER_ALT_TEXT = 'ขออนุญาตเชื่อมต่อข้อมูล';

/**
 * สร้าง flex bubble ของ customer-helper
 *
 * @param connectUri URL ของหน้า landing ที่ mint มาแล้ว ถ้าไม่มี/ไม่ใช่ http(s)
 *                   จะใช้ HELPER_FALLBACK_URI แทน — LINE ปฏิเสธทั้งข้อความถ้า
 *                   `uri` ไม่ถูกรูป ปล่อยค่าเสียไปจึงเท่ากับลูกค้าไม่ได้อะไรเลย
 */
export function buildCustomerHelperFlex(
  connectUri: string | null | undefined,
): Record<string, unknown> {
  const uri =
    typeof connectUri === 'string' && /^https?:\/\//i.test(connectUri)
      ? connectUri
      : HELPER_FALLBACK_URI;

  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: HELPER_BODY_TEXT,
          weight: 'bold',
          size: 'md',
          wrap: true,
          align: 'center',
          gravity: 'center',
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        {
          type: 'button',
          style: 'primary',
          height: 'md',
          action: {
            type: 'uri',
            label: HELPER_BTN_CONNECT_LABEL,
            uri,
          },
        },
        {
          // ปุ่มนี้ "ส่งข้อความ" กลับเข้าระบบ ไม่ใช่ postback — ตั้งใจตามที่เจ้าของสั่ง
          // ข้อความที่ส่งจะไหลเข้า webhook เหมือนลูกค้าพิมพ์เอง แล้ว flow เดิม
          // (auto-reply / handoff) จัดการต่อ ไม่ต้องเพิ่ม handler ใหม่
          type: 'button',
          style: 'secondary',
          height: 'md',
          action: {
            type: 'message',
            label: HELPER_BTN_ADMIN_LABEL,
            text: HELPER_BTN_ADMIN_TEXT,
          },
        },
      ],
    },
  };
}

/**
 * ==== [FEAT-20260810-CUSHELPERTYPE] เลือกการ์ดที่จะใช้ตอบ ====
 *
 * ลำดับ: การ์ดที่ OA ผูกไว้ (`hook.flex_customerhelper_id`) → ถ้าไม่มี/ใช้ไม่ได้
 * ⇒ ตกกลับการ์ด hard-code ข้างบน ⇒ **seamless** OA ที่ไม่ตั้งอะไรได้ของเดิมเป๊ะ
 *
 * ⚠️⚠️ PERM — กันการ์ดหลุดข้าม OA (เจ้าของกำชับ)
 * ตรวจ 3 ชั้นก่อนยอมใช้การ์ดที่ผูกไว้:
 *   1. `flex_type === 'customerhelper'` — การ์ดชนิดอื่นมีตัวแปรคนละชุด ถ้าเอามาใช้
 *      จะเหลือ {{...}} ดิบให้ลูกค้าเห็น
 *   2. ยังไม่ถูกลบ (`deleted_at`)
 *   3. **การ์ดต้องอยู่กลุ่มเดียวกับ hook** — `flex.group_ids` ต้องมี `hook.group`
 *      ⇒ ต่อให้มีคนใส่ id ของการ์ดจากกลุ่มอื่นลง DB ตรง ๆ (หรือ FE พลาด)
 *        ก็จะไม่ถูกส่งออกไป การ์ดของ OA เจ้าอื่นจึงหลุดข้ามกลุ่มไม่ได้
 *   ทุกชั้นที่ไม่ผ่าน ⇒ ตกกลับ hard-code เงียบ ๆ (ลูกค้ายังได้คำตอบ ไม่ค้าง)
 *
 * ⚠️ ไม่ throw เด็ดขาด — นี่คือเส้นตอบลูกค้า การโยน error จะทำให้ลูกค้าไม่ได้อะไรเลย
 *
 * revert: ลบฟังก์ชันนี้ + ให้ webhook เรียก `buildCustomerHelperFlex(uri)` ตรง ๆ
 *         ⇒ กลับไปใช้การ์ด hard-code อย่างเดียวเหมือนก่อน
 */
export interface HelperCardLookupDeps {
  /** อ่านการ์ดจาก flex_messages ตาม id — คืน null ถ้าไม่เจอ (ห้าม throw) */
  findFlexById: (id: unknown) => Promise<{
    flex_type?: string | null;
    content_json?: unknown;
    group_ids?: unknown[];
    deleted_at?: unknown;
  } | null>;
  /** log เตือนเมื่อการ์ดที่ผูกไว้ใช้ไม่ได้ — ไม่ทำให้ flow ล้ม */
  warn?: (msg: string) => void;
}

export async function resolveCustomerHelperFlex(
  hook: Record<string, unknown> | null | undefined,
  connectUri: string | null | undefined,
  deps: HelperCardLookupDeps,
): Promise<Record<string, unknown>> {
  const boundId = hook?.['flex_customerhelper_id'];
  if (!boundId) return buildCustomerHelperFlex(connectUri);

  try {
    const card = await deps.findFlexById(boundId);
    const reason = !card
      ? 'ไม่พบการ์ด'
      : card.deleted_at
        ? 'การ์ดถูกลบแล้ว'
        : card.flex_type !== 'customerhelper'
          ? `ชนิดไม่ตรง (${String(card.flex_type)})`
          : !card.content_json
            ? 'การ์ดว่าง'
            : !sameGroup(hook?.['group'], card.group_ids)
              ? 'การ์ดอยู่คนละกลุ่มกับ OA'
              : '';

    if (reason) {
      deps.warn?.(
        `[CUSHELPER] ใช้การ์ดที่ผูกไว้ไม่ได้ (${reason}) → ใช้การ์ดสำรอง`,
      );
      return buildCustomerHelperFlex(connectUri);
    }
    return renderHelperUri(
      card!.content_json as Record<string, unknown>,
      connectUri,
    );
  } catch (err) {
    deps.warn?.(`[CUSHELPER] อ่านการ์ดล้มเหลว: ${(err as Error).message}`);
    return buildCustomerHelperFlex(connectUri);
  }
}

/** hook อยู่กลุ่มเดียว (`group`) · การ์ดอยู่ได้หลายกลุ่ม (`group_ids`) — ต้องทับกัน */
function sameGroup(
  hookGroup: unknown,
  cardGroups: unknown[] | undefined,
): boolean {
  if (!hookGroup) return false;
  const g = String(hookGroup);
  return (cardGroups ?? []).some((x) => String(x) === g);
}

/**
 * ==== [FIX-20260810-HELPERURIFILL] เสียบ mint URL ลงปุ่ม uri ที่ใช้ไม่ได้ ====
 *
 * WHAT: หลังแทน `{{cus_land_url}}` แล้ว ยังเดินหา `action.type === 'uri'` ทุกปุ่ม
 *       ปุ่มไหน `uri` ไม่ใช่ http(s) ⇒ เสียบ mint URL ให้
 * WHY:  เดิมฟังก์ชันนี้ "แทนข้อความ" อย่างเดียว ⇒ mint URL ที่ได้มาแล้วถูกทิ้ง
 *       ถ้าแอดมินไม่ได้พิมพ์ tag เป๊ะ (เจอจริง: พิมพ์ `"mintt xx"`) และ LINE
 *       **ปฏิเสธทั้งข้อความ** เมื่อ uri ไม่ขึ้นต้น http(s) ⇒ การ์ดไม่ออก ตกไปเป็น
 *       text ที่มี tag ดิบถึงลูกค้า การ์ด hard-code มี guard นี้อยู่แล้ว (:61-64)
 *       การ์ดของแอดมินจึงต้อง fail-safe เท่ากัน — เจ้าของสั่ง: "เจอ tag ⇒ ส่งการ์ด
 *       ที่ผูกไว้พร้อม mint ทันที ไม่ใช่ส่งดิบหาลูกค้า"
 * HOW:  uri ที่เป็น http(s) อยู่แล้ว **ไม่แตะ** — ปุ่มที่แอดมินตั้งใจชี้ลิงก์อื่น
 *       (โปรโมชัน/หน้าเว็บ) ต้องไม่ถูกเขียนทับ เสียบทับเฉพาะค่าที่ LINE ใช้ไม่ได้
 * revert: ลบ `fillUriActions` + จุดเรียก ⇒ กลับไปแทนเฉพาะ tag เหมือนเดิม
 *
 * แทน `{{cus_land_url}}` ทำบน JSON string เพื่อให้ครอบทุกที่ที่ tag โผล่
 * (uri ของปุ่ม, ข้อความ, altText) ค่าถูก JSON.stringify ก่อนเสียบ จึง escape ให้เอง
 *
 * tag อื่น ({{hook_domain}}, {{site_rules.*}}) ปล่อยให้ตัวเรนเดอร์กลางจัดการ
 * ตามเส้นเดิม — ที่นี่รับผิดชอบเฉพาะ tag ที่ระบบนี้เป็นคนสร้างค่า
 */
function renderHelperUri(
  contentJson: Record<string, unknown>,
  connectUri: string | null | undefined,
): Record<string, unknown> {
  const uri =
    typeof connectUri === 'string' && /^https?:\/\//i.test(connectUri)
      ? connectUri
      : HELPER_FALLBACK_URI;
  try {
    const raw = JSON.stringify(contentJson);
    const filled = raw.replace(
      /\{\{\s*cus_land_url\s*\}\}/g,
      // ตัด quote หัวท้ายที่ stringify ใส่มา เพราะเรากำลังเสียบ "ข้างใน" string อยู่แล้ว
      JSON.stringify(uri).slice(1, -1),
    );
    const card = JSON.parse(filled) as Record<string, unknown>;
    fillUriActions(card, uri);
    return card;
  } catch {
    // การ์ดพัง JSON ไม่ควรทำให้ลูกค้าไม่ได้คำตอบ
    return buildCustomerHelperFlex(connectUri);
  }
}

/**
 * เดินทั้งการ์ดแบบ in-place หา `action.type === 'uri'` แล้วซ่อม `uri` ที่ LINE ใช้ไม่ได้
 *
 * ⚠️ ตรวจ `type === 'uri'` เท่านั้น — ปุ่ม `message`/`postback` มี `text`/`data`
 *    ไม่มี `uri` การไปเสียบให้จะเปลี่ยนชนิดปุ่มและทำ flow เดิมพัง
 * ⚠️ `http(s)` ที่ใช้ได้อยู่แล้วไม่แตะ (ดูเหตุผลใน header ด้านบน)
 */
function fillUriActions(node: unknown, uri: string): void {
  if (Array.isArray(node)) {
    for (const item of node) fillUriActions(item, uri);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (
    obj['type'] === 'uri' &&
    !(typeof obj['uri'] === 'string' && /^https?:\/\//i.test(obj['uri']))
  ) {
    obj['uri'] = uri;
  }
  for (const value of Object.values(obj)) fillUriActions(value, uri);
}

/**
 * ==== [FIX-20260810-HELPERHISTORYURI] สำเนาการ์ดสำหรับ "หน้าแชทแอดมิน" ====
 *
 * WHAT: คืนการ์ดชุดใหม่ที่ทุกปุ่ม `type: 'uri'` ถูกเปลี่ยนเป็น
 *       `HELPER_HISTORY_URI` (google.com) — ใช้เก็บลงประวัติเท่านั้น
 * WHY:  `uri` บนการ์ดจริงคือ **mint token ของ member คนนั้นโดยเฉพาะ**
 *       ถ้าแอดมินกดจากหน้าแชท = เชื่อมต่อข้อมูลแทนลูกค้า และ token ถูกใช้ทิ้ง
 *       ลูกค้าตัวจริงกดต่อไม่ได้ เจ้าของสั่ง: "ห้ามกดได้ ให้ชี้ google.com แทน"
 * HOW:  **deep copy ก่อนเสมอ** (structuredClone) — การ์ดที่ส่งไป LINE เป็น object
 *       เดียวกับที่ส่งเข้าบล็อกนี้ ถ้าแก้ in-place จะไปเปลี่ยนปุ่มของลูกค้าด้วย
 *       ⇒ นี่คือหัวใจของฟังก์ชัน อย่าเอา clone ออกเด็ดขาด
 * ⚠️ เรียก **หลัง** ส่ง LINE เสร็จแล้วเท่านั้น (บล็อก flex-history)
 * revert: ลบฟังก์ชันนี้ + ให้ประวัติเก็บการ์ดตรง ๆ เหมือนเดิม
 */
export const HELPER_HISTORY_URI = 'https://google.com';

export function stripHelperUriForHistory(
  card: Record<string, unknown>,
): Record<string, unknown> {
  // structuredClone รองรับ JSON-ล้วนอยู่แล้ว (การ์ด flex เป็น JSON ทั้งใบ)
  const copy = structuredClone(card);
  blankUriActions(copy);
  return copy;
}

/** คู่แฝดของ `fillUriActions` แต่ "ล้าง" แทน "เติม" — เขียนทับ uri ทุกตัวไม่มีข้อยกเว้น */
function blankUriActions(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) blankUriActions(item);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (obj['type'] === 'uri') obj['uri'] = HELPER_HISTORY_URI;
  for (const value of Object.values(obj)) blankUriActions(value);
}
