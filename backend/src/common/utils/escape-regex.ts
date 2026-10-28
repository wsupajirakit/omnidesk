/**
 * Escapes regex metacharacters from user input string before creating a new RegExp.
 * Prevents regex injection and ReDoS (pattern backtracking).
 */
export function escapeRegex(str: string | null | undefined): string {
  return String(str ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
