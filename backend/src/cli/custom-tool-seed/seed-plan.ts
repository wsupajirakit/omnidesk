/**
 * [FEAT-20261014-TOOLSEED] What a seed run WILL do — decided before anything is written. Pure.
 *
 * Three decisions, each a defect of the CLI this replaces (`seed-loan-v1-tool.ts`, loan-only):
 *   1. WHERE the tool points. The old CLI wrote the snapshot's `base_url` — the demo host it was
 *      captured against — to whatever database it ran on. Now a write needs an explicit address
 *      (`--base-url` or `SEED_TOOL_BASE_URL`), and the capture host itself is refused unless the
 *      operator says `--allow-capture-host` (a dev clone that really does talk to the demo).
 *   2. HOW tags are bound to an OA. The old `--hook` wrote `hook_ids: [hookId]`, so seeding a
 *      second OA unbound the first. Now `$addToSet`.
 *   3. WHAT happens on a name collision. `dynamic_tags.tag` is unique (`dynamic-tag.schema.ts`);
 *      a same-named tag this bundle did not write made `insertOne` throw half-way through. Now
 *      every collision is found first and the run is refused whole — never a half-seeded OA
 *      whose prompt names a tag that was not written.
 *
 * revert: see `seed-custom-tool.ts`.
 */
import type { SeedBundle, SeedEndpoint, SeedTag } from './seed-bundle.types';

/** Fields the schema carries that a snapshot omits (it keeps only what means something). */
export function fullEndpoint(e: SeedEndpoint): Record<string, unknown> {
  return {
    label: e['label'] ?? e.key,
    require_jwt: false,
    is_login: false,
    is_refresh: false,
    is_profile: false,
    request_type: 'json',
    payload: {},
    token_path: '',
    refresh_token_path: '',
    role: '',
    cache_ttl_sec: null,
    profile_map: { name: '', phone: '', code: '', tier: '' },
    result_rules: [],
    result_map: { member_id: '', phone: '', name: '' },
    idempotency: {
      enabled: false,
      location: 'header',
      field: 'Idempotency-Key',
      retry_on_timeout: 0,
    },
    status: true,
    ...e,
  };
}

export type BaseUrlChoice =
  | { ok: true; url: string; isCaptureHost: boolean }
  | { ok: false; reason: string };

const sameHost = (a: string, b: string): boolean => {
  try {
    return new URL(a).host.toLowerCase() === new URL(b).host.toLowerCase();
  } catch {
    return false;
  }
};

export function resolveSeedBaseUrl(
  bundle: SeedBundle,
  opts: { requested?: string; apply: boolean; allowCaptureHost: boolean },
): BaseUrlChoice {
  const capture = bundle.tool.base_url;
  const requested = (opts.requested ?? '').trim();
  if (!requested) {
    if (opts.apply) {
      return {
        ok: false,
        reason:
          'a write needs the deployment address: --base-url <url> or SEED_TOOL_BASE_URL ' +
          `(the bundle only knows the capture host ${capture})`,
      };
    }
    return { ok: true, url: capture, isCaptureHost: true };
  }
  if (!/^https?:\/\/[^/\s]+/i.test(requested)) {
    return { ok: false, reason: `not an http(s) address: ${requested}` };
  }
  const isCaptureHost = sameHost(requested, capture);
  if (isCaptureHost && opts.apply && !opts.allowCaptureHost) {
    return {
      ok: false,
      reason:
        `${requested} is the host the bundle was CAPTURED against, not a deployment — ` +
        'pass --allow-capture-host only if this database really should talk to it',
    };
  }
  return { ok: true, url: requested.replace(/\/+$/, ''), isCaptureHost };
}

export function buildToolDoc(
  bundle: SeedBundle,
  input: {
    baseUrl: string;
    username: string;
    encryptedPassword: string;
    now: Date;
  },
): Record<string, unknown> {
  return {
    name: bundle.tool.name,
    description: `${bundle.description} — seeded by seed-custom-tool`,
    base_url: input.baseUrl,
    auth_type: bundle.tool.auth_type,
    username: input.username,
    password: input.encryptedPassword,
    api_key: '',
    api_key_header: 'Authorization',
    timeout_ms: bundle.tool.timeout_ms,
    status: true,
    endpoints: bundle.tool.endpoints.map(fullEndpoint),
    updated_at: input.now,
  };
}

/** The row shape the plan needs from an existing `dynamic_tags` document. */
export interface ExistingTag {
  _id: unknown;
  tag: string;
  detail?: unknown;
}

export type TagAction =
  | { kind: 'insert'; tag: string; doc: Record<string, unknown> }
  | {
      kind: 'update';
      tag: string;
      id: unknown;
      update: Record<string, unknown>;
    }
  | { kind: 'conflict'; tag: string; existingDetail: string };

const fieldsOf = (t: SeedTag, now: Date): Record<string, unknown> => ({
  sub_type: t.sub_type,
  value: t.value,
  detail: t.detail,
  type: 'api',
  status: true,
  updated_at: now,
});

export function planTags(
  bundle: SeedBundle,
  existing: readonly ExistingTag[],
  hookId: unknown,
  now: Date,
): TagAction[] {
  const byName = new Map(existing.map((e) => [e.tag, e]));
  return bundle.tags.map((t): TagAction => {
    const found = byName.get(t.tag);
    if (found) {
      const detail = typeof found.detail === 'string' ? found.detail : '';
      if (!detail.includes(bundle.tagMarker)) {
        return { kind: 'conflict', tag: t.tag, existingDetail: detail };
      }
      return {
        kind: 'update',
        tag: t.tag,
        id: found._id,
        update: {
          $set: fieldsOf(t, now),
          ...(hookId ? { $addToSet: { hook_ids: hookId } } : {}),
        },
      };
    }
    return {
      kind: 'insert',
      tag: t.tag,
      doc: {
        ...fieldsOf(t, now),
        tag: t.tag,
        created_at: now,
        created_by: null,
        updated_by: null,
        deleted_at: null,
        group_id: null,
        group_ids: [],
        hook_id: null,
        hook_ids: hookId ? [hookId] : [],
        primary_credential_source: null,
        ref_api_id: null,
      },
    };
  });
}
