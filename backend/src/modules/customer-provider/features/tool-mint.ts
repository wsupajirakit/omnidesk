/**
 * [FEAT-20261016-TOOLMINT] Which partner companies a site can MINT a custom tool for — a
 * provider fact, read by the Custom Tools screen through `GET /api/custom-tool-mint`.
 * ===========================================================================
 * Owner 16/10/2026: on the loan site the Custom Tools page offers one mint button per
 * company (demo · Acme · Globex). Three companies = three tools = three separate
 * credential sets, never shared. A company whose env is complete mints a ready tool on the
 * server; one that is not gets the skeleton (endpoints + base URL if set) and the admin fills
 * the rest through the ordinary create form.
 *
 * WHAT A PROVIDER DECLARES (`ProviderToolMint`): the TEMPLATE (endpoints + dynamic tags — the
 * seed bundle, the ONE source; never copied here) and one row per company: id · screen label ·
 * tool name the mint writes · env prefix. Adding a company = one row + three env lines in
 * `src/config/env.schema.ts` (`<prefix>BASE_URL` · `<prefix>USERNAME` · `<prefix>PASSWORD`).
 *
 * 🔴 THE PASSWORD NEVER LEAVES THE SERVER. `toolMintWire` (what the browser gets) carries the
 *    env KEY NAMES that are missing and the base URL — never a username or a password value.
 *    `toolMintCredentials` (server-only) is the one function that returns them, and only the
 *    mint service calls it, straight into `CustomToolsService.create` (which encrypts).
 * 🔴 ABSENT = TODAY. A provider that declares nothing (shop-api) answers null: no button, and the
 *    mint route refuses before reading anything.
 * ⚠️ Changing an env value later does NOT change a tool already minted — the tool keeps its own
 *    encrypted copy (runbook). Re-mint = new name, or edit the tool in the form.
 *
 * Pure — env arrives as a lookup function, so this file never reads `process.env`.
 * revert: delete this file, `toolMint` on the port + loan_v1, the accessor in
 *         `active-provider.ts`, and `src/modules/hooks/tool-mint/`.
 */
import type { SeedBundle } from '@/cli/custom-tool-seed/seed-bundle.types';

export interface ToolMintCompany {
  /** url-safe id — the `:company` of the mint route */
  readonly id: string;
  /** what the button says */
  readonly label: string;
  /** `custom_tools.name` the mint writes (unique across the DB, soft-deleted rows included) */
  readonly toolName: string;
  /** env keys are `${envPrefix}BASE_URL` / `USERNAME` / `PASSWORD` */
  readonly envPrefix: string;
}

export interface ProviderToolMint {
  /** endpoints + tags — the seed bundle itself, so the mint and the CLI cannot drift */
  readonly template: SeedBundle;
  readonly companies: readonly ToolMintCompany[];
}

/** The three env keys of a company, in the order the screen lists what is missing. */
export const TOOL_MINT_ENV_SUFFIXES = [
  'BASE_URL',
  'USERNAME',
  'PASSWORD',
] as const;

/** env key → value (undefined / '' = not set). Injected so this file stays pure. */
export type ToolMintEnvLookup = (key: string) => string | undefined;

const valueOf = (env: ToolMintEnvLookup, key: string): string =>
  String(env(key) ?? '').trim();

/** Only an absolute http(s) address can be a tool's base URL. */
const isHttpUrl = (v: string): boolean => {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

interface CompanyEnvState {
  baseUrl: string;
  username: string;
  password: string;
  /** env keys with no value */
  missing: string[];
  /** env keys set to something unusable (base URL that is not http/https) */
  invalid: string[];
}

function readCompanyEnv(
  company: ToolMintCompany,
  env: ToolMintEnvLookup,
): CompanyEnvState {
  const key = (s: (typeof TOOL_MINT_ENV_SUFFIXES)[number]): string =>
    `${company.envPrefix}${s}`;
  const baseUrl = valueOf(env, key('BASE_URL'));
  const username = valueOf(env, key('USERNAME'));
  const password = valueOf(env, key('PASSWORD'));
  const missing = TOOL_MINT_ENV_SUFFIXES.filter(
    (s) => !{ BASE_URL: baseUrl, USERNAME: username, PASSWORD: password }[s],
  ).map(key);
  const invalid = baseUrl && !isHttpUrl(baseUrl) ? [key('BASE_URL')] : [];
  return { baseUrl, username, password, missing, invalid };
}

/** One company as the browser sees it — no username, no password. */
export interface ToolMintCompanyWire {
  id: string;
  label: string;
  tool_name: string;
  /** env complete and valid ⇒ the server can mint a ready tool */
  ready: boolean;
  /** env KEY NAMES with no value (never values) */
  missing: string[];
  /** env KEY NAMES whose value is unusable */
  invalid: string[];
  /** the base URL when set and valid, else '' — the skeleton's starting point */
  base_url: string;
}

export interface ToolMintWire {
  companies: ToolMintCompanyWire[];
  /** the skeleton the form is filled with when a company is not ready */
  template: {
    auth_type: string;
    timeout_ms: number;
    endpoints: Record<string, unknown>[];
  };
}

/** What `GET /api/custom-tool-mint` answers. null = this site mints nothing (shop-api). */
export function toolMintWire(
  decl: ProviderToolMint | null,
  env: ToolMintEnvLookup,
): ToolMintWire | null {
  if (!decl) return null;
  return {
    companies: decl.companies.map((c) => {
      const s = readCompanyEnv(c, env);
      return {
        id: c.id,
        label: c.label,
        tool_name: c.toolName,
        ready: s.missing.length === 0 && s.invalid.length === 0,
        missing: s.missing,
        invalid: s.invalid,
        base_url: s.invalid.length === 0 ? s.baseUrl : '',
      };
    }),
    template: {
      auth_type: decl.template.tool.auth_type,
      timeout_ms: decl.template.tool.timeout_ms,
      /* a deep copy — the caller may hand it to a form that mutates */
      endpoints: decl.template.tool.endpoints.map(
        (e) => structuredClone(e) as Record<string, unknown>,
      ),
    },
  };
}

export type ToolMintCredentials =
  | {
      ok: true;
      company: ToolMintCompany;
      baseUrl: string;
      username: string;
      password: string;
    }
  | { ok: false; reason: 'not_declared' }
  | { ok: false; reason: 'unknown_company' }
  | {
      ok: false;
      reason: 'incomplete';
      company: ToolMintCompany;
      missing: string[];
      invalid: string[];
    };

/** 🔴 SERVER-ONLY — the one place a company's credentials are read. Only the mint calls it. */
export function toolMintCredentials(
  decl: ProviderToolMint | null,
  companyId: string,
  env: ToolMintEnvLookup,
): ToolMintCredentials {
  if (!decl) return { ok: false, reason: 'not_declared' };
  const company = decl.companies.find((c) => c.id === companyId);
  if (!company) return { ok: false, reason: 'unknown_company' };
  const s = readCompanyEnv(company, env);
  if (s.missing.length > 0 || s.invalid.length > 0) {
    return {
      ok: false,
      reason: 'incomplete',
      company,
      missing: s.missing,
      invalid: s.invalid,
    };
  }
  return {
    ok: true,
    company,
    baseUrl: s.baseUrl.replace(/\/+$/, ''),
    username: s.username,
    password: s.password,
  };
}
