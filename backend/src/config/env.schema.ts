import { z } from 'zod';

/**
 * Environment contract for the whole service.
 *
 * Every key here was taken from a real `process.env.*` reference in the legacy
 * backend — nothing is invented. Validation runs once at boot and throws, so a
 * missing or malformed variable fails the deploy instead of surfacing as a
 * confusing 500 on the first request that happens to need it.
 *
 * Grouping mirrors the runtime concerns (core / mongo / redis / jwt / ...) so a
 * feature module can depend on one narrow slice instead of the whole env blob.
 */

/** Accepts "true"/"1"/"yes" (case-insensitive) — the legacy flags used all three. */
const booleanFromString = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return defaultValue;
      return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
    });

/**
 * @param max เพดานบน — **ไม่ส่ง = ไม่มีเพดาน** ซึ่งคือพฤติกรรมเดิมทุกประการ
 *   ตัวแปรที่ยังไม่ส่ง `max` จึง parse เหมือนเดิมทุกค่า (พิสูจน์ด้วย proof
 *   BEFORE/AFTER ตอนเพิ่มเพดานให้หมวด rate limit — 23/08/2026)
 */
const intFromString = (defaultValue: number, min = 0, max?: number) => {
  let n = z.number().int().min(min);
  if (max !== undefined) n = n.max(max);
  return z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === '' ? defaultValue : Number(value),
    )
    .pipe(n);
};

const floatFromString = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === '' ? defaultValue : Number(value),
    )
    .pipe(z.number());

/** Comma-separated list -> trimmed array, empty entries dropped. */
const csvList = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

/* ── [FEAT-20260823-ENVCEIL] เพดานบนของหมวด rate limit — แก้ที่เดียวจบ ────────
 * เจ้าของสั่ง 23/08/2026 หลังพบว่าค่าพวกนี้ "พังเงียบ" ได้:
 *   ตั้ง 0 → แอปไม่บูต ฟ้องทันที ✅   ·   ตั้ง 30000 → แอปเปิดปกติ **แต่ตัว
 *   จำกัดตายสนิท ไม่มีอะไรเตือน** ❌ — ด้านที่อันตรายกว่ากลับไม่มีการ์ด.
 *
 * ใส่เพดานแล้ว "พังเงียบ" กลายเป็น "พังดัง": พิมพ์เกิน = แอปไม่บูต พร้อม
 * ข้อความบอกชื่อตัวแปรและเพดาน แทนที่จะขึ้นมาแบบไม่มีการป้องกัน.
 *
 * ⚠️ ตัวเลขสองตัวนี้ **กว้างกว่าค่าใช้จริงหลายสิบเท่า** โดยตั้งใจ — มันไม่ใช่
 *    ค่าทำงาน มันคือ "กันพิมพ์ผิด" เท่านั้น จึงต้องไม่มีวันเกะกะการปรับจูนจริง:
 *      · MAX ใช้จริงสูงสุด 30  → เพดาน 1,000  (ห่าง 33 เท่า)
 *      · WINDOW ใช้จริงสูงสุด 300 → เพดาน 3,600 (1 ชม. · ห่าง 12 เท่า)
 *    ถ้าวันหนึ่งต้องตั้งเกินนี้จริง ให้ขยับตัวเลขสองบรรทัดล่างนี้ — ไม่ต้อง
 *    ไล่แก้ทีละตัวแปร และไม่ต้องแตะ `intFromString`.
 *
 * ⚠️ ก่อน deploy: ถ้าแผงดีพลอยตั้งค่าไหนเกินเพดานไว้อยู่แล้ว **แอปจะไม่บูต**
 *    (นั่นคือเจตนา — แต่ต้องไปดูค่าที่แผงก่อน ไม่ใช่ปล่อยให้ไปเซอร์ไพรส์ตอน deploy)
 *
 * ── วิธีแก้ในอนาคต (3 เคสที่จะเจอจริง) ─────────────────────────────────────
 *
 * 1) **อยากขยาย/ลดเพดาน** (เช่นวันหนึ่งต้องตั้ง window เกิน 1 ชม. จริง ๆ)
 *    → แก้ `RL_COUNT_CEILING` / `RL_WINDOW_CEILING` สองบรรทัดล่างนี้เท่านั้น
 *    → ทุกตัวแปรในหมวดขยับตามทันที ไม่ต้องไล่แก้ทีละตัว
 *    → เทส `env-ratelimit-ceiling.spec.ts` วนทุก key ไม่ได้ hardcode ตัวเลข
 *      จึงยังเขียวเอง ยกเว้นข้อที่ตรึงว่า "เพดานต้องห่างค่าใช้จริง ≥ 10 เท่า"
 *      ซึ่งจะแดงถ้าลดเพดานลงมาใกล้ค่าใช้จริงเกินไป — นั่นคือเจตนา
 *
 * 2) **อยากใส่เพดานให้ตัวแปรหมวดอื่น** (นอก rate limit)
 *    → ส่ง argument ตัวที่ 3 เพิ่ม: `intFromString(default, min, เพดาน)`
 *    → ไม่ต้องแตะ `intFromString` และไม่กระทบตัวแปรอื่นที่ไม่ส่ง
 *    → **ทำ proof ก่อนเสมอ**: รัน `probe` เทียบค่าที่ parse ได้ก่อน/หลัง
 *      ต้องได้ sha เดียวกัน ไม่งั้นแปลว่ามีค่าจริงตัวไหนหลุดเพดาน
 *
 * 3) **อยากถอดเพดานของตัวใดตัวหนึ่ง**
 *    → ลบ argument ตัวที่ 3 ของบรรทัดนั้นบรรทัดเดียว ⇒ ตัวนั้นกลับไปไม่มีเพดาน
 *    → เทสจะแดงที่ข้อ "ทุกตัวใช้เพดานตัวเดียวกัน" เพื่อบังคับให้เป็นการตัดสินใจ
 *      ที่ตั้งใจ ไม่ใช่หลุดไปโดยไม่มีใครรู้ — ถ้าตั้งใจจริงให้แก้เทสด้วย
 *
 * revert ทั้งฟีเจอร์: ลบ argument ตัวที่ 3 ออกจากทุกบรรทัดในหมวดนี้ + ลบ const
 *         สองตัวล่างนี้ + ลบไฟล์เทส ⇒ กลับไปไม่มีเพดานเหมือนก่อน 23/08/2026
 *         (`intFromString` รองรับการไม่ส่ง `max` อยู่แล้ว ไม่ต้องแตะมัน)
 */
export const RL_COUNT_CEILING = 1_000;
export const RL_WINDOW_CEILING = 3_600;

export const envSchema = z.object({
  // ── core ──────────────────────────────────────────────────────────────────
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: intFromString(10000, 1),
  /** Public origin used when building callback/webhook URLs handed to LINE. */
  BASE_URL: z.string().url().optional(),
  PUBLIC_BASE_URL: z.string().url().optional(),
  SITE_NAME: z.string().optional(),
  /** Verbose diagnostics. Never enable in production — it widens log volume. */
  DEBUG: booleanFromString(false),
  DEV_MODE: booleanFromString(false),
  /** Cap on boot-time warmups so a dead Redis cannot hang the whole deploy. */
  BOOTSTRAP_TIMEOUT_MS: intFromString(5000, 1),

  // ── mongo ─────────────────────────────────────────────────────────────────
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  // ── redis ─────────────────────────────────────────────────────────────────
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: intFromString(6379, 1),
  REDIS_USER: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: intFromString(0),
  REDIS_CONNECT_TIMEOUT_MS: intFromString(5000, 1),

  // ── auth ──────────────────────────────────────────────────────────────────
  /**
   * No fallback value on purpose: the legacy backend deliberately refuses to
   * sign tokens without an explicit secret, and a default here would silently
   * make every deployment share one signing key.
   */
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_EXPIRES_IN: z.string().default('1h'),

  /**
   * [FIX-20260820-SESSIONCEILING] absolute ceiling on how long ONE sign-in may
   * keep renewing itself, in minutes.
   *
   * 0 = OFF and is the default, which makes shipping this a no-op: no claim is
   * minted, no check runs, and `/auth/refresh` behaves byte-identically to
   * today. Minutes rather than hours so the wall can be proven in dev without
   * waiting a shift. Choosing the production number is an owner decision.
   */
  SESSION_MAX_LIFETIME_MIN: intFromString(0, 0),
  /** Key for `enc:`-prefixed secrets stored at rest (hook channel keys, etc). */
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY is required'),
  TEMP_KEY_SECRET: z.string().optional(),

  // ── http surface ──────────────────────────────────────────────────────────
  /**
   * [FEAT-20260808-HTTPONLY-S1] Comma-separated origin allowlist.
   *
   * Empty keeps the legacy behaviour (reflect any origin), which is fine while
   * only Bearer tokens are used. It becomes REQUIRED in production once the auth
   * cookie is live: a credentialed CORS response may NOT reflect an arbitrary
   * origin (reflect-any + `Access-Control-Allow-Credentials: true` is rejected
   * by browsers), so an empty list there would break cross-origin login.
   */
  CORS_ALLOWED_ORIGINS: csvList,

  /**
   * [FEAT-20260813-PROXYGATE] Stamp the front proxy (Traefik FE-origin route)
   * injects as `X-Internal-Secret`. Unset/empty = gate OFF (default, zero
   * impact); set = every non-allowlisted request must carry the stamp.
   * ปิด gate = ลบ env ตัวนี้ตัวเดียว.
   */
  INTERNAL_PROXY_SECRET: z.string().optional(),

  /* ── auth cookie ([FEAT-20260808-HTTPONLY-S1]) ─────────────────────────────
   * Additive HttpOnly cookie carrying the JWT, set on login/refresh ALONGSIDE
   * the existing body token + X-Auth-Key header (dual-support: Bearer clients
   * are untouched). These knobs make the cookie per-environment deployable.
   *
   * DB-EFFECT: none. A cookie is client-side state; nothing is written to Mongo.
   */
  /** Parent domain the cookie is scoped to (e.g. `.example.com`). Empty = host-only. */
  COOKIE_DOMAIN: z.string().optional(),
  /** Send the cookie only over HTTPS. Keep true off local; false only for local http. */
  COOKIE_SECURE: booleanFromString(true),
  /** Cross-site policy: `lax` (same-site deploy), `strict`, or `none` (cross-site + https). */
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  /* ── ws ticket ([FEAT-20260808-HTTPONLY-S1]) ───────────────────────────────
   * TTL (seconds) of the single-use WebSocket connection ticket minted by
   * POST /api/auth/ws-ticket and consumed by omnidesk-ws via GETDEL. Short by
   * design: it only has to survive the round-trip from mint to WS handshake.
   *
   * DB-EFFECT: the ticket is an EPHEMERAL Redis key (`ws_ticket:<token>`) with
   * this TTL, deleted on first use. No Mongo schema/write change.
   */
  WS_TICKET_TTL_SEC: intFromString(45, 1),

  /* ── rate limiting ─────────────────────────────────────────────────────────
   * Defaults are copied from the legacy middleware, not chosen here — EXCEPT
   * the login pair, see below. A request is blocked when the count *exceeds*
   * the max, so `LOGIN_MAX=3` allows three attempts per window and rejects the
   * fourth.
   *
   * ── [FEAT-20260823-LOGINRL] LOGIN — สามแกน ไม่ใช่แกนเดียว (เจ้าของ 23/08/2026)
   * WAS: 6 / 60 นับทุก request ต่อ IP (legacy).
   *
   * ⚠️ รอบแรกของวันนี้ตั้งเป็น 3/60 บนแกนเดิม แล้ว **เจอว่าผิดแกน**:
   *   ออฟฟิศที่ออกเน็ต IP เดียว แอดมิน 5 คนล็อกอิน **ถูกทุกคน** ก็ยังกิน 5 request
   *   ⇒ คนที่ 4 โดน 429 ทั้งที่ไม่มีใครทำผิด. เจ้าของสั่งชัด 23/08:
   *   *"Ip office ไม่ชน / admin หลายคนคละ user = ใช้จริงมีโอกาสผิดได้ 1-2 ครั้ง
   *   ต่อการ login ไม่กระทบ admin คนอื่น"*
   *
   * NOW แยกเป็น 3 แกน ตัวเลขอิสระต่อกันทั้งหมด:
   *   1. `RATE_LIMIT_LOGIN_*`      — ทุก request ต่อ IP   · 30/60วิ  · เพดานดิบเท่านั้น
   *   2. `RATE_LIMIT_LOGIN_FAIL_*` — **เฉพาะรหัสผิด** ต่อ IP · 15/300วิ · กัน flood สุ่ม user
   *   3. `RATE_LIMIT_LOGIN_USER_*` — **เฉพาะรหัสผิด** ต่อบัญชี · 5/300วิ · กัน botnet
   *
   * กุญแจที่ทำให้ออฟฟิศรอด: **ล็อกอินถูกไม่กินโควตาแกน 2 และ 3 เลย** —
   * แกนดิบ (1) ตั้งสูงพอที่ทราฟฟิกจริงไม่มีทางชน.
   *
   * WHAT IT COVERS — bucket `login` ใช้ร่วมกัน 2 เส้น, นับรวมกัน:
   *   · POST /auth/login              (auth.controller.ts:82)
   *   · POST /users/reset-password-temp (users.controller.ts:138)
   *
   * HOW THE BLOCK BEHAVES — fixed window, ไม่ใช่ "แบนกี่วินาที":
   *   นาฬิกา 60 วิ ตั้งตอนยิงครั้งแรกเท่านั้น (redis.service.ts:89 — EXPIRE
   *   เฉพาะ count===1) ⇒ ยิงซ้ำตอนโดนบล็อก **ไม่ต่ออายุ** ⇒ โดนบล็อกนานเท่ากับ
   *   เวลาที่เหลือในหน้าต่างนั้น (แย่สุด ~59 วิ ถ้ายิงรัว, ดีสุดไม่กี่วิ) แล้วปลดเอง.
   *
   * ⚠️ แกน 1 ยังนับต่อ IP รวมทุกคนในออฟฟิศ — จึงตั้งไว้ **30** ไม่ใช่ 3.
   *   มันมีหน้าที่เดียวคือกันคนยิงรัวเป็นร้อยครั้ง/นาที ไม่ได้มีหน้าที่กันเดารหัส
   *   (แกน 2 กับ 3 ทำหน้าที่นั้น และไม่นับล็อกอินที่ถูก).
   *
   * ⚠️ ตัวเลขนี้เป็นแค่ค่า DEFAULT — env ของ stg/prod ที่ตั้ง RATE_LIMIT_LOGIN_MAX
   *   ไว้เองจะชนะเสมอ. เปลี่ยนที่นี่อย่างเดียว **ไม่พอ** ต้องไปแก้/ลบตัวแปรที่
   *   แผงดีพลอยด้วย มิฉะนั้น prod ยังใช้เลขเดิม.
   * revert: เปลี่ยนกลับเป็น intFromString(6, 1) และแก้ .env.example กลับเป็น 10/300.
   */
  RATE_LIMIT_GLOBAL_ENABLED: booleanFromString(false),
  RATE_LIMIT_GLOBAL_MAX: intFromString(300, 1, RL_COUNT_CEILING),
  RATE_LIMIT_GLOBAL_WINDOW_SECONDS: intFromString(300, 1, RL_WINDOW_CEILING),
  /* [FEAT-20260826-RLSHADOW] โหมด "วัด" ไม่ใช่โหมด "กัน" — นับเหมือนเปิดจริงทุกประการ
   * แต่ไม่มีสิทธิ์ตอบ 429 (branch ใน global-rate-limit.middleware.ts) · มีไว้เก็บเลขจริง
   * ก่อนตัดสินใจเปิด GLOBAL_ENABLED — แผนสองเฟส: todo/task/26082026/todo5_26082026_*.md
   * ค่าถูกอ่านตอน boot ⇒ เปิด/ปิด = ตั้ง env แล้ว restart (ไม่ต้อง build โค้ดใหม่) */
  RATE_LIMIT_GLOBAL_SHADOW: booleanFromString(false),
  /* ── [FEAT-20260826-STRIKESUSPEND] เพดาน "เงียบใส่ลูกค้าคนนี้" ────────────────
     📖 แผนเต็ม: `todo/task/26082026/todo10_26082026_strike-suspend.md`

     ติด strike ครบ `AT` ครั้ง ภายใน `WINDOW_HOURS` ชั่วโมง (ใน session ปัจจุบัน)
     ⇒ webhook หยุดตอบและหยุดเก็บแชทของคนนั้น จนกว่าแอดมินจะเคลียร์ session

     ⚠️ หน่วยเป็น **ชั่วโมง** ไม่ใช่วัน และหน่วยอยู่ในชื่อ — ชั่วโมงพูดได้ทุกอย่างที่วัน
        พูดได้ (1 วัน = 24) แต่วันสั่ง "6 ชั่วโมง" ไม่ได้ · และตัวนับที่ทำงานคู่กัน
        (`user-rate-ladder.ts` `strikeResetHours`) ก็เป็นชั่วโมงอยู่แล้ว
     ⚠️ พื้น 1 ชั่วโมงโดยตั้งใจ — ตั้ง 0 จะแปลว่าหน้าต่างกว้างศูนย์ = ไม่มีวันล็อกใคร
        = ปิดฟีเจอร์โดยที่ log กับ config ยังบอกว่าเปิดอยู่ **ปิดฟีเจอร์ให้ไม่ผูก token**
        ซึ่งเห็นชัดกว่าและมีเทสปักไว้
     ⚠️ ไม่ตั้งทั้งคู่ = 5 ครั้ง / 24 ชั่วโมง · ตั้งค่าไม่ได้แปลว่าเปิดฟีเจอร์ —
        ฟีเจอร์เปิดก็ต่อเมื่อ `STRIKE_GATE` ถูกผูกใน webhook เท่านั้น */
  STRIKE_SUSPEND_AT: intFromString(5, 1, RL_COUNT_CEILING),
  STRIKE_SUSPEND_WINDOW_HOURS: intFromString(24, 1, 8_760),

  /* [FEAT-20260823-L1DEFAULT3] ค่าตั้งต้นของ level 1 ฝั่งลูกค้า — **3** ไม่ใช่ 2.
   *
   * เจ้าของสั่ง 23/08: "ทำ code ให้ตรง env" — โค้ดเคยเป็น 2 ขณะที่ทุก env จริงตั้ง 3
   * ขึ้นไป (local 3 · stg 3 · prod 5) ⇒ ตัวเลขในโค้ดไม่ตรงกับที่ใช้จริงเลยสักที่
   * ซึ่งทำให้คนอ่านโค้ดเข้าใจผิดว่าลูกค้าพิมพ์ได้ 2 ข้อความ/30 วินาที
   *
   * ⚠️ **ไม่กระทบ stg/prod แม้แต่นิดเดียว** เพราะทั้งคู่ตั้งค่าเองไว้แล้ว และค่าที่
   * ตั้งเองชนะ default เสมอ · มีผลเฉพาะที่ที่ **ไม่ได้ตั้ง** ซึ่งเดิมได้ 2 (เข้มกว่า
   * ที่ตั้งใจ) ตอนนี้ได้ 3 เท่ากับ stg
   * revert: intFromString(2, 1, RL_COUNT_CEILING) */
  RATE_LIMIT_MAX: intFromString(3, 1, RL_COUNT_CEILING),
  RATE_LIMIT_WINDOW_SECONDS: intFromString(30, 1, RL_WINDOW_CEILING),
  RATE_LIMIT_LOGIN_MAX: intFromString(30, 1, RL_COUNT_CEILING),
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: intFromString(60, 1, RL_WINDOW_CEILING),

  /* ── [FEAT-20260823-LOGINFAIL] แกนที่ 2 — **เฉพาะรหัสผิด** ต่อ IP ───────────
   * เจ้าของ 23/08: *"ป้องกันพวก flood ip เดิม + สุ่ม user ได้ไหม"*
   *
   * แกนนี้คือคำตอบของเคสนั้นโดยตรง: คนยิงจาก IP เดียวแล้วสุ่มชื่อผู้ใช้ไปเรื่อย ๆ
   * จะไม่โดนแกนที่ 3 เลย (คนละ username ทุกครั้ง = คนละตัวนับ) แต่ **ทุกครั้งคือ
   * รหัสผิด** ⇒ แกนนี้จับได้หมดไม่ว่าจะสุ่มชื่ออะไร.
   *
   * ทำไมออฟฟิศไม่ชน: ล็อกอินที่ถูก **ไม่นับ** ⇒ แอดมิน 5 คนพิมพ์ผิดคนละ 2 ครั้ง
   * = 10 ครั้งใน 5 นาที ยังต่ำกว่า 15. คนที่พิมพ์ถูกตั้งแต่แรกไม่แตะโควตานี้เลย.
   *
   * ⚠️ ยังเป็น "ต่อ IP" อยู่ ⇒ ถ้าออฟฟิศใหญ่มากและพิมพ์ผิดกันเยอะจริง ให้ดัน
   *   `RATE_LIMIT_LOGIN_FAIL_MAX` ขึ้น — แกน 3 ยังตรึงเพดานต่อบัญชีไว้ให้อยู่แล้ว.
   * ปิดทั้งแกน: `RATE_LIMIT_LOGIN_FAIL_ENABLED=false`
   */
  RATE_LIMIT_LOGIN_FAIL_ENABLED: booleanFromString(true),
  RATE_LIMIT_LOGIN_FAIL_MAX: intFromString(15, 1, RL_COUNT_CEILING),
  RATE_LIMIT_LOGIN_FAIL_WINDOW_SECONDS: intFromString(
    300,
    1,
    RL_WINDOW_CEILING,
  ),
  /* ── [FEAT-20260823-LOGINUSER] ชั้นที่ 2 ของ login — นับต่อ "ชื่อผู้ใช้" ────────
   * เจ้าของสั่ง 23/08/2026: *"งั้นเพิ่มชั้น username ด้วย ตัวเลขแยกอิสระตั้งได้
   * หรือ เลือกไม่ใช่ก็ได้ ทุกอย่างหยืดหยุ่น"*
   *
   * ทำไมต้องมี: ชั้นแรกนับต่อ **IP** ⇒ คนที่มี botnet เปลี่ยน IP ทุกครั้ง
   * ก็เดารหัสบัญชีเดียวได้ไม่จำกัด. ชั้นนี้นับต่อ **บัญชี** จึงกันอีกแกนหนึ่ง
   * โดยตรง — สองชั้นตัดกัน ไม่ทับซ้อนกัน.
   *
   * ⭐ นับเฉพาะ "ครั้งที่รหัสผิด" เท่านั้น (`UnauthorizedException`) —
   *   ล็อกอินถูกไม่นับ, Mongo ล่ม/500 ไม่นับ ⇒ คนใช้งานปกติไม่มีทางโดนชั้นนี้
   *   ต่อให้ล็อกอินร้อยครั้ง และ DB ล่มก็ไม่ทำให้บัญชีถูกล็อก.
   *   (ต่างจากชั้น IP ที่นับทุก request — ตั้งใจให้ต่างกัน)
   *
   * ปิดทั้งชั้น: `RATE_LIMIT_LOGIN_USER_ENABLED=false` ⇒ ไม่มีการเรียก Redis
   * เพิ่มแม้แต่ครั้งเดียว พฤติกรรมกลับไปเหมือนก่อนมีชั้นนี้เป๊ะ.
   * ตัวเลขเป็นอิสระจากชั้น IP คนละคู่ ตั้งแยกกันได้เต็มที่.
   */
  RATE_LIMIT_LOGIN_USER_ENABLED: booleanFromString(true),
  RATE_LIMIT_LOGIN_USER_MAX: intFromString(5, 1, RL_COUNT_CEILING),
  RATE_LIMIT_LOGIN_USER_WINDOW_SECONDS: intFromString(
    300,
    1,
    RL_WINDOW_CEILING,
  ),

  RATE_LIMIT_KEY_MAX: intFromString(3, 1, RL_COUNT_CEILING),
  RATE_LIMIT_KEY_WINDOW_SECONDS: intFromString(60, 1, RL_WINDOW_CEILING),

  /* ── hook cache ────────────────────────────────────────────────────────────
   * Legacy names and defaults, copied verbatim from
   * legacy-api/src/services/hook/hookService.js:49,54.
   *
   * L2 (Redis, shared) is long because every hook edit write-throughs the cache
   * and publishes an invalidate — the TTL is only a self-heal backstop.
   * L1 (in-process) is deliberately short: if a pub/sub invalidate is ever
   * missed, 15s bounds the blast radius of a stale hook.
   */
  HOOK_CACHE_TTL_SEC: intFromString(43200, 1),
  HOOK_L1_TTL_MS: intFromString(15000, 1),

  /* ── scoped query cache ([FEAT-20260808-QCACHE]) ───────────────────────────
   * Per-page TTL (SECONDS) for the shared, scope-keyed read cache on the four
   * read-heavy, non-realtime pages (dashboard / insight-report / webhook-log /
   * audit-log). These are TUNABLE KNOBS — "how stale is acceptable per page" —
   * NOT measured truths. The defaults below are starting points (insight is the
   * heaviest aggregation, so it tolerates the longest window; logs refresh far
   * more often). Ops dials each page independently.
   *
   * min = 0 on purpose: 0 (or unset) DISABLES the cache for that page and the
   * endpoint falls back to a live DB query — byte-identical to today, zero
   * behaviour change. That is the pluggability contract: remove the knob, get
   * the old path back.
   *
   * DB-EFFECT: this cache makes NO Mongo schema/write change and writes NOTHING
   * to Mongo. It only READS Mongo LESS often (serving cached results) and stores
   * ephemeral TTL'd keys in REDIS. These knobs bound how long a Redis entry may
   * be served before the next DB read refreshes it.
   */
  CACHE_TTL_DASHBOARD: intFromString(120, 0),
  CACHE_TTL_INSIGHT: intFromString(300, 0),
  CACHE_TTL_WEBHOOKLOG: intFromString(30, 0),
  CACHE_TTL_AUDIT: intFromString(30, 0),
  /**
   * Random jitter added to each entry's TTL, as a PERCENT of the base TTL
   * (0-100). Spreads expiry so a fleet of entries created together do not all
   * expire on the same tick and stampede the DB at once. 0 disables jitter.
   */
  CACHE_TTL_JITTER_PCT: intFromString(10, 0),

  // ── ai (gemini) ───────────────────────────────────────────────────────────
  /**
   * Which AI reply provider the webhook binds, and whether a call cap wraps it.
   * Two orthogonal knobs; see webhook.module.ts for the factory and
   * test-case/PLAN-webhook-0.5-rev2-mock-ai.md for the full spec.
   *
   *   AI_PROVIDER  mock → scripted, no network (TEST ONLY) · real → Gemini
   *   AI_CAP       on   → hard call ceiling · off → unlimited
   *
   *   local  AI_PROVIDER=mock AI_CAP=on
   *   dev    AI_PROVIDER=real AI_CAP=on
   *   prod   AI_PROVIDER=real AI_CAP=off
   *
   * Both DEFAULT to the safe side: absent/unknown provider → `real` (a typo must
   * never mock a real customer), absent cap → `on`. `mock` in production throws
   * at boot.
   */
  AI_PROVIDER: z.enum(['mock', 'real']).optional(),
  AI_CAP: z.enum(['on', 'off']).optional(),
  /**
   * [FEAT-20260821-QUOTEREPLY] the admin console's send ladder. `off` (default)
   * = push only, byte-identical to before this flag existed. `on` = try the
   * customer's still-live reply token first (free of the push quota), fall back
   * to push. Owner's switch: flip it, no deploy. See
   * src/modules/chat/channels/outbound-send-strategy.ts.
   */
  CHAT_REPLY_REUSE: z.enum(['on', 'off']).default('off'),
  /**
   * [FEAT-20260918-AUTOTRANS] Translate a customer's message automatically as it
   * is stored, when the room (or its hook) asks for it.
   *
   * `off` (default) is byte-identical to the behaviour that existed before this
   * flag: the plug is not provided at all, so the storage path makes no extra
   * call, reads no extra document and cannot fail in a new way. `on` provides
   * it — and even then a room that never enabled `auto_translate` still gets
   * nothing, because the flag decides whether the feature EXISTS, not whether it
   * runs. ปิดไว้ = ไม่ผลสุทธิบ ไม่ใช่ "เสียบแล้วปิดสวิตช์"
   *
   * See src/modules/chat/translate/auto/.
   */
  CHAT_AUTO_TRANSLATE: z.enum(['on', 'off']).default('off'),
  /**
   * [FEAT-20260905-MULTIEVENT] Process every event in a batched LINE delivery, not just
   * `events[0]`. `off` (default) is byte-identical to the behaviour that existed before
   * this flag: the loop runs once, over the original body, with nothing suppressed.
   *
   * ⚠️ It is a KILL SWITCH, not a tuning knob. The cap is code-owned
   * (`event-iteration/select-delivery-events.ts`) on purpose — see that file. This flag
   * only answers "iterate at all", so flipping it back is a restart, not a deploy.
   */
  WEBHOOK_MULTI_EVENT: z.enum(['on', 'off']).default('off'),
  /** Ceiling when AI_CAP=on. Kept small; raised only with the owner's word. */
  AI_CAP_LIMIT: intFromString(5, 1),
  GEMINI_API_KEY: z.string().optional(),
  MODEL_ID: z.string().default('gemini-3.5-flash'),
  /**
   * [P2-20260813] DeepSeek (vendor #2) — MODEL NAME ONLY.
   *
   * ⚠️ There is deliberately NO `DEEPSEEK_API_KEY`. Owner rule: everything is
   *    per hook, and the only server-level AI switch is `AI_PROVIDER` above.
   *    A DeepSeek hook uses its own `hook.custom_ai_key`; without one it must
   *    refuse, never borrow. (Gemini's env key ladder survives only as legacy
   *    that phase K retires — it is not a pattern to copy.)
   *    ไม่มี env key ของ deepseek · per hook เท่านั้น.
   *
   * The model id is a NAME, not a credential, and mirrors how `MODEL_ID` is
   * handled for Gemini today. Per-hook model choice is phase M's job.
   */
  DEEPSEEK_MODEL_ID: z.string().default('deepseek-chat'),

  GEMINI_TOP_P: floatFromString(0.95),
  GEMINI_TOP_K: intFromString(40),
  /** 0 keeps replies deterministic, which is what the bot flows rely on. */
  GEMINI_TEMPERATURE: floatFromString(0),
  /** Logs full model responses — payloads can contain customer data. */
  LOG_GEMINI_RESPONSE: booleanFromString(false),

  /* ── [FEAT-20260908-CHATTRANS] ai translate — THREE NEW OPTIONAL KEYS ───────
   * All three are additive and all three have defaults, so an environment that
   * sets NONE of them behaves exactly as it does today. Nothing above this block
   * is touched — above all no `RATE_LIMIT_*` key, which belong to login, the
   * global limiter and the webhook ladder, and no `AI_CAP_LIMIT`, which three
   * decorators read at once (reply, assist summary, translate).
   *
   * ⚠️ A key here is NOT reachable from code by itself. `registerAs` lives in
   * `src/config/app.config.ts` and nowhere else in `src/`, so these three are
   * surfaced by the NEW `aiTranslate` namespace there — never by widening an
   * existing one.
   */
  /**
   * 🔴 Translate's OWN lifetime call ceiling, so raising it never moves the
   * customer-facing bot's. UNSET ⇒ falls back to `AI_CAP_LIMIT`, i.e. byte-
   * identical to today; that fallback is resolved in `app.config.ts`, which is
   * the only place that can see both keys at once.
   *
   * ⚠️ OPTIONAL WITH NO DEFAULT ON PURPOSE — the one key in this file that
   * resolves to `undefined` rather than a number. "Unset" and "set to 5" must
   * stay distinguishable: a default of 5 here would look identical to a
   * deliberate 5 and would silently PIN translate's ceiling, so raising
   * `AI_CAP_LIMIT` would stop reaching it. Hence the inline shape instead of
   * `intFromString` — that helper cannot express "no default" and is left
   * untouched, as its own note at the top of this file asks.
   */
  AI_TRANSLATE_CAP_LIMIT: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === '' ? undefined : Number(value),
    )
    .pipe(z.number().int().min(1).optional()),
  /**
   * Composer-preview presses allowed per admin, per room, per window. The read
   * side is cache-backed (one vendor call per message per language, ever); a
   * preview cannot be cached because the draft has not been sent, so this limit
   * is what stands in for a cache there.
   *
   * ⚠️ No upper ceiling, matching `AI_CAP_LIMIT` two dozen lines above — the
   * `RL_*_CEILING` constants belong to the rate-limit family and this key is in
   * the AI family. A reader who later wants "loud, not silent" for a typo of
   * 30000 should add it deliberately, not inherit it by accident.
   */
  AI_TRANSLATE_PREVIEW_MAX: intFromString(12, 1),
  /** The window those presses are counted in. */
  AI_TRANSLATE_PREVIEW_WINDOW_SECONDS: intFromString(60, 1),
  /**
   * [FEAT-20260918-TRANSLATETIMEOUT] How long a TRANSLATION may stall before it
   * is abandoned and the caller falls back. Owner, 18/09: *"กำหนด timeout ด้วย
   * เข้าและออก 30 วิ (เผื่อแก้ไขอนาคต) = timeout แล้ว fallback เลย"*.
   *
   * 🔴 IT IS NOT `AI_HTTP_TIMEOUT_MS`, AND MUST NOT BECOME IT. That constant is
   * 45s and is shared by the webhook REPLY lane, whose budget is computed
   * against `REPLY_STALE_MS` (45 + 30 retry = 75s, ceiling 120s). Lowering it
   * would cut off healthy-but-slow customer replies — a different lane, a
   * different consequence. `http.ts` says the same thing in its own words:
   * splitting the ceiling means giving a lane its own value, not moving that one.
   * เส้นแปลมีเพดานของตัวเอง ห้ามไปขยับของเส้นตอบลูกค้า
   *
   * WHY 30s IS THE RIGHT SHAPE FOR THIS LANE. Both directions have somewhere to
   * fall back to, which the reply lane does not: inbound keeps the customer's
   * original text and simply carries no translation, and outbound sends the
   * draft exactly as typed. So a stall costs a missing convenience, never a
   * missing message — and making an operator watch a spinner for 45s before that
   * happens is worse than answering sooner.
   *
   * Applies to BOTH directions because both go through the same core translator.
   */
  AI_TRANSLATE_TIMEOUT_MS: intFromString(30_000, 1_000),
  /**
   * [FEAT-20261018-NOWBLOCKENV] The "today" NOW block (time · office hours · Thai holiday ·
   * open/closed status) added to the AI prompt — `webhook/now-block/`. Owner 18/10/2026:
   * read from the environment; missing or empty = OFF; a server that never sets it must not
   * break. ON only for `on` / `true` / `1` (any case, trimmed) — anything else is OFF.
   * A plain optional string ON PURPOSE: no value can fail validation and stop a boot; the
   * meaning is decided in ONE place, `resolveNowBlockMode` (`now-block.mode.ts`).
   * shop-api: leave unset ⇒ today's prompt, byte for byte · loan: set `on`.
   */
  AI_NOW_BLOCK: z.string().optional(),

  // ── channels ──────────────────────────────────────────────────────────────
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  // ── customer provider ─────────────────────────────────────────────────────
  /**
   * [FEAT-20260905-CUSTPROV] Which customer provider answers — the profile
   * panel's cards, the tier read path, and whether the tier badge and filter
   * show. See `modules/customer-provider/providers/provider-entries.ts`.
   *
   * 🔴 OPTIONAL, AND NO DEFAULT IS WRITTEN HERE ON PURPOSE. Unset resolves to
   * `shopapi_v1` — today's behaviour — inside the registry, which is the ONE place
   * that knows what the default is. A `.default('shopapi_v1')` on this line would
   * be a second copy of that fact, free to drift from the first.
   *
   * 🔴 NOT `z.enum([...])` either: the set of valid values is the registry, and
   * an enum here would be a second list to keep in step. An unknown value falls
   * back with a warning at boot rather than refusing to start — a typo must not
   * take the dashboard down.
   *
   * ⚠️ Do NOT add this to `.env.example`, a deploy template or a runbook as a
   * value to set. Listing it as required is how "unset" quietly stops being the
   * tested path. ห้ามใส่เป็นค่าที่ต้องตั้ง
   */
  CUSTOMER_PROVIDER: z.string().optional(),

  /**
   * [FEAT-20261016-TOOLMINT] Partner credentials for the loan site's Custom Tools mint buttons —
   * three per company (`providers/loan-v1/tool-mint.ts` names the prefix). All optional: a
   * company with all three set mints a ready tool; anything less mints only the skeleton.
   * Read ONLY by the mint (`toolMintConfig` → `hooks/tool-mint/`); the password goes straight
   * into `CustomToolsService.create`, which encrypts it — it never reaches the browser.
   * 🔴 Plain `z.string()`, NOT `.url()`: an empty `KEY=` line must not stop the server; an
   *    unusable base URL is reported on the button instead (`features/tool-mint.ts`).
   * shop-api: leave unset — its provider declares no mint, so nothing reads these.
   * ค่าเหล่านี้ใช้ตอนกด mint เท่านั้น · เปลี่ยนทีหลัง tool ที่ mint ไปแล้วไม่เปลี่ยนตาม
   */
  LOAN_TOOL_DEMO_BASE_URL: z.string().optional(),
  LOAN_TOOL_DEMO_USERNAME: z.string().optional(),
  LOAN_TOOL_DEMO_PASSWORD: z.string().optional(),
  LOAN_TOOL_ACME_BASE_URL: z.string().optional(),
  LOAN_TOOL_ACME_USERNAME: z.string().optional(),
  LOAN_TOOL_ACME_PASSWORD: z.string().optional(),
  LOAN_TOOL_GLOBEX_BASE_URL: z.string().optional(),
  LOAN_TOOL_GLOBEX_USERNAME: z.string().optional(),
  LOAN_TOOL_GLOBEX_PASSWORD: z.string().optional(),

  // ── realtime (published to the ws gateway over redis) ──────────────────────
  WS_ENV: z.string().default('dev'),
  PROD_WS_CHANNEL: z.string().optional(),

  // ── outbound integrations ─────────────────────────────────────────────────
  SHOPAPI_BASE_URL: z.string().optional(),
  SHOPAPI_SECRET: z.string().optional(),
  V4_BASE_URL: z.string().optional(),
  SWIFTCHECK_API_BASE_URL: z.string().optional(),
  IGNORE_DOC_ID: z.string().optional(),
  /**
   * Fallback credentials for the partner API. Per-hook settings stored in Mongo
   * take precedence; these only apply when a hook has none of its own.
   */
  EXTERNAL_API_BASE_URL: z.string().optional(),
  EXTERNAL_API_USERNAME: z.string().optional(),
  EXTERNAL_API_PASSWORD: z.string().optional(),

  // ── migrations ────────────────────────────────────────────────────────────
  /** Guards destructive migration scripts against pointing at the wrong DB. */
  MIGRATION_TARGET_DB: z.string().optional(),

  /* ── acl bootstrap seeder ([FEAT-20260808-ACLSEED]) ────────────────────────
   * Seeds roles/menus + the three bootstrap accounts so a BLANK DB can be
   * logged into. Idempotent (skip-if-exists), so running on every boot is a
   * no-op on a populated DB. Set false to make the seeder fully dormant.
   * INIT_* mirror the legacy env names; unset falls back to sane defaults in
   * the `seed` config slice.
   */
  ACL_SEED_ON_BOOT: booleanFromString(true),
  INIT_ADMIN_USERNAME: z.string().optional(),
  INIT_ADMIN_PASSWORD: z.string().optional(),
  INIT_ADMIN_DISPLAY_NAME: z.string().optional(),
  INIT_DEV_USERNAME: z.string().optional(),
  INIT_DEV_PASSWORD: z.string().optional(),
  INIT_DEV_DISPLAY_NAME: z.string().optional(),
  /**
   * [TEST-20260820-DEVREMOVE] Who may wipe a customer's stored profile from the
   * dashboard. Comma separated, case-insensitive.
   *
   *   absent  ⇒ `dev` only (developer machine default)
   *   `dev,dev2` ⇒ those two
   *   ⭐ EMPTY STRING ⇒ NOBODY. This is how the testing tool is switched off,
   *      and it is what a production environment must set. An absent variable
   *      is NOT the same as an empty one.
   *
   * See `src/modules/chat/dev-remove.guard.ts` for what it protects.
   * ตั้งว่าง = ปิดสนิท · ไม่ตั้ง = เปิดให้ dev.
   */
  DEV_REMOVE_USERNAMES: z.string().optional(),

  INIT_SU_USERNAME: z.string().optional(),
  INIT_SU_PASSWORD: z.string().optional(),
  INIT_SU_DISPLAY_NAME: z.string().optional(),

  // ── handoff worker (fail-closed: dormant unless both are set) ─────────────
  HANDOFF_WORKER: booleanFromString(false),
  HANDOFF_ALLOWED_DB: csvList,
});

export type Env = z.infer<typeof envSchema>;

/**
 * The validated, coerced environment.
 *
 * Config slices read from here rather than `process.env`, because process.env
 * values are always strings: a `connectTimeout` of "5000" instead of 5000 is
 * accepted by TypeScript (the cast lies) and only fails deep inside a driver at
 * runtime. Reading the parsed object means the coercion zod already performed is
 * the value that actually reaches consumers.
 */
let validatedEnv: Env | undefined;

/**
 * Validates `process.env` and returns the typed result.
 * Throws with every offending key listed at once — one restart tells you
 * everything that is wrong rather than one key per attempt.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  validatedEnv = parsed.data;
  return parsed.data;
}

/**
 * Accessor for config factories. Throws if called before validation, which can
 * only happen if a module is instantiated outside the Nest lifecycle.
 */
export function getValidatedEnv(): Env {
  if (!validatedEnv) {
    throw new Error(
      'Environment accessed before validation — is ConfigModule imported?',
    );
  }
  return validatedEnv;
}
