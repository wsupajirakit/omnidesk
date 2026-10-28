/**
 * [FEAT-20261014-TOOLSEED] What a vendor hands the seed CLI: one custom tool + its dynamic tags.
 *
 * A bundle is DATA captured from a configuration already proven against the vendor's real
 * upstream. It carries no credentials (they arrive from the environment at run time) and no
 * deployment address that will be trusted on its own (`tool.base_url` is the CAPTURE host;
 * see `resolveSeedBaseUrl`).
 */
export interface SeedEndpoint extends Record<string, unknown> {
  key: string;
}

export interface SeedTool {
  name: string;
  /** The host the snapshot was captured against — never written to a deployment by default. */
  base_url: string;
  auth_type: string;
  timeout_ms: number;
  endpoints: SeedEndpoint[];
}

export interface SeedTag {
  tag: string;
  sub_type: string;
  value: string;
  /** Carries the bundle's `tagMarker` — how a re-run recognises a row it wrote itself. */
  detail: string;
}

export interface SeedBundle {
  /** `--bundle <id>` selects it. */
  id: string;
  /** One line for the operator reading the plan. */
  description: string;
  /** Substring every tag `detail` of this bundle contains; rows without it are not ours. */
  tagMarker: string;
  tool: SeedTool;
  tags: SeedTag[];
}
