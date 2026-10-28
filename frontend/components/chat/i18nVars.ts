/**
 * [FEAT-20261022-I18NTICKETEN] Fill `{name}` slots in a translated template.
 * Used as `withVars(t(key, thaiTemplate), vars)` — `t` is called WITHOUT vars on purpose: the
 * context's default `t` (no I18nProvider mounted, e.g. a unit test) hands back the raw fallback,
 * and the Thai sentence must still read complete there.
 */
export const withVars = (template: string, vars: Record<string, unknown>): string =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
