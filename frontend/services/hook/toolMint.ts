/**
 * [FEAT-20261016-TOOLMINT] [FEAT-20261016-TAGBIND] The Custom Tools page's mint buttons and "ผูก tag"
 * button — the three BE routes, and nothing else.
 *
 *   GET  /api/custom-tool-mint                → which companies this site can mint for (null = none)
 *   POST /api/custom-tool-mint/:company       → the server creates the company's tool from its env
 *   POST /api/custom-tool-tag-bind/:toolId    → bind the template's tags to every OA using the tool
 *
 * 🔴 BE DECIDES. The company list, which company is ready, the skeleton — all from the server
 *    (omnidesk-api `customer-provider/providers/loan-v1/tool-mint.ts`). This file holds no company
 *    name, no host, and NO CREDENTIAL: the password stays in the server env; the wire carries
 *    only the env KEY NAMES that are missing.
 * shop-api answers null (and an older back end 404s) ⇒ `fetchToolMintCatalog` gives null ⇒ the page
 * draws nothing new. The catalog is fixed for the life of the back end, so it is asked once per
 * page load through `providerAnswer` (the same cache rule as every provider switch: a real answer
 * is kept, a failure is not).
 * BE source of the shape: omnidesk-api `customer-provider/features/tool-mint.ts` (`toolMintWire`).
 */
import { translateNow } from '../../i18n';
import { API_BASE_URL, authFetch } from '../apiClient';
import { providerAnswer } from '../chat/providerAnswer';

export interface ToolMintCompany {
  id: string;
  label: string;
  /** the tool name the mint writes */
  toolName: string;
  /** env complete ⇒ the server can mint a ready tool */
  ready: boolean;
  /** env KEY NAMES with no value (never values) */
  missing: string[];
  /** env KEY NAMES whose value is unusable */
  invalid: string[];
  /** '' when unset */
  baseUrl: string;
}

export interface ToolMintCatalog {
  companies: ToolMintCompany[];
  template: {
    authType: string;
    timeoutMs: number;
    endpoints: Record<string, unknown>[];
  };
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** the BE wire (snake_case) → the screen's shape; anything malformed = null (no buttons) */
export function parseToolMintCatalog(data: unknown): ToolMintCatalog | null {
  const w = (data as { tool_mint?: Record<string, any> | null } | null)?.tool_mint;
  if (!w || typeof w !== 'object' || !Array.isArray(w.companies) || !w.template) return null;
  const companies = (w.companies as Record<string, unknown>[])
    .filter((c) => typeof c?.id === 'string' && typeof c?.tool_name === 'string')
    .map((c) => ({
      id: c.id as string,
      label: typeof c.label === 'string' ? c.label : (c.id as string),
      toolName: c.tool_name as string,
      ready: c.ready === true,
      missing: strings(c.missing),
      invalid: strings(c.invalid),
      baseUrl: typeof c.base_url === 'string' ? c.base_url : '',
    }));
  if (companies.length === 0) return null;
  return {
    companies,
    template: {
      authType: typeof w.template.auth_type === 'string' ? w.template.auth_type : 'jwt_login',
      timeoutMs: Number(w.template.timeout_ms) || 8000,
      endpoints: Array.isArray(w.template.endpoints) ? w.template.endpoints : [],
    },
  };
}

const answer = providerAnswer<ToolMintCatalog>('/api/custom-tool-mint', parseToolMintCatalog);

export const fetchToolMintCatalog = (): Promise<ToolMintCatalog | null> => answer.get();

/** Test seam: forget the answer so a spec can ask again. */
export const resetToolMintCatalog = (): void => answer.reset();

export type ToolMintOutcome =
  | { ok: true; message: string }
  | { ok: false; message: string };

/* The BE's error body is `{ error: "<sentence>" }` (omnidesk-api `AllExceptionsFilter`) — found on the
   live run 16/10, when a 409 showed only "HTTP 409". `message` is kept for any other shape. */
const errorMessage = async (res: Response, fallback: string): Promise<string> => {
  try {
    const body = await res.json();
    if (typeof body?.error === 'string' && body.error) return body.error;
    const m = body?.message;
    if (typeof m === 'string' && m) return m;
    if (m && typeof m.message === 'string') return m.message;
  } catch {
    /* no JSON body */
  }
  return `${fallback} (HTTP ${res.status})`;
};

/** POST /api/custom-tool-mint/:company — the server creates the tool from its own env. */
export async function mintCompanyTool(companyId: string): Promise<ToolMintOutcome> {
  const res = await authFetch(
    `${API_BASE_URL}/api/custom-tool-mint/${encodeURIComponent(companyId)}`,
    { method: 'POST' },
  );
  if (!res.ok) return { ok: false, message: await errorMessage(res, translateNow('pageui.hook.mint.failed', 'mint ไม่สำเร็จ')) };
  const body = await res.json();
  const name = body?.data?.tool?.name ?? companyId;
  const inserted = Array.isArray(body?.data?.tags?.inserted) ? body.data.tags.inserted.length : 0;
  return {
    ok: true,
    message: translateNow('pageui.hook.mint.created', 'สร้าง tool "{name}" แล้ว · tag ใหม่ {inserted} ตัว — ไปผูก OA ที่ฟอร์ม OA แล้วกด "ผูก tag" ที่แถวของ tool', { name, inserted }),
  };
}

export interface TagBindReport {
  toolName: string;
  hooks: string[];
  inserted: string[];
  bound: string[];
  already: string[];
  skipped: { tag: string; reason: string }[];
}

/** POST /api/custom-tool-tag-bind/:toolId */
export async function bindToolTags(
  toolId: string,
): Promise<{ ok: true; report: TagBindReport } | { ok: false; message: string }> {
  const res = await authFetch(
    `${API_BASE_URL}/api/custom-tool-tag-bind/${encodeURIComponent(toolId)}`,
    { method: 'POST' },
  );
  if (!res.ok) return { ok: false, message: await errorMessage(res, translateNow('pageui.hook.bind.failed', 'ผูก tag ไม่สำเร็จ')) };
  const d = (await res.json())?.data ?? {};
  return {
    ok: true,
    report: {
      toolName: typeof d.tool?.name === 'string' ? d.tool.name : '',
      hooks: strings(d.hooks),
      inserted: strings(d.inserted),
      bound: strings(d.bound),
      already: strings(d.already),
      skipped: Array.isArray(d.skipped)
        ? d.skipped.filter((s: any) => typeof s?.tag === 'string').map((s: any) => ({ tag: s.tag, reason: String(s.reason ?? '') }))
        : [],
    },
  };
}
