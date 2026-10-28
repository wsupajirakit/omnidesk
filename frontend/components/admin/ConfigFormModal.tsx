import React, { useEffect, useState } from 'react';
import { X, Save, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { SystemConfigEntry, SystemConfigFormData } from '../../types';
import { useI18n } from '../../i18n';

interface ConfigFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: SystemConfigFormData) => Promise<void>;
  initialData?: SystemConfigEntry;
}

const DEFAULT_FORM: SystemConfigFormData = {
  key: '',
  value: '',
  flag: 1,
  detail: ''
};

// Settings that change how the backend behaves rather than how it is labelled.
// They are shown so their state is visible, but not editable here — a mistyped
// value would silently change what the system does. Change them deliberately,
// against the database.
const READ_ONLY_KEYS = new Set(['ai_sum_category']);

export const ConfigFormModal: React.FC<ConfigFormModalProps> = ({ isOpen, onClose, onSubmit, initialData }) => {
  const { t } = useI18n();
  const [formData, setFormData] = useState<SystemConfigFormData>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [revealValue, setRevealValue] = useState(false);
  const isReadOnly = !!initialData?.key && READ_ONLY_KEYS.has(initialData.key);

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setRevealValue(false);
    if (initialData) {
      setFormData({
        key: initialData.key,
        // Values are stored untyped, so a config can hold a boolean or a
        // number. The form edits text, and treating a non-string as one threw
        // on save ("value.trim is not a function") rather than reporting a
        // problem the user could act on.
        value: typeof initialData.value === 'string' ? initialData.value : String(initialData.value ?? ''),
        flag: initialData.flag ?? 1,
        detail: initialData.detail || ''
      });
    } else {
      setFormData(DEFAULT_FORM);
    }
  }, [isOpen, initialData]);

  const inputClass = (hasError: boolean, extra: string = '') =>
    `w-full bg-primary-500/10 border rounded-lg px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:ring-2 focus:border-transparent outline-none disabled:opacity-60 disabled:cursor-not-allowed transition-all ${
      hasError ? 'border-red-500 focus:ring-red-500/50' : 'border-primary-500/30 focus:ring-primary-500'
    } ${extra}`;

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};
    if (!formData.key.trim()) nextErrors.key = t('config_form.key_required');
    if (!formData.value.trim()) nextErrors.value = t('config_form.value_required');
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    if (errors[name]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    if (!validate()) return;
    setLoading(true);
    try {
      await onSubmit(formData);
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

  const isSensitiveKey = formData.key === 'EXTERNAL_API_PASSWORD';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-white/45 backdrop-blur transition-opacity">
      <div className="bg-dark-800 border border-dark-700 rounded-xl shadow-2xl w-full max-w-lg my-8 flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-5 border-b border-dark-700 sticky top-0 bg-dark-800 z-10 rounded-t-xl">
          <h3 className="text-xl font-semibold text-slate-900">
            {initialData ? t('config_form.update_title') : t('config_form.create_title')}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto custom-scrollbar flex-1 flex flex-col gap-5">
          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1">{t('config_form.key_label')} <span className="text-red-500">*</span></label>
            <input
              name="key"
              value={formData.key}
              onChange={handleChange}
              disabled={!!initialData}
              placeholder={t('config_form.key_placeholder')}
              className={inputClass(!!errors.key, 'font-mono')}
            />
            <InputError error={errors.key} />
            {initialData && (
              <p className="mt-1 text-xs text-slate-500">{t('config_form.key_immutable_hint')}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1">{t('config_form.value_label')} <span className="text-red-500">*</span></label>
            <div className="relative">
              <input
                type={isSensitiveKey && !revealValue ? 'password' : 'text'}
                name="value"
                value={formData.value}
                onChange={handleChange}
                disabled={isReadOnly}
                placeholder={t('config_form.value_placeholder')}
                className={inputClass(!!errors.value, `pr-12 ${isSensitiveKey ? 'font-mono' : ''}`)}
              />
              {isSensitiveKey && (
                <button
                  type="button"
                  onClick={() => setRevealValue(!revealValue)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-primary-500 transition-colors"
                >
                  {revealValue ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              )}
            </div>
            <InputError error={errors.value} />
            {isReadOnly && (
              <p className="mt-1 text-xs text-slate-500">{t('config_form.read_only_hint')}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1">{t('config_form.detail_label')}</label>
            <textarea
              name="detail"
              value={formData.detail || ''}
              onChange={handleChange}
              disabled={isReadOnly}
              rows={3}
              placeholder={t('config_form.detail_placeholder')}
              className={inputClass(false)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1">{t('config_form.flag_label')}</label>
            <select
              name="flag"
              value={formData.flag}
              onChange={(e) => setFormData(prev => ({ ...prev, flag: parseInt(e.target.value) }))}
              disabled={isReadOnly}
              className={inputClass(false)}
            >
              <option value={1}>{t('config_form.flag_enabled')}</option>
              <option value={0}>{t('config_form.flag_disabled')}</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-dark-700">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-dark-700 transition-colors"
            >
              {t('config_form.cancel')}
            </button>
            {!isReadOnly && (
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 transition-all shadow-lg shadow-primary-500/20 flex items-center gap-2"
            >
              {loading && <Loader2 className="animate-spin" size={16} />}
              <Save size={18} />
              {t('config_form.save')}
            </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
