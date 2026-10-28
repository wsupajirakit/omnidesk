import React from 'react';
import { X, Calendar, User, CreditCard, Hash, Info, FileText, FileJson } from 'lucide-react';
import { SlipVerificationEntry } from '../../types';
import { useI18n } from '../../i18n';
import { API_BASE_URL } from '../../services/apiClient';
import { slipVerificationService } from '../../services/finance';
import { slipCustomerRows } from './slipExternalFields';

interface SlipDetailModalProps {
  isOpen: boolean;
  slip: SlipVerificationEntry | null;
  onClose: () => void;
  onPreviewJson?: (data: any) => void;
}

export const SlipDetailModal: React.FC<SlipDetailModalProps> = ({ isOpen, slip, onClose, onPreviewJson }) => {
  const { t } = useI18n();

  // The list endpoint returns lightweight customer info (from Member) for speed.
  // When the detail modal opens, fetch the full/fresh external profile by id.
  const [fetchedExternal, setFetchedExternal] = React.useState<any>(null);
  React.useEffect(() => {
    if (!isOpen || !slip?.id) {
      setFetchedExternal(null);
      return;
    }
    let alive = true;
    slipVerificationService
      .getSlip(slip.id)
      .then((res) => {
        if (alive && res?.data?.external_data) setFetchedExternal(res.data.external_data);
      })
      .catch(() => {
        /* keep the lightweight external_data from the list row as fallback */
      });
    return () => {
      alive = false;
    };
  }, [isOpen, slip?.id]);

  if (!isOpen || !slip) return null;

  // Prefer the freshly-fetched full profile; fall back to the list row's light copy.
  const externalData = fetchedExternal ?? slip.external_data;
  const customerRows = slipCustomerRows(externalData);

  const isSlipNotFound = () => {
    const error = slip.callback_response?.['1']?.data?.debug?.body?.slip_check_raw_response?.error;
    return error?.code === 'SLIP_NOT_FOUND';
  };

  const formatDate = (dateString?: string) => {
    if (!dateString || isSlipNotFound()) return '-';
    try {
      return new Date(dateString).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).replace(',', '');
    } catch {
      return dateString;
    }
  };

  const getCallbackDetail = () => {
    if (!slip.callback_response) return null;
    
    // Support both the "1" indexed structure and potential direct structure
    const body = slip.callback_response['1']?.data?.debug?.body || 
                 slip.callback_response.data?.debug?.body ||
                 slip.callback_response.body;
                 
    if (!body) return null;
    
    const detail = body.detail;
    const condition = body.condition;
    
    if (!detail && !condition) return null;
    return [detail, condition].filter(Boolean).join(' ');
  };

  const combinedDetail = getCallbackDetail();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-white/45 backdrop-blur-sm transition-opacity animate-fade-in font-sans">
      <div 
        className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col transform transition-all scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-primary-100 text-primary-600">
              <FileText size={24} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-800">Slip Details</h3>
              <p className="text-xs text-slate-400 font-medium tracking-widest uppercase">TransRef : {slip.trans_ref}</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all border border-transparent hover:border-slate-200"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            {/* Left Column: Image and Summary */}
            <div className="space-y-8">
              <div className="relative group">
                <div className="absolute -inset-1.5 bg-gradient-to-r from-primary-500/20 to-emerald-500/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition duration-1000"></div>
                <div className="relative rounded-2xl overflow-hidden border border-slate-200 shadow-lg bg-slate-50">
                   {slip.internal_content_id?.image_url ? (
                      <img 
                        src={slip.internal_content_id.image_url.startsWith('http') 
                          ? slip.internal_content_id.image_url 
                          : `${API_BASE_URL}${slip.internal_content_id.image_url}`}
                        alt="Slip"
                        className="w-full h-auto object-contain max-h-[400px]"
                      />
                    ) : (
                      <div className="h-64 flex items-center justify-center text-slate-300 italic">No image available</div>
                    )}
                </div>
              </div>

              <div className="p-6 rounded-3xl bg-slate-50 border border-slate-100 space-y-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Info size={14} /> Basic Information
                </h4>
                <div className="grid grid-cols-1 gap-4">
                  <DetailItem label="Transaction date" value={formatDate(slip.transaction_date)} icon={<Calendar size={14}/>} />
                  <DetailItem label="Created at" value={formatDate(slip.created_at)} icon={<Calendar size={14}/>} />
                  <DetailItem label="Status" value={slip.api_status} icon={<Info size={14}/>} status={slip.api_status} />
                  <DetailItem label="Amount" value={`${slip.amount?.toLocaleString() || '0'} THB`} icon={<CreditCard size={14}/>} highlight />
                </div>
              </div>

              {/* Account Info - Now on Left */}
              <div className="p-6 rounded-3xl bg-indigo-50/30 border border-indigo-100/50 space-y-4">
                 <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                   <User size={14} className="text-indigo-500" /> Account Info
                 </h4>
                 <div className="space-y-3">
                   <DetailRow label="Member Name" value={slip.line_user?.display_name} />
                   {/* [FIX-20261014-SLIPDETAILNEST] top level OR under .data — slipExternalFields.ts */}
                   <DetailRow label="Customer Name" value={customerRows.name} />
                   <DetailRow label="Customer Number" value={customerRows.number} />
                   <DetailRow label="Contract Number" value={customerRows.contract} />
                   <DetailRow label="Tel" value={customerRows.tel} />
                 </div>
              </div>
            </div>

            {/* Right Column: Transaction Details */}
            <div className="space-y-8">
              {/* Sender & Receiver Info */}
              <div className="space-y-6">
                 <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <User size={14} className="text-blue-500" /> {t('pageui.common.slip_sender_info', 'Sender Information (ในสลิป)')}
                    </h4>
                    <div className="p-5 rounded-2xl border border-slate-100 bg-blue-50/30 space-y-3">
                      <DetailRow label="Name" value={slip.sender_account_name} />
                      <DetailRow label="Account No" value={slip.sender_account_no} />
                      <DetailRow label="Bank" value={slip.sender_bank} />
                    </div>
                 </div>

                 <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <User size={14} className="text-emerald-500" /> Receiver Information
                    </h4>
                    <div className="p-5 rounded-2xl border border-slate-100 bg-emerald-50/30 space-y-3">
                      <DetailRow label="Name" value={slip.receiver_account_name} />
                      <DetailRow label="Account No" value={slip.receiver_account_no} />
                      <DetailRow label="Bank" value={slip.receiver_bank} />
                    </div>
                 </div>

                 <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                       <Hash size={14} className="text-purple-500" /> Info
                    </h4>
                     <div className="p-5 space-y-3 border border-slate-100 rounded-2xl bg-purple-50/30">
                        <DetailRow label="TransRef" value={slip.trans_ref} />
                        <DetailRow label="Member User ID" value={slip.line_user?.line_user_id} />
                        {combinedDetail && (
                          <div className="pt-2 mt-2 border-t border-purple-100/50">
                            <div className="mb-1 text-xs font-bold text-purple-400 uppercase tracking-wider">Detail</div>
                            <div className="text-sm font-semibold text-slate-700 leading-relaxed">{combinedDetail}</div>
                          </div>
                        )}
                     </div>
                 </div>
              </div>
            </div>
          </div>

          {/* External Data - Full Width */}
          {externalData && (
            <div className="mt-8 pt-8 border-t border-slate-100">
               <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                 <User size={14} className="text-blue-500" /> External User Data
               </h4>
               <pre className="text-[11px] p-6 bg-slate-50 text-slate-800 rounded-2xl overflow-x-auto custom-scrollbar max-h-48 shadow-inner border border-slate-100 font-mono">
                 {JSON.stringify(externalData, null, 2)}
               </pre>
            </div>
          )}

          {/* Callback Response - Full Width */}
          {slip.callback_response && (
            <div className="mt-8 pt-8 border-t border-slate-100">
               <div className="flex items-center justify-between mb-4">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <FileJson size={14} className="text-emerald-500" /> Callback Response
                  </h4>
                  {onPreviewJson && (
                    <button
                      onClick={() => onPreviewJson(slip.callback_response)}
                      className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100 transition-colors"
                    >
                      Full Preview
                    </button>
                  )}
               </div>
               <pre className="text-[11px] p-6 bg-slate-50 text-slate-800 rounded-2xl overflow-x-auto custom-scrollbar max-h-48 shadow-inner border border-slate-100 font-mono">
                 {JSON.stringify(slip.callback_response, null, 2)}
               </pre>
            </div>
          )}

          {/* Raw Response - Full Width */}
          {(slip.raw_content || slip.raw_response) && (
            <div className="mt-12 pt-8 border-t border-slate-100 font-sans">
               <div className="flex items-center justify-between mb-4">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <FileText size={14} /> Raw API Response
                  </h4>
                  {onPreviewJson && (
                    <button
                      onClick={() => onPreviewJson(slip.raw_content || slip.raw_response)}
                      className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-100 transition-colors"
                    >
                      Full Preview
                    </button>
                  )}
               </div>
               <pre className="text-[11px] p-6 bg-slate-900 text-emerald-400 rounded-2xl overflow-x-auto custom-scrollbar max-h-72 shadow-inner border border-slate-800 leading-relaxed font-mono">
                 {JSON.stringify(slip.raw_content || slip.raw_response, null, 2)}
               </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 py-6 border-t border-slate-100 bg-slate-50/50 flex justify-end">
           <button 
             onClick={onClose}
             className="px-8 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold shadow-xl shadow-slate-900/10 transition-all transform active:scale-95"
           >
             Close Details
           </button>
        </div>
      </div>
    </div>
  );
};

const DetailItem: React.FC<{ label: string; value: string; icon: React.ReactNode; highlight?: boolean; status?: string }> = ({ label, value, icon, highlight, status }) => (
  <div className="flex items-start gap-3">
    <div className="mt-1 text-slate-400">{icon}</div>
    <div>
      <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">{label}</div>
      <div className={`text-sm font-semibold ${
        highlight ? 'text-primary-600 text-lg' : 
        status === 'success' ? 'text-emerald-600' : 
        status === 'failed' ? 'text-red-500' : 
        'text-slate-700'
      }`}>
        {value || '-'}
      </div>
    </div>
  </div>
);

const DetailRow: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div className="flex justify-between items-center text-sm">
    <span className="text-slate-400">{label}</span>
    <span className="font-semibold text-slate-700">{value || '-'}</span>
  </div>
);
