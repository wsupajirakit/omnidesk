/**
 * [FEAT-20261022-I18NTICKETEN] Divider rows in another UI language — DISPLAY ONLY.
 *
 * The backend writes divider rows in Thai (`ticket-divider.helper.ts`, `assist-notification.ts`,
 * `unlinked-slip-refusal.handler.ts`, …) and the transcript keeps them byte for byte. This maps
 * the known wordings to i18n keys at draw time; the free part (admin name, minutes, reason,
 * check body) is carried over untouched.
 *   · th: th.json holds the same Thai templates ⇒ the line reads exactly as stored
 *   · an unknown wording (new BE text, free text) ⇒ shown as stored
 * The stored `content` is never changed, and nothing matches against the translated text.
 * revert: delete this file + its call in ChatRoomView `SystemDivider`.
 */
type T = (key: string, fallback?: string, vars?: Record<string, unknown>) => string;

const RULES: ReadonlyArray<{ re: RegExp; key: string; th: string; vars: string[] }> = [
  { re: /^รับเคส โดย (.+)$/s, key: 'ticketui.divider.accept', th: 'รับเคส โดย {actor}', vars: ['actor'] },
  { re: /^โอนเคส โดย (.+)$/s, key: 'ticketui.divider.assign', th: 'โอนเคส โดย {actor}', vars: ['actor'] },
  { re: /^ปิดเคส โดย (.+)$/s, key: 'ticketui.divider.close', th: 'ปิดเคส โดย {actor}', vars: ['actor'] },
  { re: /^เปิดเคส โดย (.+)$/s, key: 'ticketui.divider.open', th: 'เปิดเคส โดย {actor}', vars: ['actor'] },
  { re: /^บอทกลับมาดูแลแล้ว$/, key: 'ticketui.divider.bot_back', th: 'บอทกลับมาดูแลแล้ว', vars: [] },
  {
    re: /^เปิดเคสอัตโนมัติ จากเงื่อนไข re-assist (\d+) นาที$/,
    key: 'ticketui.divider.auto_ticket',
    th: 'เปิดเคสอัตโนมัติ จากเงื่อนไข re-assist {minutes} นาที',
    vars: ['minutes'],
  },
  { re: /^เคสนี้สร้างโดยระบบ เนื่องจาก (.*)$/s, key: 'ticketui.divider.direct_because', th: 'เคสนี้สร้างโดยระบบ เนื่องจาก {reason}', vars: ['reason'] },
  { re: /^เคสนี้สร้างโดยระบบ (.+)$/s, key: 'ticketui.divider.direct', th: 'เคสนี้สร้างโดยระบบ {reason}', vars: ['reason'] },
  { re: /^ปิด Case #(\d+)$/, key: 'ticketui.divider.case_closed_n', th: 'ปิด Case #{n}', vars: ['n'] },
  { re: /^🔎 ผลตรวจสลิป: (.*)$/s, key: 'ticketui.divider.slip_check', th: '🔎 ผลตรวจสลิป: {body}', vars: ['body'] },
];

export function translateDividerLabel(text: string, t: T): string {
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (!m) continue;
    const vars: Record<string, unknown> = {};
    r.vars.forEach((name, i) => { vars[name] = m[i + 1]; });
    const out = t(r.key, r.th, vars);
    // a `t` that does not interpolate (no provider mounted) hands back the raw template
    return r.vars.some((name) => out.includes(`{${name}}`) && !String(vars[name]).includes(`{${name}}`)) ? text : out;
  }
  return text;
}
