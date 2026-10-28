/* [FEAT-20260815-LINEQUOTA] Fetch one OA's LINE message allowance, on demand.
 * ===========================================================================
 * Owner, 15/08: "กดตรง info icon line oa … ส่ง hook id ไป get ข้อมูล".
 *
 * Fetching starts ONLY when `enabled` turns true — i.e. when the dialog opens.
 * The ⓘ button sits in a panel that renders for every ticket, so fetching on
 * mount would spend a real LINE API call per ticket the operator merely looks
 * at. LINE's quota figures also lag behind reality, so eager loading buys
 * nothing but load.
 *
 * ⚠️ NO CACHE HERE — deliberate. The value the operator wants is "how much is
 *    left right now", and they open this dialog precisely when that matters.
 *    A stale number shown as current is worse than a second of loading. Each
 *    open = one fresh read; the dialog cannot be opened fast enough to matter.
 *
 * ⚠️ The response carries no secret (see HookQuotaResponse) — the channel
 *    access token stays in the backend, which is why this reads a proxied
 *    endpoint instead of calling api.line.me from the browser.
 *
 * revert: delete this file and the QuotaModal that consumes it.
 */
import { useCallback, useEffect, useState } from 'react';
import { webhookService } from '../../../services/hook';
import type { HookQuotaResponse } from '../../../types';
import { translateNow } from '../../../i18n';

export interface HookQuotaState {
  data: HookQuotaResponse | null;
  loading: boolean;
  /** Human-readable failure, already trimmed for display. Null when fine. */
  error: string | null;
  /** Re-read from LINE — wired to the dialog's retry/refresh control. */
  reload: () => void;
}

export function useHookQuota(
  hookId: string | null | undefined,
  enabled: boolean,
): HookQuotaState {
  const [data, setData] = useState<HookQuotaResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !hookId) return;

    // A late response from a previous OA must not overwrite the current one:
    // the operator can close and reopen on a different ticket mid-flight.
    let alive = true;
    setLoading(true);
    setError(null);

    webhookService
      .getHookQuota(hookId)
      .then((res) => {
        if (!alive) return;
        setData(res);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setData(null);
        setError(e instanceof Error ? e.message : translateNow('pageui.hookform.quota_load_failed', 'โหลดโควตาไม่สำเร็จ'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [hookId, enabled, nonce]);

  return { data, loading, error, reload };
}

/**
 * The numbers the dialog draws, derived in one place so the bar and the text
 * can never disagree.
 *
 * `unlimited` is its own state rather than "limit = Infinity": an unlimited
 * plan has no denominator, so there is no percentage to draw and the bar must
 * not be rendered as full or empty. ต้องบอกว่า "ไม่จำกัด" ห้ามโชว์ 0/0.
 */
/** th-TH thousands formatting — one formatter for every place this number shows. */
export const fmt = (n: number): string => n.toLocaleString('th-TH');

export function readQuota(data: HookQuotaResponse | null): {
  unlimited: boolean;
  used: number;
  limit: number | null;
  remaining: number | null;
  percent: number;
} {
  const used = Number(data?.consumption?.totalUsage ?? 0);
  const unlimited = data?.quota?.type === 'none';
  const rawLimit = Number(data?.quota?.value);
  const limit = unlimited || !Number.isFinite(rawLimit) ? null : rawLimit;
  const remaining = data?.remaining ?? null;
  // Clamped: LINE has been observed to report usage above the cap right after
  // a plan change, and a bar wider than its track breaks the layout.
  const percent =
    limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return { unlimited, used: Number.isFinite(used) ? used : 0, limit, remaining, percent };
}
