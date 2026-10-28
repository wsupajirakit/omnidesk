import React, { useEffect, useState } from 'react';
import { X, Save, Loader2, AlertCircle } from 'lucide-react';
import { SlipVerificationEntry, SlipVerificationFormData } from '../../types';
import { useI18n } from '../../i18n';

interface SlipVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: SlipVerificationFormData) => Promise<void>;
  initialData?: SlipVerificationEntry;
  mode?: 'create' | 'update';
}

const DEFAULT_FORM: SlipVerificationFormData = {
  transaction_date: new Date().toISOString(),
  api_status: 'success',
  trans_ref: '',
  sender_account_no: '',
  sender_account_name: '',
  sender_bank: '',
  receiver_account_no: '',
  receiver_account_name: '',
  receiver_bank: '',
  slip_type: 'QR Transfer',
  amount: 0,
  branch: 'Main Branch',
  raw_response: {},
  metadata: {}
};

export const SlipVerificationModal: React.FC<SlipVerificationModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  mode
}) => {
  const { t } = useI18n();
  const [formData, setFormData] = useState<SlipVerificationFormData>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const resolvedMode = mode ?? (initialData ? 'update' : 'create');

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    if (initialData) {
      setFormData({
        transaction_date: initialData.transaction_date,
        api_status: initialData.api_status,
        trans_ref: initialData.trans_ref,
        sender_account_no: initialData.sender_account_no,
        sender_account_name: initialData.sender_account_name,
        sender_bank: initialData.sender_bank,
        receiver_account_no: initialData.receiver_account_no,
        receiver_account_name: initialData.receiver_account_name,
        receiver_bank: initialData.receiver_bank,
        slip_type: initialData.slip_type,
        amount: initialData.amount,
        branch: initialData.branch,
        raw_response: initialData.raw_response || {},
        metadata: initialData.metadata || {}
      });
    } else {
      setFormData(DEFAULT_FORM);
    }
  }, [isOpen, initialData]);

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};
    if (!formData.trans_ref.trim()) nextErrors.trans_ref = t('slip.form_trans_ref_required');
    if (!formData.sender_account_name.trim()) nextErrors.sender_account_name = t('slip.form_sender_name_required');
    if (formData.amount <= 0) nextErrors.amount = t('slip.form_amount_required');
    
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'amount' ? parseFloat(value) || 0 : value
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
      await onSubmit(formData);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const inputClass = (hasError: boolean) =>
    `w-full bg-dark-700/50 border rounded-lg px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:ring-2 focus:border-transparent outline-none transition-all ${
      hasError ? 'border-red-500 focus:ring-red-500/50' : 'border-dark-600 focus:ring-primary-500'
    }`;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-white/45 backdrop-blur">
      <div className="bg-dark-800 border border-dark-700 rounded-xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-5 border-b border-dark-700 sticky top-0 bg-dark-800 z-10 rounded-t-xl">
          <h3 className="text-xl font-semibold text-slate-900">
            {resolvedMode === 'create' ? t('slip.form_create_title') : t('slip.form_update_title')}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto custom-scrollbar flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">{t('slip.header_transaction_date')}</label>
              <input
                type="datetime-local"
                name="transaction_date"
                value={formData.transaction_date ? new Date(formData.transaction_date).toISOString().slice(0, 16) : ''}
                onChange={(e) => setFormData(prev => ({ ...prev, transaction_date: new Date(e.target.value).toISOString() }))}
                className={inputClass(!!errors.transaction_date)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">{t('slip.header_api_status')}</label>
              <select
                name="api_status"
                value={formData.api_status}
                onChange={handleChange}
                className={inputClass(!!errors.api_status)}
              >
                <option value="success">{t('status.success') || 'Success'}</option>
                <option value="failed">{t('status.failed') || 'Failed'}</option>
                <option value="pending">{t('status.pending') || 'Pending'}</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">{t('slip.header_trans_ref')} *</label>
              <input
                name="trans_ref"
                value={formData.trans_ref}
                onChange={handleChange}
                className={inputClass(!!errors.trans_ref)}
                placeholder="REF123456789"
              />
              {errors.trans_ref && <p className="text-red-500 text-xs mt-1">{errors.trans_ref}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">{t('slip.header_amount')} *</label>
              <input
                type="number"
                step="0.01"
                name="amount"
                value={formData.amount}
                onChange={handleChange}
                className={inputClass(!!errors.amount)}
              />
              {errors.amount && <p className="text-red-500 text-xs mt-1">{errors.amount}</p>}
            </div>

             <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">{t('slip.header_slip_type')}</label>
              <input
                name="slip_type"
                value={formData.slip_type}
                onChange={handleChange}
                className={inputClass(false)}
                placeholder="QR Transfer"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">{t('slip.header_branch')}</label>
              <input
                name="branch"
                value={formData.branch}
                onChange={handleChange}
                className={inputClass(false)}
                placeholder="Main Branch"
              />
            </div>

            <div className="lg:col-span-3 h-px bg-dark-700 my-2" />

            {/* Sender */}
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">{t('slip.header_sender_name')} *</label>
              <input
                name="sender_account_name"
                value={formData.sender_account_name}
                onChange={handleChange}
                className={inputClass(!!errors.sender_account_name)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">{t('slip.header_sender_account_no')}</label>
              <input
                name="sender_account_no"
                value={formData.sender_account_no}
                onChange={handleChange}
                className={inputClass(false)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">{t('slip.header_sender_bank')}</label>
              <input
                name="sender_bank"
                value={formData.sender_bank}
                onChange={handleChange}
                className={inputClass(false)}
              />
            </div>

            {/* Receiver */}
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">{t('slip.header_receiver_name')}</label>
              <input
                name="receiver_account_name"
                value={formData.receiver_account_name}
                onChange={handleChange}
                className={inputClass(false)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">{t('slip.header_receiver_account_no')}</label>
              <input
                name="receiver_account_no"
                value={formData.receiver_account_no}
                onChange={handleChange}
                className={inputClass(false)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">{t('slip.header_receiver_bank')}</label>
              <input
                name="receiver_bank"
                value={formData.receiver_bank}
                onChange={handleChange}
                className={inputClass(false)}
              />
            </div>

            <div className="lg:col-span-3">
              <label className="block text-sm font-medium text-slate-500 mb-1">{t('slip.form_metadata_reason')}</label>
              <textarea
                name="metadata_reason"
                value={formData.metadata?.reason || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, metadata: { ...prev.metadata, reason: e.target.value } }))}
                className={inputClass(false)}
                rows={3}
                placeholder="Reason for manual update..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-6 mt-6 border-t border-dark-700">
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
      </div>
    </div>
  );
};
