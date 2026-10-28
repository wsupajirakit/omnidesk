/**
 * [FEAT-20260824-BCASTMINT] Mint — one click fills in a condition nobody can
 * remember the key for.
 * ===========================================================================
 * เจ้าของ 24/08: *"เพิ่มปุ่ม mint for create multicast · mint ใส่ข้อมูล where member
 * follow up [deposit at] จำไม่ได้ ลืมชื่อคีย์หาเอาจริง ๆ · mint ได้สองแบบ deposit + withdraw ·
 * กดปุ่ม modal เตือน ให้เลือก dep หรือ with แล้วมิ้นค่าให้ในฟอร์ม"* ·
 * *"ทำเป็น module mint boardcast/multicast ไว้ จะมี mint อื่น ๆ อีก ห้ามสร้างหนี้ ต้องเพิ่มง่าย"*.
 *
 * ── ปัญหาที่ปุ่มนี้แก้ ────────────────────────────────────────────────────────
 * ตัวเงื่อนไขมีอยู่แล้วและใช้ได้อยู่แล้ว สิ่งที่ไม่มีคือ "จำชื่อคีย์ได้" — เจ้าของเปิดฟอร์ม
 * แล้วหา `follow_up.notice_deposit_at` ไม่เจอเพราะจำชื่อไม่ได้ ⇒ ปุ่มนี้ไม่ได้เพิ่ม
 * ความสามารถใหม่ให้ระบบเลย มันแค่ "กรอกแทน" สิ่งที่กรอกเองได้อยู่แล้ว
 *
 * 🔴 ADDING A MINT = ADDING ONE ENTRY TO `MINTS`, and that is the whole design.
 *    No component, no modal, no test and no i18n plumbing learns a new name:
 *    the button renders from this table, the modal renders its `choices` from
 *    this table, and `mintRules.ts` turns whichever choice was picked into
 *    rules. เพิ่ม mint ใหม่ = เพิ่ม 1 entry ที่นี่ จบ ไม่ต้องแตะไฟล์อื่น.
 *
 * 🔴 EVERY RULE HERE MUST ALREADY EXIST IN THE BACKEND REGISTRY
 *    (`audience/sources/audience-source.registry.ts`). A mint that invents a
 *    key produces a condition the runner silently ignores — the campaign then
 *    sends to a WIDER audience than the screen shows, with no error anywhere.
 *    So a mint is a SHORTCUT to something already supported, never a way to
 *    add a new selector. คีย์ที่นี่ต้องมีจริงใน registry ฝั่ง BE ไม่งั้นเงื่อนไขจะถูกทิ้งเงียบ ๆ
 *    แล้วยิงกว้างกว่าที่เห็นบนจอ.
 *
 * ⚠️ `op` ที่คีย์กลุ่ม follow_up รองรับมีแค่ `lte` กับ `gte` (BE ประกาศไว้
 *    `ops: ['lte','gte']`) ⇒ ห้ามใส่ op อื่นที่นี่ ฟอร์มจะโชว์ค่าที่ BE ไม่รับ
 *
 * revert: ลบโฟลเดอร์ `components/campaign/mint/` + import กับบล็อก `<MintButton …/>`
 * ใน `BroadcastFormModal.tsx` — ฟอร์มกลับไปกรอกมือเหมือนเดิม ไม่มีอะไรพัง
 */

/** Operators the audience engine understands for a `date` source. */
export type MintOp = 'lte' | 'gte' | 'has_value';

/**
 * How a mint decides the value it fills in.
 *
 * ⚠️ `daysAgo` เก็บเป็น "จำนวนวัน" ไม่ใช่เวลาสำเร็จรูป — เวลาต้องคำนวณ ณ ตอนกด
 *    ไม่ใช่ตอน import ไฟล์ ไม่งั้นแท็บที่เปิดค้างข้ามวันจะ mint วันที่ของเมื่อวาน
 *    (เก็บค่าคงที่ = ค่าจะแก่ตามอายุของแท็บ). See `mintRules.ts`.
 */
/** One button inside the chooser modal. */
export interface MintChoice {
  readonly id: string;
  /** i18n key for the button label. */
  readonly label_key: string;
  /** i18n key for the one-line explanation under it. */
  readonly hint_key: string;
  /** MUST match a `key` in the backend audience-source registry. */
  readonly rule_key: string;
  readonly op: MintOp;
}

/** One mint: a button in the form, and the choices its modal offers. */
export interface MintDefinition {
  readonly id: string;
  /** i18n key for the button in the target section. */
  readonly label_key: string;
  /** i18n key for the modal's title. */
  readonly title_key: string;
  readonly choices: readonly MintChoice[];
}

/**
 * How far back a follow-up mint reaches, in days.
 *
 * ⚠️ Named, not inlined twice: deposit and withdraw must not drift apart by a
 * later edit that only remembers one of them. เลขเดียว ใช้ร่วมกัน.
 */
/* [FIX-20260826-MINTHASVALUE] mint เลิกกรอกเวลาแล้ว — คีย์กลุ่มนี้ถูกล็อกที่ "มีค่า"
   ─────────────────────────────────────────────────────────────────────────────
   🔴 ต้นเหตุ: ฝั่ง BE `[UI-20260825-LOCKHASVALUE]` ล็อก 4 คีย์นี้ไว้ที่
      `ops: ['has_value']` อย่างเดียว (audience-source.registry.ts)
      เพราะ stamp พวกนี้เป็น **ROLLING — ถูกทับค่าใหม่ทุกครั้งที่ส่งการ์ด/แจ้งเตือน**
      ⇒ เงื่อนไขที่อิงเวลาเปลี่ยนความหมายไปเองโดยไม่มีใครแก้อะไร
      ⚠️ เกิดขึ้นจริง 25/08: งาน "ชวนลงทะเบียน" ตั้ง `lte 16:07` แต่ member ถูก
         ประทับ 16:26 ⇒ ผู้รับ 0 คน ⇒ `refused-plan: empty`
   ⇒ mint จึงต้องกรอก `has_value` และ **ไม่ส่งเวลาเลย** ไม่งั้นมันกรอกรูปแบบที่
     ฝั่ง BE ปฏิเสธ และแอดมินเห็นช่องเวลาที่ไม่มีความหมายบนหน้าจอ
   ⚠️ `FOLLOW_UP_DAYS_AGO` ถูกลบทิ้ง ไม่ใช่ตั้งเป็น 0 — ค่าคงที่ที่ไม่มีใครอ่าน
      คือกับดักให้คนหลังเข้าใจผิดว่าเวลายังมีผล
   revert: คืน `op: 'lte'` + `value: { daysAgo: 0 }` ที่ทุก choice แล้วเอา
           `FOLLOW_UP_DAYS_AGO` กลับมา (ดู git history ของไฟล์นี้) */

/**
 * ⚠️ `lte` (ก่อนหน้า) ไม่ใช่ `gte` — และนี่คือคำตอบของเจ้าของ 24/08.
 *    `lte + 7 วันที่แล้ว` = "เคยแจ้งเตือนเรื่องฝาก แต่นานแล้ว" = คนที่ควร follow up ซ้ำ
 *    ซึ่งเป็นเหตุผลที่คนตั้ง campaign อยู่แล้ว · `gte` จะได้ "คนที่เพิ่งถูกแจ้งเตือน"
 *    ซึ่งเป็นกลุ่มตรงข้ามและแทบไม่มีใครอยากยิงซ้ำ
 */
export const MINTS: readonly MintDefinition[] = [
  {
    id: 'follow_up_notice',
    label_key: 'broadcast.mint_follow_up',
    title_key: 'broadcast.mint_follow_up_title',
    choices: [
      {
        id: 'deposit',
        label_key: 'broadcast.mint_follow_up_deposit',
        hint_key: 'broadcast.mint_follow_up_deposit_hint',
        rule_key: 'follow_up.notice_deposit_at',
        op: 'has_value',
      },
      {
        id: 'withdraw',
        label_key: 'broadcast.mint_follow_up_withdraw',
        hint_key: 'broadcast.mint_follow_up_withdraw_hint',
        rule_key: 'follow_up.notice_withdraw_at',
        op: 'has_value',
      },
      /* [FIX-20260826-MINTHASVALUE] เจ้าของสั่งเพิ่ม 26/08: "ปุ่ม mint เพิ่มตัวเลือก
         เคยได้รับการ์ด" · คีย์นี้ถูกล็อกที่ `has_value` เหมือนอีกสองตัว
         (audience-source.registry.ts — label ฝั่ง BE คือ
          "ได้รับการ์ดลงทะเบียนแต่ยังไม่ลงทะเบียน")
         ⚠️ ชื่อคีย์คือ `customer_helper_at` แต่ path จริงในฐานคือ
            `config.follow_up.line.customer_helper_trigger_at` — ชื่อไม่ตรงกันโดย
            ธรรมชาติของ registry · **ห้ามเดาชื่อ path เอง** ให้ส่ง `key` ไป BE แปลให้ */
      {
        id: 'customer_helper',
        label_key: 'broadcast.mint_follow_up_card',
        hint_key: 'broadcast.mint_follow_up_card_hint',
        rule_key: 'follow_up.customer_helper_at',
        op: 'has_value',
      },
    ],
  },
];

/** Look one up by id. `undefined` — never a guess — when nothing matches. */
export function mintById(id: string): MintDefinition | undefined {
  return MINTS.find(m => m.id === id);
}
