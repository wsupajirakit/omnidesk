import React from 'react';
import { X, Calendar, Hash, FileText, Copy, Check } from 'lucide-react';
import { Member } from '../../types';
import { useI18n } from '../../i18n';
import { channelOf } from '../../config/channelRegistry';
import { copyText } from '../../utils/copyText';

interface MemberProfileModalProps {
  isOpen: boolean;
  user: Member | null;
  externalData?: any;
  onClose: () => void;
  channelType?: string; // plan peppy A1.5 — dynamic account label; defaults to LINE
}

export const MemberProfileModal: React.FC<MemberProfileModalProps> = ({ isOpen, user, externalData, onClose, channelType }) => {
  const { t } = useI18n();
  const [copied, setCopied] = React.useState(false);

  /* [FIX-20260830-COPYHTTP2] `utils/copyText`, never `navigator.clipboard`
     directly: the Clipboard API exists only in a SECURE CONTEXT, and this
     dashboard is served over plain http — the call was a silent no-op while
     the success UI fired anyway. copyText falls back to execCommand and
     returns whether the copy really happened. */
  const handleCopy = async () => {
    if (!(await copyText(user?.line_user_id || ''))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen || !user) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-white/45 backdrop-blur-sm transition-opacity animate-fade-in font-sans">
      <div
        className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-xl transform transition-all scale-100 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header/Cover */}
        <div className="h-28 bg-gradient-to-br from-primary-600 via-primary-500 to-emerald-400 relative">
           <button
             onClick={onClose}
             className="absolute top-4 right-4 p-2.5 rounded-full bg-black/10 hover:bg-black/30 text-white transition-all backdrop-blur-md border border-white/10"
           >
            <X size={20} />
          </button>
        </div>

        {/* Profile Content */}
        <div className="px-8 pb-8 pt-0 -mt-14 flex flex-col items-center">
          <div className="relative group">
            <div className="absolute -inset-1.5 bg-gradient-to-r from-primary-500 to-emerald-500 rounded-full blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>
            <img
              src={user.picture_url || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'}
              alt={user.display_name}
              className="relative w-28 h-28 rounded-full border-4 border-white shadow-xl object-cover bg-slate-50"
            />
          </div>

          <div className="mt-5 text-center px-4 w-full">
            <h3 className="text-2xl font-bold text-slate-800 leading-tight truncate">
              {externalData?.customer?.customer_name || user.display_name}
            </h3>
            <p className="text-sm text-emerald-500 font-bold mt-1 shadow-sm px-2 py-0.5 rounded-lg bg-emerald-50 inline-block ring-1 ring-emerald-100">
               {channelOf(channelType).label} Account: {user.display_name}
            </p>

            <div className="mt-4 flex flex-col items-center gap-2">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-slate-50 border border-slate-200 text-slate-500 transition-all hover:border-primary-200 group/id">
                    <Hash size={12} className="text-slate-300 group-hover/id:text-primary-400" />
                    <span className="text-[11px] font-mono select-all tracking-wider">{user.line_user_id}</span>
                    <button
                      onClick={handleCopy}
                      className={`ml-1 p-1.5 rounded-lg transition-all active:scale-90 flex items-center gap-1.5 ${
                        copied ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100' : 'hover:bg-white hover:shadow-sm text-slate-300 hover:text-primary-500'
                      }`}
                      title={copied ? 'Copied' : 'Copy ID'}
                    >
                      {copied ? (
                        <>
                          <Check size={13} className="animate-in zoom-in duration-300" />
                          <span className="text-[10px] font-bold">Copied!</span>
                        </>
                      ) : (
                        <Copy size={13} />
                      )}
                    </button>
                </div>
            </div>
          </div>

          <div className="w-full mt-8 grid grid-cols-2 gap-4">
             <ProfileInfoItem
              icon={<Calendar size={18} className="text-emerald-500" />}
              label={t('profile.created_at') || 'Joined'}
              value={user.created_at ? new Date(user.created_at).toLocaleDateString('th-TH') : '-'}
            />
             <ProfileInfoItem
              icon={<Activity size={18} className="text-amber-500" />}
              label={t('profile.last_sync') || 'Last Sync'}
              value={user.last_synced_at ? new Date(user.last_synced_at).toLocaleDateString('th-TH') : '-'}
            />
          </div>

          {externalData && (
            <div className="w-full mt-6 space-y-2">
               <h4 className="text-[10px] uppercase font-bold tracking-widest text-slate-400 flex items-center gap-2">
                 <FileText size={12} /> External Data
               </h4>
               <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-inner">
                 <pre className="text-[11px] text-emerald-400 font-mono overflow-auto max-h-48 custom-scrollbar">
                   {JSON.stringify(externalData, null, 2)}
                 </pre>
               </div>
            </div>
          )}

          <div className="w-full mt-8">
            <button
              onClick={onClose}
              className="w-full py-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold transition-all shadow-lg active:scale-[0.98]"
            >
              {t('common.close') || 'Close Profile'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ProfileInfoItem: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex flex-col gap-2 p-4 rounded-2xl bg-dark-900/40 border border-dark-700/50 hover:bg-dark-800 transition-colors group">
    <div className="flex items-center gap-2.5 text-slate-500 group-hover:text-primary-500 transition-colors">
      {icon}
      <span className="text-[10px] uppercase font-bold tracking-widest">{label}</span>
    </div>
    <p className="text-sm text-slate-700 font-medium break-words leading-relaxed pl-7">{value}</p>
  </div>
);

const Activity: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = "" }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}
  >
    <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
  </svg>
);
