/**
 * [FIX-20261014-CUSTOMCIRCUIT] The ONE spelling of a custom-tool "breaker is open" answer.
 *
 * `CustomToolService._request` writes it; the webhook's profile check reads it. Both sides
 * used to carry their own idea of the text (the reader knew only the legacy external-API
 * wording), so a custom tool's open breaker was reported as a failing partner. Defining the
 * message and its test together is what keeps the two from drifting again.
 *
 * Pure. revert: inline the template back into `_request`, drop the reader's `||` clause in
 * `room-bootstrap/combined-profile.ts`, delete this file and its barrel line.
 */
const CIRCUIT_OPEN_PREFIX = 'circuit_open:';

/** The status `_request` answers with while the breaker is open. */
export const CIRCUIT_OPEN_STATUS = 503;

/** What `_request` puts in `data.message` while the breaker is open. */
export function customToolCircuitOpenMessage(endpointKey: unknown): string {
  return `${CIRCUIT_OPEN_PREFIX} endpoint "${String(endpointKey)}" temporarily suspended`;
}

/** Is this combined-data block the breaker speaking, rather than the partner? */
export function isCustomToolCircuitOpen(block: unknown): boolean {
  const b = block as { status?: unknown; data?: { message?: unknown } } | null;
  const msg = b?.data?.message;
  return (
    b?.status === CIRCUIT_OPEN_STATUS &&
    typeof msg === 'string' &&
    msg.startsWith(CIRCUIT_OPEN_PREFIX)
  );
}
