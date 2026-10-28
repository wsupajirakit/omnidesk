import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { LineQuotaTable } from '../../components/hook/quota/line';
import { getStoredAuth } from '../../services/authStorage';
import { permAllows } from '../../components/common';
import { useI18n } from '../../i18n';

/**
 * ==== [FEAT-20260917-LINEQUOTA-EMBED] Iframe / Standalone Quota View =======
 *
 * Clean shell view for /hook-quota route:
 * - No MegaMenu / Nav header / Sidebar / Footer
 * - Fullscreen responsive container
 * - Permission guard: requires 'hook.manage'
 * - Displays warning message if user lacks permissions
 */

export const LineQuotaEmbed: React.FC = () => {
  const { t } = useI18n();
  const auth = getStoredAuth();

  const isSuperadmin = auth?.role?.name === 'superadmin';
  const hasPermission =
    isSuperadmin || permAllows(auth?.permissions || [], 'hook.manage');

  if (!hasPermission) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center p-6 bg-slate-50 dark:bg-dark-900"
        data-testid="hook-quota-no-permission"
      >
        <div className="max-w-md w-full bg-white dark:bg-dark-800 border border-slate-200 dark:border-dark-700 rounded-2xl p-8 shadow-xl text-center flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center">
            <ShieldAlert size={32} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t('hook_quota.no_permission_title', 'ไม่มีสิทธิ์')}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">
              {t(
                'hook_quota.no_permission_message',
                'คุณไม่มีสิทธิจัดการ hook oa ติดต่อแอดมิน เพื่อขอสิทธิ์',
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-dark-900 p-4 sm:p-6">
      <LineQuotaTable showHeaderCard={true} />
    </div>
  );
};

export default LineQuotaEmbed;
