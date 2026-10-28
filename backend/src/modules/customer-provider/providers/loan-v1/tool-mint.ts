/**
 * [FEAT-20261016-TOOLMINT] The loan site's mint buttons — ONE ROW PER COMPANY. EDIT HERE.
 *
 * Owner 16/10/2026: "สามชุดแยกกัน" — three companies, three tools, three credential sets.
 * Every company uses the SAME six endpoints (CUSTOMER_PROFILE included) and the same 15 tags:
 * the template is the seed bundle itself (`src/cli/custom-tool-seed/bundles/loan-v1.bundle.ts`),
 * so the mint, the seed CLI and the runbook can never describe different tools.
 *
 * Add a company: one row below + `<envPrefix>BASE_URL / USERNAME / PASSWORD` in
 * `src/config/env.schema.ts` (optional). Credentials live in the server env only (Coolify /
 * `.env.local`) — never in this file, never in the browser.
 * `toolName` must differ from the seed CLI's `acme` (that row may already exist on the
 * site) and from every other row here — the DB index on the name is unique, deleted rows too.
 */
import { LOAN_V1_SEED_BUNDLE } from '@/cli/custom-tool-seed/bundles/loan-v1.bundle';

import type { ProviderToolMint } from '../../features/tool-mint';

export const LOAN_V1_TOOL_MINT: ProviderToolMint = {
  template: LOAN_V1_SEED_BUNDLE,
  companies: [
    {
      id: 'demo',
      label: 'demo',
      toolName: 'loan_demo',
      envPrefix: 'LOAN_TOOL_DEMO_',
    },
    {
      id: 'acme',
      label: 'Acme',
      toolName: 'loan_acme',
      envPrefix: 'LOAN_TOOL_ACME_',
    },
    {
      id: 'examplepartner',
      label: 'Globex',
      toolName: 'loan_examplepartner',
      envPrefix: 'LOAN_TOOL_GLOBEX_',
    },
  ],
};
