/* [FEAT-20260814-PROFILESYNC] "sync LINE profile" button (Contact header)
 * ===========================================================================
 * Owner, 14/08: "เพิ่มปุ่ม refresh profile sync line profile ด้วย (วางไว้ข้างๆ)"
 * — one click re-fetches the customer's LINE display name / picture through the
 * EXISTING BE endpoint `POST /api/chat/user/sync-profile` (chat.service.ts
 * :800-885 calls LINE getProfile and updates the member doc). No BE change.
 *
 * Self-contained: owns only its own request state (loading/error). The fresh
 * profile is handed back via `onSynced` — the parent decides how to merge it
 * into its list/selection (this component never touches parent state).
 *
 * ⚠️ Error shows inline as a small ❗ title, auto-clears on the next click —
 *    a failed sync must never break the header or the page (fail-quiet, same
 *    posture as the copy button next to it).
 *
 * revert: delete this file + its use in ContactHeaderInfo.tsx
 *         (marker [FEAT-20260814-PROFILESYNC]).
 */
import React, { useCallback, useState } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { chatService, SyncedProfileData } from '../../services/chat';
import { useI18n, translateNow } from '../../i18n';

interface Props {
  hookId: string | null | undefined;
  lineUserId: string;
  onSynced: (data: SyncedProfileData) => void;
}

export const RefreshProfileButton: React.FC<Props> = ({ hookId, lineUserId, onSynced }) => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = loading || !hookId || !lineUserId;

  const onClick = useCallback(async () => {
    if (disabled || !hookId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await chatService.syncUserProfile({ hookId, lineUserId });
      if (res.data) onSynced(res.data);
    } catch (e: any) {
      console.error('sync line profile failed', e);
      setError(e?.message || translateNow('pageui.contact.sync_failed', 'sync ไม่สำเร็จ'));
    } finally {
      setLoading(false);
    }
  }, [disabled, hookId, lineUserId, onSynced]);

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md border border-gray-300 text-[11px] font-bold text-gray-600 hover:text-blue-600 hover:border-blue-500 transition-colors disabled:opacity-50"
        title={hookId ? t('pageui.contact.sync_tip', 'ดึงชื่อ/รูปโปรไฟล์ล่าสุดจาก LINE') : t('pageui.contact.sync_no_oa', 'ไม่ทราบ OA ของลูกค้าคนนี้')}
      >
        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        sync LINE
      </button>
      {error && (
        <span title={error} className="text-red-500"><AlertCircle size={13} /></span>
      )}
    </span>
  );
};
