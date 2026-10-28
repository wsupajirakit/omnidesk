/**
 * [FIX-20260818-HELMETFIRST] helmet ต้องถูก mount ก่อน static เสมอ
 *
 * ## ทำไมเป็นเทสที่อ่าน source ไม่ใช่เทสที่ยิง HTTP
 * ลำดับ middleware เป็นคุณสมบัติของ `bootstrap()` ใน `main.ts` ซึ่งไม่ถูก export
 * และการบูตจริงต้องมี Mongo/Redis ⇒ ชุด unit บูตไม่ได้ · สิ่งที่เทสนี้กันคือ
 * "มีคนย้ายบล็อกกลับ" หรือ "มีคนแทรก static mount ใหม่ไว้ข้างบน" ซึ่งเป็นทางเดียว
 * ที่รูนี้จะกลับมา · ส่วนพฤติกรรมจริง (header โผล่ + body ไม่เปลี่ยนสักไบต์)
 * พิสูจน์ด้วย curl จริงก่อน/หลัง แล้วบันทึก sha256 ไว้ใน checklist — คนละหน้าที่กัน
 *
 * รูปแบบนี้ใช้ที่อื่นใน repo อยู่แล้ว (ตรึง call site ด้วยการอ่าน source โดยตัด
 * comment ออกก่อน) เพราะคอมเมนต์ในไฟล์นี้พูดถึงชื่อ middleware ตรง ๆ
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAIN = join(process.cwd(), 'src/main.ts');

/**
 * ตัดคอมเมนต์ทิ้งก่อน ไม่งั้นคำว่า helmet/useStaticAssets ในคำอธิบายจะทำให้เทสหลอกตัวเอง
 *
 * ⚠️ ลำดับสำคัญ — ต้องตัด `//` ก่อน แล้วค่อยตัด block: `main.ts` มีคอมเมนต์บรรทัดที่
 * มี `/*` อยู่ข้างใน (บรรทัด revert ของบล็อก helmet) ถ้าตัด block ก่อน regex จะจับคู่
 * ข้าม แล้วกลืนโค้ดจริงหายไป 5 KB จนหา `helmet(` ไม่เจอเลย — เจอมาแล้วตอนเขียนเทสนี้
 * (เทสแดง 5/5 ทั้งที่โค้ดถูก) ซึ่งเป็นตัวอย่างที่ดีของ "เทสแดงเพราะเทสผิด ไม่ใช่โค้ดผิด"
 */
const stripComments = (src: string): string =>
  src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('[HELMETFIRST] ลำดับ middleware ใน main.ts', () => {
  const code = stripComments(readFileSync(MAIN, 'utf8'));
  const helmetAt = code.indexOf('helmet(');
  const hardenedAt = code.indexOf('buildHardenedImageServeMiddleware(');
  const staticAt = code.indexOf('useStaticAssets(');

  it('ทุกตัวยังถูก mount อยู่จริง (ไม่ได้หายไปเงียบ ๆ)', () => {
    expect(helmetAt).toBeGreaterThan(-1);
    expect(hardenedAt).toBeGreaterThan(-1);
    expect(staticAt).toBeGreaterThan(-1);
  });

  it('⭐ helmet มาก่อน hardened-image middleware', () => {
    expect(helmetAt).toBeLessThan(hardenedAt);
  });

  it('⭐ helmet มาก่อน useStaticAssets ⇒ ไฟล์ใต้ /uploads และ /bank-logos ได้ header ครบ', () => {
    expect(helmetAt).toBeLessThan(staticAt);
  });

  it('hardened-image middleware ยังมาก่อน useStaticAssets (กติกาเดิม ห้ามสลับ)', () => {
    // ของเดิมที่ต้องไม่พัง: hardened middleware ต้องเป็นคนตอบ /uploads/images/*
    // ไม่ใช่ express.static — ไม่งั้น 404 จะกลับไปบอกว่าไฟล์มีอยู่จริงหรือไม่
    expect(hardenedAt).toBeLessThan(staticAt);
  });

  it('crossOriginResourcePolicy ยังถูกปิดไว้ (ไม่งั้น LINE โหลดรูปไม่ได้)', () => {
    expect(code).toContain('crossOriginResourcePolicy: false');
  });
});
