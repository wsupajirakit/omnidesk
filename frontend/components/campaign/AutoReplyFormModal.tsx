import React, { useEffect, useMemo, useState } from 'react';
import { Save, Loader2, AlertCircle, MessageSquare, Image as ImageIcon, Layout } from 'lucide-react';
// [FEAT-20260810-MODALSHELL] MOVED OUT of this file: the overlay div, the panel div
// and the whole header block (title + X button). They now come from the shared
// `form` variant. MOVED IN: nothing — the <form> body below is untouched.
import { Modal } from '../common/Modal';
import { AutoReplyEntry, AutoReplyFormData, HookData, ReplyMatchType } from '../../types';
import { useI18n } from '../../i18n';
import { webhookService } from '../../services/hook';
import { fetchVisibleGroups } from '../../services/admin';

interface AutoReplyFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: AutoReplyFormData) => Promise<void>;
  initialData?: AutoReplyEntry;
  mode?: 'create' | 'update' | 'view';
}

const DEFAULT_FORM: AutoReplyFormData = {
  name: '',
  hook_ids: [],
  assign_group: null,
  keyword: '',
  match_type: 'contains',
  response: {
    type: 'text',
    text: ''
  },
  priority: 0,
  active: true,
  mode: 'reply'
};

export const AutoReplyFormModal: React.FC<AutoReplyFormModalProps> = ({ isOpen, onClose, onSubmit, initialData, mode }) => {
  const { t } = useI18n();
  const [formData, setFormData] = useState<AutoReplyFormData>(DEFAULT_FORM);
  const [hooks, setHooks] = useState<HookData[]>([]);
  const [groups, setGroups] = useState<{ _id: string; group_name: string }[]>([]);
  const [hooksLoading, setHooksLoading] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [flexText, setFlexText] = useState('');
  const [isHooksOpen, setIsHooksOpen] = useState(false);
  const resolvedMode = mode ?? (initialData ? 'update' : 'create');
  const isReadOnly = resolvedMode === 'view';

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setIsHooksOpen(false);
    if (initialData) {
      setFormData({
        name: initialData.name || '',
        hook_ids: initialData.hook_ids || [],
        assign_group: initialData.assign_group ?? null,
        keyword: initialData.keyword || '',
        mode: initialData.mode ?? 'reply',
        match_type: initialData.match_type || 'contains',
        response: initialData.response || { type: 'text', text: '' },
        priority: initialData.priority ?? 0,
        active: initialData.active ?? true
      });
      if (initialData.response?.type === 'flex') {
        const raw = initialData.response.flex_json;
        setFlexText(typeof raw === 'string' ? raw : JSON.stringify(raw ?? {}, null, 2));
      } else {
        setFlexText('');
      }
    } else {
      setFormData(DEFAULT_FORM);
      setFlexText('');
    }
  }, [isOpen, initialData]);

  useEffect(() => {
    if (!isOpen) return;
    let isActive = true;
    const groupId = formData.assign_group ?? '';
    if (!groupId) {
      setHooks([]);
      setHooksLoading(false);
      return () => {
        isActive = false;
      };
    }
    setHooksLoading(true);
    webhookService
      .getHooksByGroup(groupId)
      .then(res => {
        if (!isActive) return;
        setHooks(res || []);
      })
      .catch(err => {
        if (!isActive) return;
        console.error('Failed to load hooks', err);
        setHooks([]);
      })
      .finally(() => {
        if (!isActive) return;
        setHooksLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [isOpen, formData.assign_group]);

  useEffect(() => {
    if (!isOpen) return;
    let isActive = true;
    // Same rule everywhere: super → all active groups; others → active ∩ their
    // sector groups. Shared helper, no per-form logic to drift.
    setGroupsLoading(true);
    fetchVisibleGroups()
      .then(list => { if (isActive) setGroups(list); })
      .catch(err => { console.error('Failed to load groups', err); if (isActive) setGroups([]); })
      .finally(() => { if (isActive) setGroupsLoading(false); });
    return () => { isActive = false; };
  }, [isOpen]);

  const inputClass = (hasError: boolean, extra: string = '') =>
    `w-full bg-primary-500/10 border rounded-lg px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:ring-2 focus:border-transparent outline-none disabled:opacity-60 disabled:cursor-not-allowed transition-all ${
      hasError ? 'border-red-500 focus:ring-red-500/50' : 'border-primary-500/30 focus:ring-primary-500'
    } ${extra}`;

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};
    if (!formData.name.trim()) nextErrors.name = t('auto_reply.form_name_required');
    if (!formData.keyword.trim()) nextErrors.keyword = t('auto_reply.form_keyword_required');
    if (!formData.assign_group) nextErrors.assign_group = t('auto_reply.form_assign_group_required');
    if (!formData.hook_ids.length) nextErrors.hook_ids = t('auto_reply.form_hooks_required');
    if (!formData.match_type) nextErrors.match_type = t('auto_reply.form_match_required');

    const type = formData.response.type;
    if (type === 'text') {
      if (!formData.response.text?.trim()) nextErrors.response = t('auto_reply.form_response_required');
    } else if (type === 'image') {
      const url = formData.response.image_url?.trim() || '';
      if (!url) nextErrors.response = t('auto_reply.form_response_required');
      if (url && !/^https:\/\//i.test(url)) nextErrors.response = t('auto_reply.form_image_https');
    } else if (type === 'flex') {
      const raw = flexText.trim();
      if (!raw) {
        nextErrors.response = t('auto_reply.form_response_required');
      } else {
        try {
          JSON.parse(raw);
        } catch {
          nextErrors.response = t('auto_reply.form_flex_invalid');
        }
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const toggleHook = (id: string) => {
    if (isReadOnly) return;
    setFormData(prev => {
      const exists = prev.hook_ids.includes(id);
      return { ...prev, hook_ids: exists ? prev.hook_ids.filter(h => h !== id) : [...prev.hook_ids, id] };
    });
    if (errors.hook_ids) {
      setErrors(prev => {
        const next = { ...prev };
        delete next.hook_ids;
        return next;
      });
    }
  };

  const handleMatchChange = (value: ReplyMatchType) => {
    if (isReadOnly) return;
    setFormData(prev => ({ ...prev, match_type: value }));
    if (errors.match_type) {
      setErrors(prev => {
        const next = { ...prev };
        delete next.match_type;
        return next;
      });
    }
  };

  const handleResponseTypeChange = (type: 'text' | 'image' | 'flex') => {
    if (isReadOnly) return;
    setFormData(prev => ({
      ...prev,
      response: {
        type,
        text: type === 'text' ? prev.response.text ?? '' : undefined,
        image_url: type === 'image' ? prev.response.image_url ?? '' : undefined,
        flex_json: type === 'flex' ? prev.response.flex_json ?? {} : undefined
      }
    }));
    if (type !== 'flex') setFlexText('');
    if (errors.response) {
      setErrors(prev => {
        const next = { ...prev };
        delete next.response;
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
      const payload: AutoReplyFormData = {
        ...formData,
        assign_group: formData.assign_group ?? null,
        response: {
          ...formData.response,
          flex_json: formData.response.type === 'flex' ? JSON.parse(flexText) : formData.response.flex_json
        }
      };
      await onSubmit(payload);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const selectedHookLabels = useMemo(() => {
    if (!formData.hook_ids.length) return '';
    const map = new Map(hooks.map(h => [h._id, h.line_oa_name]));
    const labels = formData.hook_ids.map(id => map.get(id)).filter(Boolean) as string[];
    if (labels.length <= 2) return labels.join(', ');
    return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
  }, [formData.hook_ids, hooks]);

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
    <Modal isOpen={isOpen} variant="form" maxWidth="max-w-3xl">
        <Modal.Header
          title={
            resolvedMode === 'view'
              ? t('auto_reply.form_view_title')
              : resolvedMode === 'update'
                ? t('auto_reply.form_update_title')
                : t('auto_reply.form_create_title')
          }
          onClose={onClose}
        />

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto custom-scrollbar flex-1 flex flex-col gap-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('auto_reply.form_name_label')} <span className="text-red-500">*</span>
              </label>
              <input
                name="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                disabled={isReadOnly}
                className={inputClass(!!errors.name)}
                placeholder={t('auto_reply.form_name_placeholder')}
              />
              <InputError error={errors.name} />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('auto_reply.form_keyword_label')} <span className="text-red-500">*</span>
              </label>
              <input
                name="keyword"
                value={formData.keyword}
                onChange={(e) => setFormData(prev => ({ ...prev, keyword: e.target.value }))}
                disabled={isReadOnly}
                className={inputClass(!!errors.keyword)}
                placeholder={t('auto_reply.form_keyword_placeholder')}
              />
              <InputError error={errors.keyword} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t('auto_reply.form_match_label')} <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(['exact', 'contains', 'regex'] as ReplyMatchType[]).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleMatchChange(type)}
                  disabled={isReadOnly}
                  className={`rounded-xl border px-4 py-3 text-left transition-all ${
                    formData.match_type === type
                      ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300'
                      : 'border-dark-700 text-slate-600 hover:border-primary-500/40'
                  }`}
                >
                  <p className="text-sm font-semibold">{t(`auto_reply.match_${type}`)}</p>
                  <p className="text-xs text-slate-700">{t(`auto_reply.match_${type}_hint`)}</p>
                </button>
              ))}
            </div>
            <InputError error={errors.match_type} />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t('auto_reply.form_mode_label')}
            </label>
            <select
              value={formData.mode ?? 'reply'}
              onChange={(e) => setFormData(prev => ({ ...prev, mode: e.target.value as 'push' | 'reply' | 'single_reply' }))}
              disabled={isReadOnly}
              className={inputClass(false, 'appearance-none')}
            >
              <option value="push">{t('auto_reply.form_mode_push')}</option>
              <option value="reply">{t('auto_reply.form_mode_reply')}</option>
              <option value="single_reply">{t('auto_reply.form_mode_single_reply')}</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t('auto_reply.form_assign_group_label')}
            </label>
            <select
              value={formData.assign_group ?? ''}
              onChange={(e) =>
                setFormData(prev => ({
                  ...prev,
                  assign_group: e.target.value || null,
                  hook_ids: []
                }))
              }
              disabled={isReadOnly || groupsLoading}
              className={inputClass(false, 'appearance-none')}
            >
              <option value="">
                {groupsLoading ? t('auto_reply.form_assign_group_loading') : t('auto_reply.form_assign_group_placeholder')}
              </option>
              {groups.map(group => (
                <option key={group._id} value={group._id}>
                  {group.group_name}
                </option>
              ))}
            </select>
            {!groupsLoading && groups.length === 0 && (
              <p className="text-xs text-slate-700">{t('auto_reply.form_assign_group_empty')}</p>
            )}
            <InputError error={errors.assign_group} />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t('auto_reply.form_hooks_label')} <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  if (isReadOnly) return;
                  setIsHooksOpen(open => !open);
                }}
                disabled={isReadOnly || !formData.assign_group}
                className={inputClass(!!errors.hook_ids, 'flex items-center justify-between gap-2')}
              >
                <span className="text-sm text-slate-600">
                  {selectedHookLabels || t('auto_reply.form_hooks_placeholder')}
                </span>
                <span className="text-xs text-slate-700">{formData.hook_ids.length}</span>
              </button>
              {isHooksOpen && (
                <div className="absolute z-20 mt-1 w-full rounded-lg border border-dark-700 bg-dark-800 shadow-xl max-h-48 overflow-y-auto custom-scrollbar p-3 flex flex-col gap-2">
                  <div className="flex justify-end pb-2 border-b border-dark-700">
                    <button
                      type="button"
                      onClick={() => setIsHooksOpen(false)}
                      className="px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-xs font-semibold text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/20 transition-colors"
                    >
                      {t('common.ok')}
                    </button>
                  </div>
                  {hooksLoading ? (
                    <div className="text-xs text-slate-700">{t('auto_reply.form_hooks_loading')}</div>
                  ) : hooks.length === 0 ? (
                    <div className="text-xs text-slate-700">{t('auto_reply.form_hooks_empty')}</div>
                  ) : (
                    hooks.map(hook => (
                      <label key={hook._id} className="flex items-center gap-2 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={formData.hook_ids.includes(hook._id)}
                          onChange={() => toggleHook(hook._id)}
                          disabled={isReadOnly}
                          className="accent-primary-500"
                        />
                        <span>{hook.line_oa_name}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
            <InputError error={errors.hook_ids} />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t('auto_reply.form_response_type_label')} <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleResponseTypeChange('text')}
                disabled={isReadOnly}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all ${
                  formData.response.type === 'text'
                    ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300'
                    : 'border-dark-700 text-slate-600 hover:border-primary-500/40'
                }`}
              >
                <MessageSquare size={16} />
                {t('auto_reply.response_text')}
              </button>
              <button
                type="button"
                onClick={() => handleResponseTypeChange('image')}
                disabled={isReadOnly}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all ${
                  formData.response.type === 'image'
                    ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300'
                    : 'border-dark-700 text-slate-600 hover:border-primary-500/40'
                }`}
              >
                <ImageIcon size={16} />
                {t('auto_reply.response_image')}
              </button>
              {/* Flex type intentionally hidden */}
            </div>
            <InputError error={errors.response} />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('auto_reply.form_response_content_label')} <span className="text-red-500">*</span>
            </label>
            {formData.response.type === 'text' && (
              <>
                <textarea
                  name="response_text"
                  value={formData.response.text || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, response: { ...prev.response, text: e.target.value } }))}
                  disabled={isReadOnly}
                  rows={5}
                  className={inputClass(!!errors.response)}
                  placeholder={t('auto_reply.form_response_text_placeholder')}
                />
                <p className="mt-1 text-xs text-slate-700">{t('auto_reply.form_response_text_hint')}</p>
              </>
            )}
            {formData.response.type === 'image' && (
              <>
                <input
                  name="response_image_url"
                  value={formData.response.image_url || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, response: { ...prev.response, image_url: e.target.value } }))}
                  disabled={isReadOnly}
                  className={inputClass(!!errors.response)}
                  placeholder={t('auto_reply.form_response_image_placeholder')}
                />
                <p className="mt-1 text-xs text-slate-700">{t('auto_reply.form_response_image_hint')}</p>
              </>
            )}
            {formData.response.type === 'flex' && (
              <>
                <textarea
                  name="response_flex"
                  value={flexText}
                  onChange={(e) => setFlexText(e.target.value)}
                  disabled={isReadOnly}
                  rows={7}
                  className={inputClass(!!errors.response)}
                  placeholder={t('auto_reply.form_response_flex_placeholder')}
                />
                <p className="mt-1 text-xs text-slate-700">{t('auto_reply.form_response_flex_hint')}</p>
              </>
            )}
            <InputError error={errors.response} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('auto_reply.form_priority_label')}</label>
              <input
                type="number"
                name="priority"
                value={formData.priority}
                onChange={(e) => setFormData(prev => ({ ...prev, priority: Number(e.target.value) }))}
                disabled={isReadOnly}
                className={inputClass(false)}
              />
              <p className="mt-1 text-xs text-slate-700">{t('auto_reply.form_priority_hint')}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('auto_reply.form_status_label')}</label>
              <select
                name="active"
                value={String(formData.active)}
                onChange={(e) => setFormData(prev => ({ ...prev, active: e.target.value === 'true' }))}
                disabled={isReadOnly}
                className={inputClass(false, 'appearance-none')}
              >
                <option value="true">{t('status.active')}</option>
                <option value="false">{t('status.inactive')}</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-dark-700">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-dark-700 transition-colors"
            >
              {t('common.cancel')}
            </button>
            {!isReadOnly && (
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 transition-all shadow-lg shadow-primary-500/20 flex items-center gap-2"
              >
                {loading && <Loader2 className="animate-spin" size={16} />}
                <Save size={18} />
                {t('common.save')}
              </button>
            )}
          </div>
        </form>
    </Modal>
  );
};
