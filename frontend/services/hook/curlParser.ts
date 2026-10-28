/**
 * ==== [FEAT-20260729-CUSTOOL] START (branch: to_dev_auto เท่านั้น) ====
 *
 * curlParser — แกะคำสั่ง cURL (หรือ URL เปล่า ๆ) ให้กลายเป็นค่าที่กรอกฟอร์มได้
 * ใช้ในหน้า Custom Tools เพื่อให้วาง cURL จาก Postman แล้วกรอกให้อัตโนมัติ
 *
 * ── เจตนา: กรอกให้ "เท่าที่มั่นใจ" เท่านั้น ──────────────────────────────
 * อะไรที่เดาไม่ได้จริง ๆ ปล่อยว่างให้คนกรอก/ติ๊กเอง ดีกว่าเดาผิดแล้วเงียบ
 * (เช่น key ของ endpoint, ธง is_login/is_profile — คนรู้ดีกว่า)
 *
 * รองรับ 2 โหมด:
 *   1. main — แกะ base_url + creds (ตัว tool)
 *   2. path — แกะ method + path + body + header (ราย endpoint)
 * แยกกันเพราะ cURL เส้นเดียวมีข้อมูลของทั้ง 2 ระดับปนกันอยู่
 *
 * revert: ลบไฟล์นี้ + ปุ่ม "วาง cURL" ใน pages/CustomTools.tsx
 * ==== [FEAT-20260729-CUSTOOL] ====
 */

import { translateNow } from '../../i18n';

export interface ParsedCurl {
  method: string;
  /** origin เช่น https://api.example.com (ไม่มี path) */
  origin: string;
  /** path + query เช่น shop-api/v3/customer?line_user_id=U123 */
  path: string;
  /** query params ที่แกะได้ (ไว้โชว์ให้ดูว่าจะกลายเป็น placeholder อะไร) */
  query: Record<string, string>;
  headers: Record<string, string>;
  /** body ที่ parse เป็น object ได้ (ถ้าเป็น JSON) */
  body: Record<string, any> | null;
  /** body ดิบ เผื่อ parse ไม่ได้ */
  rawBody: string;
  /** เดาจาก content-type + รูปแบบ body */
  requestType: 'json' | 'form' | 'form-data';
  /** มี Authorization: Bearer มาด้วยไหม → เดาว่าเส้นนี้ต้องใช้ JWT */
  hasBearer: boolean;
  /** username/password ที่เจอใน body (เฉพาะเส้น login) */
  username?: string;
  password?: string;
  errors: string[];
}

/** ต่อบรรทัดที่ถูกตัดด้วย \ ให้เป็นบรรทัดเดียว แล้วเก็บ token โดยเคารพ quote */
const tokenize = (input: string): string[] => {
  const joined = input.replace(/\\\r?\n/g, ' ').trim();
  const tokens: string[] = [];
  let cur = '';
  let quote: string | null = null;

  for (let i = 0; i < joined.length; i++) {
    const ch = joined[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (cur) { tokens.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
};

/**
 * แกะ cURL — รับได้ทั้งคำสั่ง curl เต็ม ๆ และ URL เปล่า ๆ
 * ไม่ throw: ข้อผิดพลาดใส่ไว้ใน .errors ให้ UI ตัดสินใจเอง
 */
export const parseCurl = (input: string): ParsedCurl => {
  const out: ParsedCurl = {
    method: '', origin: '', path: '', query: {}, headers: {},
    body: null, rawBody: '', requestType: 'json', hasBearer: false, errors: [],
  };

  const text = String(input || '').trim();
  if (!text) { out.errors.push(translateNow('pageui.hook.curl.empty', 'ยังไม่ได้วางอะไรมา')); return out; }

  const tokens = tokenize(text);
  let url = '';
  let explicitMethod = '';

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];

    if (tk === 'curl') continue;
    if (tk === '--location' || tk === '-L' || tk === '--compressed' || tk === '-s') continue;

    if (tk === '-X' || tk === '--request') { explicitMethod = (tokens[++i] || '').toUpperCase(); continue; }

    if (tk === '-H' || tk === '--header') {
      const h = tokens[++i] || '';
      const idx = h.indexOf(':');
      if (idx > 0) {
        const name = h.slice(0, idx).trim();
        const value = h.slice(idx + 1).trim();
        out.headers[name] = value;
      }
      continue;
    }

    if (tk === '-d' || tk === '--data' || tk === '--data-raw' || tk === '--data-urlencode' || tk === '--data-binary') {
      out.rawBody = tokens[++i] || '';
      continue;
    }

    if (tk === '-F' || tk === '--form') {
      const f = tokens[++i] || '';
      const eq = f.indexOf('=');
      if (eq > 0) {
        out.body = out.body || {};
        out.body[f.slice(0, eq)] = f.slice(eq + 1);
      }
      out.requestType = 'form-data';
      continue;
    }

    if (tk === '-u' || tk === '--user') {
      const cred = tokens[++i] || '';
      const c = cred.indexOf(':');
      if (c > 0) { out.username = cred.slice(0, c); out.password = cred.slice(c + 1); }
      continue;
    }

    // ตัวเลือกอื่นที่กินค่าถัดไป — ข้ามทั้งคู่ กันไปหลงเป็น URL
    if (tk.startsWith('-')) {
      if (['-e', '--referer', '-A', '--user-agent', '-b', '--cookie', '--connect-timeout', '-m', '--max-time'].includes(tk)) i++;
      continue;
    }

    if (!url && /^https?:\/\//i.test(tk)) url = tk;
  }

  if (!url) { out.errors.push(translateNow('pageui.hook.curl.no_url', 'หา URL ไม่เจอ (ต้องขึ้นต้นด้วย http:// หรือ https://)')); return out; }

  // ── แยก origin / path / query ──
  try {
    const u = new URL(url);
    out.origin = `${u.protocol}//${u.host}`;
    out.path = u.pathname.replace(/^\/+/, '') + (u.search || '');
    u.searchParams.forEach((v, k) => { out.query[k] = v; });
  } catch (e) {
    out.errors.push(translateNow('pageui.hook.curl.bad_url', 'URL ไม่ถูกต้อง'));
    return out;
  }

  // ── body ──
  if (out.rawBody) {
    const ct = (out.headers['Content-Type'] || out.headers['content-type'] || '').toLowerCase();
    if (ct.includes('x-www-form-urlencoded')) {
      out.requestType = 'form';
      out.body = {};
      new URLSearchParams(out.rawBody).forEach((v, k) => { (out.body as any)[k] = v; });
    } else {
      try {
        const parsed = JSON.parse(out.rawBody);
        if (parsed && typeof parsed === 'object') { out.body = parsed; out.requestType = 'json'; }
      } catch {
        // ไม่ใช่ JSON → ลองมองเป็น urlencoded
        if (out.rawBody.includes('=')) {
          out.requestType = 'form';
          out.body = {};
          new URLSearchParams(out.rawBody).forEach((v, k) => { (out.body as any)[k] = v; });
        } else {
          out.errors.push(translateNow('pageui.hook.curl.bad_body', 'อ่าน body ไม่ออก (ไม่ใช่ JSON และไม่ใช่ form) — กรอก payload เองได้'));
        }
      }
    }
  }

  // ── method: ใช้ที่ระบุมา ถ้าไม่ระบุเดาจากการมี body ──
  out.method = explicitMethod || (out.rawBody || out.body ? 'POST' : 'GET');

  // ── Authorization: Bearer → เส้นนี้น่าจะต้องใช้ JWT ──
  const auth = out.headers['Authorization'] || out.headers['authorization'] || '';
  out.hasBearer = /^bearer\s+/i.test(auth);

  // ── creds จาก body (เฉพาะเส้น login) ──
  if (out.body) {
    const b = out.body as Record<string, any>;
    const uKey = Object.keys(b).find((k) => /^(username|user|email|login)$/i.test(k));
    const pKey = Object.keys(b).find((k) => /^(password|pass|pwd|secret)$/i.test(k));
    if (uKey && typeof b[uKey] === 'string') out.username = out.username || b[uKey];
    if (pKey && typeof b[pKey] === 'string') out.password = out.password || b[pKey];
  }

  return out;
};

/**
 * แปลง query ที่เป็น "ค่าจริง" ให้เป็น placeholder ที่ระบบรู้จัก
 * เช่น line_user_id=U_SIM_DEMO → line_user_id={{line_user_id}}
 *
 * ทำเฉพาะคีย์ที่ระบบมี placeholder ให้จริง ๆ (line_user_id / channel_user_id /
 * userId / web_code) คีย์อื่นปล่อยค่าเดิมไว้ ให้คนตัดสินใจเอง
 */
const PLACEHOLDER_KEYS = ['line_user_id', 'channel_user_id', 'userId', 'user_id', 'web_code'];

export const templatizePath = (path: string): string => {
  const [base, qs] = String(path || '').split('?');
  if (!qs) return base;

  const parts = qs.split('&').map((pair) => {
    const [k, v] = pair.split('=');
    if (!k) return pair;
    const match = PLACEHOLDER_KEYS.find((pk) => pk.toLowerCase() === k.toLowerCase());
    if (!match) return pair;
    // web_code มาจาก hook ตอน runtime อยู่แล้ว → ใส่ placeholder ให้เหมือนกัน
    return `${k}={{${match === 'user_id' ? 'line_user_id' : match}}}`;
  });

  return `${base}?${parts.join('&')}`;
};
// ==== [FEAT-20260729-CUSTOOL] END ====
