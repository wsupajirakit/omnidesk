/**
 * Response comparison helpers for golden tests.
 *
 * The dashboard is being pointed at this service without any frontend change,
 * so "works" is not the bar — responses must be shaped exactly like the legacy
 * backend's. These helpers compare *structure* rather than values, because ids
 * and timestamps legitimately differ between two runs while a renamed or
 * dropped field is a real break.
 */

/** Keys whose values change between runs and must not be compared literally. */
const VOLATILE_KEYS = new Set([
  '_id',
  'id',
  'createdAt',
  'updatedAt',
  'created_at',
  'updated_at',
  'ts',
  'iat',
  'exp',
  'token',
  'access_token',
]);

export type ShapeNode = string | ShapeNode[] | { [key: string]: ShapeNode };

/**
 * Reduces a payload to its type structure: objects keep their keys (sorted),
 * arrays collapse to the shape of their first element, leaves become type names.
 */
export function toShape(value: unknown): ShapeNode {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    // An empty array carries no shape information; treat every array as
    // homogeneous and sample the first element only.
    return value.length === 0 ? [] : [toShape(value[0])];
  }
  if (typeof value === 'object') {
    const result: Record<string, ShapeNode> = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = toShape((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return typeof value;
}

/** Field paths present in one payload but not the other — the breaking kind. */
export function diffKeys(
  legacy: unknown,
  candidate: unknown,
  path = '',
): string[] {
  const differences: string[] = [];

  const isPlainObject = (input: unknown): input is Record<string, unknown> =>
    typeof input === 'object' && input !== null && !Array.isArray(input);

  if (isPlainObject(legacy) && isPlainObject(candidate)) {
    for (const key of new Set([
      ...Object.keys(legacy),
      ...Object.keys(candidate),
    ])) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in candidate)) differences.push(`missing: ${childPath}`);
      else if (!(key in legacy)) differences.push(`unexpected: ${childPath}`);
      else
        differences.push(...diffKeys(legacy[key], candidate[key], childPath));
    }
    return differences;
  }

  if (Array.isArray(legacy) && Array.isArray(candidate)) {
    if (legacy.length > 0 && candidate.length > 0) {
      differences.push(...diffKeys(legacy[0], candidate[0], `${path}[0]`));
    }
    return differences;
  }

  const leafKey = path.split('.').pop() ?? '';
  if (!VOLATILE_KEYS.has(leafKey) && typeof legacy !== typeof candidate) {
    differences.push(
      `type: ${path} (legacy=${typeof legacy}, candidate=${typeof candidate})`,
    );
  }

  return differences;
}

/**
 * Fields that must never appear in a response, whatever the legacy backend did.
 *
 * Scope note: this list only holds secrets the legacy backend already withheld,
 * so enforcing it cannot change the payload the dashboard receives. Anything the
 * legacy backend *does* return stays until it is removed deliberately, together
 * with the frontend change — otherwise a security cleanup silently breaks the
 * very comparison that proves the rewrite is faithful.
 */
const FORBIDDEN_FIELDS = [
  'password',
  'password_hash',
  'passwordHash',
  'salt',
  'encryption_key',
  'jwt_secret',
];

/** Dotted paths of any forbidden field found anywhere in the payload. */
export function findLeakedSecrets(payload: unknown, path = ''): string[] {
  const leaks: string[] = [];

  if (Array.isArray(payload)) {
    payload.forEach((item, index) =>
      leaks.push(...findLeakedSecrets(item, `${path}[${index}]`)),
    );
    return leaks;
  }

  if (typeof payload === 'object' && payload !== null) {
    for (const [key, value] of Object.entries(
      payload as Record<string, unknown>,
    )) {
      const childPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN_FIELDS.includes(key)) leaks.push(childPath);
      // `enc:` marks a secret stored encrypted at rest — it must be decrypted
      // for use server-side, never forwarded to a client.
      else if (typeof value === 'string' && value.startsWith('enc:'))
        leaks.push(childPath);
      else leaks.push(...findLeakedSecrets(value, childPath));
    }
  }

  return leaks;
}

/**
 * Value-level comparison for payloads whose CONTENT is the contract.
 *
 * `diffKeys` deliberately compares structure only, which is right for lists of
 * records where ids and timestamps differ between runs. It is not enough for a
 * dictionary: two backends can agree perfectly on shape while disagreeing on
 * every word in it, and a shape-only check would call that parity. Anywhere the
 * body *is* the data — translations, rule tables — the values must be diffed.
 *
 * `volatileKeys` names the leaves that legitimately differ (a per-process cache
 * instance id, an age in milliseconds); they are checked for presence and type
 * by `diffKeys`, and skipped here.
 *
 * Two measurements, both from deliberately injected defects, are why this
 * compares everything rather than a list of known-interesting keys:
 *
 *   - a page cap of 300 changed to 299, and `Hook not found` changed to
 *     `Hook not found!`, both passed a shape-only diff at 31/31 green
 *   - an earlier version of this function compared only `error`, `message`,
 *     `pagination` and `meta`. The chain-run list answers a flat
 *     `{data, total, page, limit}` with no wrapper, so mutating its cap from
 *     100 to 99 stayed green at 73/73 while the wire showed the difference
 *
 * A whitelist can only police the envelopes someone thought of. Comparing all
 * values and naming the few that are genuinely volatile fails in the safe
 * direction: a new endpoint shape is covered by default, and a false positive
 * is visible rather than silent.
 */
export function diffContractValues(
  legacy: unknown,
  candidate: unknown,
  volatileKeys: ReadonlySet<string> = new Set(),
  path = '',
): string[] {
  const differences: string[] = [];
  const leafKey = path.split('.').pop() ?? '';
  if (volatileKeys.has(leafKey)) return differences;

  const isPlainObject = (input: unknown): input is Record<string, unknown> =>
    typeof input === 'object' && input !== null && !Array.isArray(input);

  if (isPlainObject(legacy) && isPlainObject(candidate)) {
    for (const key of new Set([
      ...Object.keys(legacy),
      ...Object.keys(candidate),
    ])) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in candidate)) {
        differences.push(`missing: ${childPath}`);
      } else if (!(key in legacy)) {
        differences.push(`unexpected: ${childPath}`);
      } else {
        differences.push(
          ...diffContractValues(
            legacy[key],
            candidate[key],
            volatileKeys,
            childPath,
          ),
        );
      }
    }
    return differences;
  }

  if (Array.isArray(legacy) && Array.isArray(candidate)) {
    if (legacy.length !== candidate.length) {
      differences.push(
        `length: ${path} (legacy=${legacy.length}, candidate=${candidate.length})`,
      );
    }
    const shorter = Math.min(legacy.length, candidate.length);
    for (let i = 0; i < shorter; i++) {
      differences.push(
        ...diffContractValues(
          legacy[i],
          candidate[i],
          volatileKeys,
          `${path}[${i}]`,
        ),
      );
    }
    return differences;
  }

  if (legacy !== candidate) {
    differences.push(
      `value: ${path} (legacy=${String(legacy)}, candidate=${String(candidate)})`,
    );
  }
  return differences;
}
