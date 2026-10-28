/**
 * Registry of user-settable target flags, plus its validator.
 *
 * LIFTED from legacy-api/src/services/handoff/{configSchema,configStore}.js.
 *
 * The registry is declared once and does two jobs: the front end renders a form
 * from `GET /api/handoff/config-schema`, and the back end validates against the
 * same declaration before storing. One source of truth for both sides.
 *
 * The list is allowed to be empty — with no entries `validateConfig` accepts
 * only `{}` and the FE renders nothing, so the whole feature is a no-op. The
 * four `demo_*` entries below are the legacy backend's, kept verbatim because
 * `GET /api/handoff/config-schema` returns them and the golden diff compares
 * that response. They are not behaviour flags; nothing reads them.
 */

import { coerceString } from './coerce-string';

export type ConfigSpecType = 'boolean' | 'number' | 'string' | 'enum';

export interface ConfigLabel {
  th: string;
  en: string;
}

export interface ConfigSpec {
  type: ConfigSpecType;
  default: boolean | number | string;
  label: ConfigLabel;
  options?: string[];
  min?: number;
  max?: number;
  maxLength?: number;
  help?: string;
}

/** Key order is preserved — `publicSchema()` emits entries in this order. */
export const CONFIG_SCHEMA: Record<string, ConfigSpec> = {
  demo_skip_retry: {
    type: 'boolean',
    default: false,
    label: { th: '(เดโม) ข้ามการ retry', en: '(demo) Skip retry' },
    help: 'demo boolean flag — safe to remove',
  },
  demo_daily_cap: {
    type: 'number',
    default: 0,
    min: 0,
    max: 100000,
    label: { th: '(เดโม) เพดานต่อวัน', en: '(demo) Daily cap' },
    help: 'demo number flag — safe to remove',
  },
  demo_priority: {
    type: 'enum',
    options: ['low', 'normal', 'high'],
    default: 'normal',
    label: { th: '(เดโม) ความสำคัญ', en: '(demo) Priority' },
    help: 'demo enum flag — safe to remove',
  },
  demo_note: {
    type: 'string',
    default: '',
    maxLength: 120,
    label: { th: '(เดโม) หมายเหตุ', en: '(demo) Note' },
    help: 'demo string flag — safe to remove',
  },
};

type CoerceResult =
  { ok: true; value: boolean | number | string } | { ok: false; error: string };

/** Casts a raw value to the declared type, or explains why it cannot. */
function coerce(spec: ConfigSpec, raw: unknown): CoerceResult {
  switch (spec.type) {
    case 'boolean': {
      const isTrue = raw === true || raw === 'true' || raw === 1 || raw === '1';
      const isFalse =
        raw === false || raw === 'false' || raw === 0 || raw === '0';
      if (
        !isTrue &&
        !isFalse &&
        raw !== undefined &&
        raw !== null &&
        raw !== ''
      ) {
        return { ok: false, error: 'expected boolean' };
      }
      return { ok: true, value: isTrue };
    }
    case 'number': {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return { ok: false, error: 'expected number' };
      }
      if (spec.min != null && parsed < spec.min) {
        return { ok: false, error: `min ${spec.min}` };
      }
      if (spec.max != null && parsed > spec.max) {
        return { ok: false, error: `max ${spec.max}` };
      }
      return { ok: true, value: parsed };
    }
    case 'enum': {
      const asString = String(raw);
      if (!Array.isArray(spec.options) || !spec.options.includes(asString)) {
        return {
          ok: false,
          error: `must be one of ${(spec.options ?? []).join(', ')}`,
        };
      }
      return { ok: true, value: asString };
    }
    case 'string':
    default: {
      const asString = coerceString(raw);
      if (spec.maxLength != null && asString.length > spec.maxLength) {
        return { ok: false, error: `maxLength ${spec.maxLength}` };
      }
      return { ok: true, value: asString };
    }
  }
}

export interface ConfigValidationError {
  key: string;
  error: string;
}

export type ConfigValidationResult =
  | { ok: true; value: Record<string, boolean | number | string> }
  | { ok: false; errors: ConfigValidationError[] };

/**
 * Validates an incoming config object against the registry.
 *
 * Unknown keys are rejected rather than ignored — that is what stops a typo
 * from writing a flag no code will ever read. Missing keys are simply left out;
 * the default is supplied at read time.
 */
export function validateConfig(input: unknown): ConfigValidationResult {
  const out: Record<string, boolean | number | string> = {};
  const errors: ConfigValidationError[] = [];
  const source =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  for (const [key, raw] of Object.entries(source)) {
    const spec = CONFIG_SCHEMA[key];
    if (!spec) {
      errors.push({ key, error: 'unknown config key' });
      continue;
    }
    const result = coerce(spec, raw);
    if (!result.ok) {
      errors.push({ key, error: result.error });
      continue;
    }
    out[key] = result.value;
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out };
}

/** One entry as the front end consumes it. */
export interface PublicConfigEntry {
  key: string;
  type: ConfigSpecType;
  default: boolean | number | string;
  label: ConfigLabel;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  maxLength?: number;
  help?: string;
}

/**
 * The declaration as sent to the front end so it can render a form.
 *
 * Enum options are stored as bare strings but handed over as `{value,label}`
 * objects, which is what the FE dropdown expects. Non-enum entries omit the
 * field entirely rather than sending `undefined`, because `JSON.stringify`
 * drops undefined keys and the golden diff compares the serialised body — an
 * explicit `options: undefined` would still be absent on the wire, but building
 * the object this way keeps the type honest.
 */
export function publicSchema(): PublicConfigEntry[] {
  return Object.entries(CONFIG_SCHEMA).map(([key, spec]) => {
    const entry: PublicConfigEntry = {
      key,
      type: spec.type,
      default: spec.default,
      label: spec.label,
    };
    if (Array.isArray(spec.options)) {
      entry.options = spec.options.map((option) => ({
        value: option,
        label: String(option),
      }));
    }
    if (spec.min !== undefined) entry.min = spec.min;
    if (spec.max !== undefined) entry.max = spec.max;
    if (spec.maxLength !== undefined) entry.maxLength = spec.maxLength;
    if (spec.help !== undefined) entry.help = spec.help;
    return entry;
  });
}
