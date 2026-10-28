import React, { useEffect, useState } from 'react';
import { Save, Loader2, AlertCircle } from 'lucide-react';
// [FEAT-20260810-MODALSHELL] MOVED OUT of this file: the overlay div, the panel div
// and the whole header block (title + X button). They now come from the shared
// `form` variant. MOVED IN: nothing — the <form> body and footer below are untouched.
import { Modal } from '../common/Modal';
// [FEAT-20260816-GROUPSCOPECLONE] the house select-with-search, so this field
// behaves like every other long dropdown in the dashboard.
import { SearchableSelect } from '../common/SearchableSelect';
import { GroupEntry, GroupFormData } from '../../types';
import { useI18n } from '../../i18n';

interface GroupFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * [FEAT-20260816-GROUPSCOPECLONE] the second argument is the group to copy
   * permissions FROM, and is only ever sent when creating. Optional, so every
   * existing caller keeps working unchanged.
   */
  onSubmit: (data: GroupFormData, cloneFromGroupId?: string) => Promise<void>;
  initialData?: GroupEntry;
  /** groups offered in the "copy permissions from" dropdown (create only) */
  cloneSources?: GroupEntry[];
}

const DEFAULT_FORM: GroupFormData = {
  group_name: '',
  description: '',
  status: true
};

export const GroupFormModal: React.FC<GroupFormModalProps> = ({ isOpen, onClose, onSubmit, initialData, cloneSources = [] }) => {
  const { t } = useI18n();
  const [formData, setFormData] = useState<GroupFormData>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // create-only, and reset with the rest of the form below
  const [cloneFrom, setCloneFrom] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    if (initialData) {
      setFormData({
        group_name: initialData.group_name,
        description: initialData.description || '',
        status: Boolean(initialData.status)
      });
    } else {
      setFormData(DEFAULT_FORM);
    }
    setCloneFrom('');
  }, [isOpen, initialData]);

  const inputClass = (hasError: boolean, extra: string = '') =>
    `w-full bg-primary-500/10 border rounded-lg px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:ring-2 focus:border-transparent outline-none disabled:opacity-60 disabled:cursor-not-allowed transition-all ${
      hasError ? 'border-red-500 focus:ring-red-500/50' : 'border-primary-500/30 focus:ring-primary-500'
    } ${extra}`;

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};
    if (!formData.group_name.trim()) nextErrors.group_name = t('group.form_name_required');
    if (!initialData && cloneSources.length > 0 && !cloneFrom.trim()) {
      nextErrors.clone_from = t('group.form_clone_from_required');
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'status' ? value === 'true' : value
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
    if (!validate()) return;
    setLoading(true);
    try {
      await onSubmit(formData, initialData ? undefined : cloneFrom || undefined);
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
    <Modal
      isOpen={isOpen}
      variant="form"
      maxWidth="max-w-lg"
      panelClassName="bg-dark-800 border border-dark-700 rounded-xl shadow-2xl w-full max-w-lg my-auto flex flex-col max-h-[90vh]"
    >
        <Modal.Header
          title={initialData ? t('group.form_update_title') : t('group.form_create_title')}
          onClose={onClose}
          /* the form is long enough that the footer save can be off-screen; no
             cancel here, the X already does that */
          actions={
            <button
              type="submit"
              form="group-form"
              disabled={loading}
              className="ml-auto mr-2 px-4 py-1.5 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 transition-colors flex items-center gap-2 disabled:opacity-60"
            >
              {loading ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
              {t('common.save')}
            </button>
          }
        />

        <form id="group-form" onSubmit={handleSubmit} className="p-6 overflow-y-auto custom-scrollbar flex-1 flex flex-col gap-5">
          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1">
              {t('group.form_name_label')} <span className="text-red-500">*</span>
            </label>
            <input
              name="group_name"
              value={formData.group_name}
              onChange={handleChange}
              placeholder={t('group.form_name_placeholder')}
              className={inputClass(!!errors.group_name)}
            />
            <InputError error={errors.group_name} />
          </div>

          {!initialData && cloneSources.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">
                {t('group_scope.clone_on_create_label')} <span className="text-red-500">*</span>
              </label>
              {/*
                A native <select> cannot be filtered, and a tenant with dozens of
                groups could not find the one they wanted — this is the house
                select-with-search instead.

                ⚠️ It sits HIGH in the form on purpose. At the bottom its panel
                opened into the dialog's own edge and the options were clipped;
                here it has the whole form below it to open into.
              */}
              <SearchableSelect
                value={cloneFrom}
                onChange={(val) => {
                  setCloneFrom(val);
                  if (errors.clone_from) {
                    setErrors(prev => {
                      const next = { ...prev };
                      delete next.clone_from;
                      return next;
                    });
                  }
                }}
                options={cloneSources
                  .filter(group => group._id)
                  .map(group => ({ value: group._id, label: group.group_name }))}
                placeholder={t('group_scope.clone_placeholder') || t('group_scope.clone_none')}
              />
              <InputError error={errors.clone_from} />
              <p className="mt-1 text-xs text-slate-500">{t('group_scope.clone_on_create_hint')}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1">{t('group.form_description_label')}</label>
            <textarea
              name="description"
              value={formData.description || ''}
              onChange={handleChange}
              rows={3}
              placeholder={t('group.form_description_placeholder')}
              className={inputClass(false)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1">{t('group.form_status_label')}</label>
            <select
              name="status"
              value={String(formData.status)}
              onChange={handleChange}
              className={inputClass(false, 'appearance-none')}
            >
              <option value="true">{t('status.active')}</option>
              <option value="false">{t('status.inactive')}</option>
            </select>
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
              {t('common.save')}
            </button>
          </div>
        </form>
    </Modal>
  );
};
