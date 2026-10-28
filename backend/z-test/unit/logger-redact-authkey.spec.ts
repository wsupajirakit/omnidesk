/**
 * [FIX-20260818-AUTHKEYREDACT] ทุก header ที่ถือ credential ต้องอยู่ใน redact list
 *
 * ที่มา: `auth.controller.ts:94` และ `:109` ใส่ JWT ตัวเต็มลง response header
 * `X-Auth-Key` ทุกครั้งที่ login/refresh · cookie ที่ถือ token ตัวเดียวกันถูก redact
 * ไว้แล้ว (`logger.module.ts` `res.headers["set-cookie"]`) แต่ช่อง header ตกไป
 * ⇒ ทุกการ login เขียน token ที่ใช้งานได้จริงลง log
 *
 * ทำไมเทสนี้อ่าน "ค่าคงที่ของ config" ไม่ใช่ยิง HTTP: redact list เป็น argument ของ
 * `LoggerModule.forRootAsync` ซึ่ง pino ใช้ตอน serialize — การพิสูจน์ว่ามันทำงาน
 * ต้องรัน pino จริงพร้อม transport ซึ่งชุดนี้ไม่ได้บูต · สิ่งที่เทสนี้กันได้จริงคือ
 * "มีคนลบบรรทัดนี้ทิ้ง" กับ "มี header ใหม่ที่ถือ credential แล้วลืมใส่" ซึ่งเป็น
 * ทางที่ช่องนี้เปิดมาแต่แรก · ฝั่ง runtime ยืนยันด้วยการ login จริงแล้ว grep log
 * (บันทึกไว้ใน checklist) — เทสกับ live proof คนละหน้าที่กัน
 *
 * ⚠️ เทสนี้อ่าน SOURCE ของ logger.module.ts ตรง ๆ เพราะ redact list ไม่ถูก export
 * ออกมาเป็นค่าที่ import ได้ (มันอยู่ใน object literal ที่ส่งให้ forRootAsync)
 * ถ้าวันหน้าไฟล์นั้นถูก refactor ให้ export list ออกมา ให้เปลี่ยนมา import แทน
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src/infra/logger/logger.module.ts');
const AUTH_CONTROLLER = join(
  process.cwd(),
  'src/modules/auth/auth.controller.ts',
);

/** ตัด comment ออกก่อนตรวจ — ไม่งั้นชื่อ header ที่ถูกพูดถึงในคอมเมนต์จะนับเป็นผ่าน */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('[AUTHKEYREDACT] pino redact list ครอบ header ที่ถือ credential', () => {
  const logger = stripComments(readFileSync(SRC, 'utf8'));

  it('⭐ `res.headers["x-auth-key"]` อยู่ใน redact list', () => {
    expect(logger).toContain('res.headers["x-auth-key"]');
  });

  it('ของเดิมยังอยู่ครบ ไม่ได้เผลอถอดตัวใดออก', () => {
    for (const path of [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-access-token"]',
      'req.headers["x-line-signature"]',
      'req.headers["x-internal-secret"]',
      'req.body.password',
      'req.body.new_password',
      'req.body.old_password',
      'res.headers["set-cookie"]',
    ]) {
      expect(logger).toContain(path);
    }
  });

  it('ชื่อ header ที่ redact ตรงกับที่ auth.controller ตั้งจริง (ตัวพิมพ์เล็ก)', () => {
    // pino เทียบชื่อ header แบบ lowercase — ถ้า controller เปลี่ยนชื่อ header
    // เมื่อไหร่ เทสนี้จะจับได้ว่า redact list ตามไม่ทัน
    const controller = stripComments(readFileSync(AUTH_CONTROLLER, 'utf8'));
    const setHeaders = [
      ...controller.matchAll(/response\.set\('([^']+)'/g),
    ].map((m) => (m[1] ?? '').toLowerCase());
    expect(setHeaders).toContain('x-auth-key');
    for (const header of setHeaders) {
      // ทุก header ที่ตั้งค่าใน response ของ auth ต้องถูก redact
      expect(logger).toContain(`res.headers["${header}"]`);
    }
  });
});
