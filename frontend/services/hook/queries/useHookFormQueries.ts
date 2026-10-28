/**
 * [FEAT-20261027-TANSTACK] Reads of the hook create/edit form.
 *
 * `useHookDetailQuery` (pages/hook/HookFormPage.tsx) — 🔴 NEVER from cache. The
 * result seeds an EDITABLE form: a cached copy could be edited and saved over
 * newer data, and a refetch landing mid-edit would re-seed the form over the
 * operator's typing. `noCache` keeps the old contract — always a fresh fetch,
 * loading state until it lands. แบบฟอร์มแก้ไขห้ามเริ่มจาก cache
 */
import { useAppQuery, QUERY_EXCEPTIONS } from '../../query';
import { webhookService } from '..';
import { hookKeys } from './hookKeys';

export const useHookDetailQuery = (id: string | undefined, enabled = true) =>
  useAppQuery({
    queryKey: hookKeys.detail(String(id ?? '')),
    queryFn: () => webhookService.getHookById(String(id)),
    enabled: enabled && !!id,
    ...QUERY_EXCEPTIONS.noCache,
  });
