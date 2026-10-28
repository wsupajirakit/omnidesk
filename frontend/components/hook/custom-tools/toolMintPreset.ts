/**
 * [FEAT-20261016-TOOLMINT] What the create form is filled with when a company's env is NOT
 * complete — the BE skeleton, nothing typed here. Pure.
 *
 * Name + base URL (when the server has one) + auth + timeout + the template's endpoints, copied.
 * NO username, NO password: the admin types those and saves through the ordinary create route,
 * which encrypts them. The page merges each endpoint over its own empty row (`EMPTY_ENDPOINT`)
 * so every form field exists.
 */
import type { ToolMintCatalog, ToolMintCompany } from '../../../services/hook/toolMint';

export interface ToolMintPreset {
  name: string;
  description: string;
  base_url: string;
  auth_type: 'jwt_login' | 'api_key' | 'basic' | 'none' | 'hmac_signature';
  timeout_ms: number;
  endpoints: Record<string, unknown>[];
}

const AUTH_TYPES: ToolMintPreset['auth_type'][] = ['jwt_login', 'api_key', 'basic', 'none', 'hmac_signature'];

export function buildToolMintPreset(company: ToolMintCompany, catalog: ToolMintCatalog): ToolMintPreset {
  const auth = catalog.template.authType as ToolMintPreset['auth_type'];
  return {
    name: company.toolName,
    description: `${company.label} — สร้างจากโครงของปุ่ม mint (กรอก username / password แล้วบันทึก)`,
    base_url: company.baseUrl,
    auth_type: AUTH_TYPES.includes(auth) ? auth : 'jwt_login',
    timeout_ms: catalog.template.timeoutMs,
    /* deep copies — the form edits them in place */
    endpoints: catalog.template.endpoints.map((e) => JSON.parse(JSON.stringify(e)) as Record<string, unknown>),
  };
}
