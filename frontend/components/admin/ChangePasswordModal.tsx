import React, { useEffect, useState } from 'react';
import { Save, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useI18n } from '../../i18n';
// [FEAT-20260810-MODALSHELL] MOVED OUT of this file: the overlay div, the panel div
// and the whole header block (title + X button). They now come from the shared
// `form` variant. MOVED IN: nothing — the <form> body and footer below are untouched.
import { Modal } from '../common/Modal';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: { old_password: string; password: string }) => Promise<void>;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const { t } = useI18n();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setErrors({});
    setShowOld(false);
    setShowNew(false);
    setShowConfirm(false);
  }, [isOpen]);

  const inputClass = (hasError: boolean, extra: string = '') =>
    `w-full bg-primary-500/10 border rounded-lg px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:ring-2 focus:border-transparent outline-none disabled:opacity-60 disabled:cursor-not-allowed transition-all ${
      hasError ? 'border-red-500 focus:ring-red-500/50' : 'border-primary-500/30 focus:ring-primary-500'
    } ${extra}`;

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    if (!oldPassword.trim()) nextErrors.old_password = t('change_password.old_required');
    if (!newPassword.trim()) nextErrors.password = t('change_password.new_required');
    if (!confirmPassword.trim()) nextErrors.confirm = t('change_password.confirm_required');
    if (newPassword && confirmPassword && newPassword !== confirmPassword) {
      nextErrors.confirm = t('change_password.mismatch');
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      await onSubmit({ old_password: oldPassword.trim(), password: newPassword.trim() });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const InputError = ({ error }: { error?: string }) => {
    if (!error) return null;
    return (
      <div className="flex items-center gap-1 mt-1 text-red-400 text-xs animation-fade-in">
        <AlertCircle size={12} />
        <span>{error}</span>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} variant="form" maxWidth="max-w-lg">
        <Modal.Header title={t('change_password.title')} onClose={onClose} />

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto custom-scrollbar flex-1 flex flex-col gap-5">
          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1">{t('change_password.old_label')}</label>
            <div className="relative">
              <input
                type={showOld ? 'text' : 'password'}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className={inputClass(!!errors.old_password, 'pr-10')}
                placeholder={t('change_password.old_placeholder')}
              />
              <button
                type="button"
                onClick={() => setShowOld(prev => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
                aria-label={showOld ? t('change_password.hide') : t('change_password.show')}
              >
                {showOld ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <InputError error={errors.old_password} />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1">{t('change_password.new_label')}</label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass(!!errors.password, 'pr-10')}
                placeholder={t('change_password.new_placeholder')}
              />
              <button
                type="button"
                onClick={() => setShowNew(prev => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
                aria-label={showNew ? t('change_password.hide') : t('change_password.show')}
              >
                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <InputError error={errors.password} />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1">{t('change_password.confirm_label')}</label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass(!!errors.confirm, 'pr-10')}
                placeholder={t('change_password.confirm_placeholder')}
              />
              <button
                type="button"
                onClick={() => setShowConfirm(prev => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
                aria-label={showConfirm ? t('change_password.hide') : t('change_password.show')}
              >
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <InputError error={errors.confirm} />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-dark-700">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-dark-700 transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 transition-all shadow-lg shadow-primary-500/20 flex items-center gap-2"
            >
              {loading && <Loader2 className="animate-spin" size={16} />}
              <Save size={18} />
              {t('change_password.save')}
            </button>
          </div>
        </form>
    </Modal>
  );
};
