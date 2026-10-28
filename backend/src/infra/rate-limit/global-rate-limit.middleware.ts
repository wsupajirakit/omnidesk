import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import type { RateLimitService } from './rate-limit.service';

/**
 * [FEAT-20260808-P3GLOBALRL] Opt-in global per-IP rate limit, mounted app-wide
 * in `main.ts`. Ports legacy `rateLimitMiddleware.js:108` (`rateLimitGlobalGuarded`).
 *
 * **DEFAULT OFF (seamless / zero impact).** While off (`RATE_LIMIT_GLOBAL_ENABLED`
 * unset/false, which is the default in env.schema) this middleware is a bare
 * `next()` — behaviour is byte-identical to today, so it is pure plumbing that
 * only becomes active when an operator flips the flag. Turn on with
 * `RATE_LIMIT_GLOBAL_ENABLED=true`.
 *
 * Bypass = machine / money paths that must NEVER see a 429 from this layer,
 * mirroring legacy `isBypassPath`:
 *   - LINE webhook            `/webhook` · `/:alias/webhook`   (HMAC-gated)
 *   - handoff payment callback `/api/handoff/callback...`      (HMAC-gated,
 *                                                               already fail-open
 *                                                               rate-limited)
 * Everything else shares the per-IP `global` window from RateLimitService.
 *
 * Redis error → fail-open (RateLimitService returns `current: null`,
 * `limited: false`), so a Redis hiccup cannot 429 the whole API.
 *
 * DB-EFFECT: none — Redis INCR/EXPIRE on ephemeral `ratelimit:*` keys only; no
 * Mongo schema/write change.
 *
 * revert: delete this file + the `app.use(...)` line in main.ts (same marker).
 */

/**
 * legacy `isBypassPath` — exported for the unit test, same two rules.
 *
 * [FIX-20260818-BYPASSANCHOR] ⭐ ทั้งสองกฎถูก anchor ให้ตรงกับ `proxy-gate.middleware.ts`
 *
 * ของเดิมไม่ anchor: `/(^|\/)webhook(\/|$)/` จับทุกอย่างที่มีคำว่า webhook คั่นด้วย `/`
 * ⇒ `/webhook/logs` (API ของ dashboard), `/api/telegram/webhook` (ไม่ต้อง auth) และ
 * `/x/webhook/y` หลุดการนับทั้งหมด · กฎที่สองก็กว้างเกิน: `startsWith('/api/handoff/callback')`
 * กินเลยไปถึงกล่องขาเข้าของ dashboard (`/api/handoff/callbackS`) ซึ่งเป็น JWT route ปกติ
 * ไม่ใช่ callback ที่ปลายทางภายนอกยิงเข้ามา — `proxy-gate.middleware.ts:49-56` แก้จุดนี้
 * ไปแล้วด้วย `/` ปิดท้าย แต่ไฟล์นี้ไม่ได้ตามไป
 *
 * สิ่งที่ต้องไม่เปลี่ยนเด็ดขาด: `/webhook` และ `/<alias>/webhook` คือเส้นที่ LINE ยิงเข้ามา
 * **LINE ต้องไม่เจอ 429** จึงยัง bypass เหมือนเดิมทุกประการ
 *
 * ⚠️ ตอนนี้เป็น no-op ที่ runtime: middleware ด้านล่างเช็ค `isGlobalEnabled()` ก่อน
 * `isBypassPath()` และ `RATE_LIMIT_GLOBAL_ENABLED` ปิดอยู่ ⇒ ฟังก์ชันนี้ยังไม่เคยถูกเรียก
 * จริง · นี่คือเหตุผลที่ต้องแก้ให้เสร็จ **ก่อน** เปิด limiter ไม่ใช่หลัง
 *
 * revert: เอา regex เดิมกลับ (`/(^|\/)webhook(\/|$)/` + `startsWith('/api/handoff/callback')`)
 *         แล้วเส้นที่ระบุข้างบนจะกลับไปไม่ถูกนับ
 */
export function isBypassPath(path: string): boolean {
  return (
    // เหมือน proxy-gate ตัวอักษรต่อตัวอักษร — สองไฟล์นี้ต้องเห็นตรงกันว่าอะไรคือ
    // webhook ของ LINE (มีเทสตรึงความเท่ากันไว้ที่ rate-limit-bypass-path.spec.ts)
    /^\/(?:[^/]+\/)?webhook\/?$/.test(path) ||
    // `/` ปิดท้ายบังคับ: callback ของจริงเท่านั้น ไม่ใช่ `/callbacks` ของ dashboard
    /^\/api\/handoff\/callback\//.test(path)
  );
}

/** legacy `deny` — the exact 429 body the running backend returns. */
function deny(res: Response): void {
  res.status(429).json({ error: 'rate limit exceeded' });
}

/* ── [FEAT-20260826-RLSHADOW] 📖 todo/task/26082026/todo5_26082026_a5-shadow-phase-split.md (เฟส 1 ชิ้น 1.1)
 * Shadow instrument — วัดอย่างเดียว ไม่มีสิทธิ์ปฏิเสธใคร.
 *
 * นับผ่าน `consume('global', ip)` ตัวเดียวกับของจริงเป๊ะ (ได้ overhead จริงไปในตัว)
 * แล้วจดเฉพาะ request ที่ "ถ้าเปิดจริงตรงนี้จะโดน 429" — ทราฟฟิกปกติ = ศูนย์บรรทัด.
 * โครงสร้างที่ทำให้พังระบบไม่ได้ (แต่ละข้อมีเทสตรึงใน rate-limit-shadow.spec.ts):
 *   1. ถูกเรียก "หลัง" `next()` เสมอ — ไม่อยู่บน critical path · Redis ค้าง = request ไม่ช้า
 *   2. ไม่มีบรรทัดไหนแตะ `res` — อยากบล็อกก็บล็อกไม่ได้เพราะไม่มีโค้ดให้บล็อก
 *   3. try/catch เงียบครอบทั้งฟังก์ชัน + `.catch` เงียบบน promise (ชั้นล่าง fail-open อยู่แล้ว)
 *   4. log มีเบรกของตัวเอง ≤ 1 บรรทัด/วินาที — โดน flood เครื่องมือวัดก็ไม่ flood disk
 *      (ทุกบรรทัดพก `current` ⇒ top-N ต่อช่วงเวลาอ่านย้อนจาก log ได้เอง ไม่ต้องมี timer สรุป)
 *   5. จดแค่: bucket · ip ที่ระบบเห็น · current/limit/window · XFF ดิบทั้งเส้น (วัตถุดิบ A9-P0)
 *      · cf-connecting-ip · req.ip · path 2 segment แรก (id เริ่มที่ segment 3 — ไม่จด ·
 *      ไม่มี query/body) ⇒ ไม่มี PII เกิน access log ของ traefik ที่มีอยู่แล้ว
 *
 * เปิด: env `RATE_LIMIT_GLOBAL_SHADOW=true` + restart (ค่าอ่านตอน boot — ดู env.schema).
 * revert: ลบ block นี้ + เงื่อนไข shadow ใน factory + getter ใน service + env 1 บรรทัด + spec.
 */
const shadowLogger = new Logger('RateLimitShadow');
const SHADOW_LOG_MIN_GAP_MS = 1_000;
let shadowLastLogAtMs = 0;

function shadowObserve(rateLimit: RateLimitService, req: Request): void {
  try {
    const ip = rateLimit.resolveClientIp(req);
    if (!ip) return;
    void rateLimit
      .consume('global', ip)
      .then((verdict) => {
        if (!verdict.limited) return; // would-block เท่านั้น — ปกติเงียบสนิท
        const now = Date.now();
        if (now - shadowLastLogAtMs < SHADOW_LOG_MIN_GAP_MS) return; // เบรกของ log
        shadowLastLogAtMs = now;
        const headers = req.headers ?? {};
        shadowLogger.warn(
          '[RL-SHADOW] ' +
            JSON.stringify({
              bucket: 'global',
              ip,
              current: verdict.current,
              limit: verdict.limit,
              windowSeconds: verdict.windowSeconds,
              xff: headers['x-forwarded-for'] ?? null,
              cfIp: headers['cf-connecting-ip'] ?? null,
              reqIp: req.ip ?? null,
              pathHead:
                '/' +
                (req.path || '')
                  .split('/')
                  .filter(Boolean)
                  .slice(0, 2)
                  .join('/'),
            }),
        );
      })
      .catch(() => undefined);
  } catch {
    // เครื่องมือวัดห้ามทำ request พัง — แม้แต่ error แบบ synchronous
  }
}

/**
 * Builds the Express middleware. Kept as a factory (not a Nest class) so it can
 * be unit-tested against a fake RateLimitService without booting the app, and so
 * `main.ts` wires it with a single `app.use(...)`.
 */
export function buildGlobalRateLimitMiddleware(
  rateLimit: RateLimitService,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    // OFF by default → identical to today (read per request so the flag can be
    // flipped without a redeploy, matching legacy `isGlobalRateLimitOn`).
    if (!rateLimit.isGlobalEnabled()) {
      next();
      // [FEAT-20260826-RLSHADOW] หลัง next() เท่านั้น — และเรียก getter แบบ `?.()`
      // เพราะ harness เก่า (pin ใน rate-limit-bypass-path.spec.ts) สร้าง fake ที่ไม่มี
      // เมธอดนี้ — เรียกตรง ๆ จะ TypeError ทำ pin ตายด้วยเหตุผลที่ไม่ใช่พฤติกรรม
      if (
        rateLimit.isGlobalShadowEnabled?.() &&
        !isBypassPath(req.path || '')
      ) {
        shadowObserve(rateLimit, req);
      }
      return;
    }
    if (isBypassPath(req.path || '')) {
      next();
      return;
    }

    const ip = rateLimit.resolveClientIp(req);
    if (!ip) {
      next();
      return;
    }

    void rateLimit
      .consume('global', ip)
      .then((verdict) => {
        if (verdict.limited) {
          deny(res);
          return;
        }
        next();
      })
      // Defence in depth: consume() already fails open, but a throw here must
      // still allow the request rather than 500 the whole API.
      .catch(() => next());
  };
}
