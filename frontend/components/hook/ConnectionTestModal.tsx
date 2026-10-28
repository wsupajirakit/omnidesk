import React, { useState } from 'react';
import { X, Copy, Check, Terminal, ShieldCheck, Play, ChevronDown, ChevronUp, Users, ArrowUp, ArrowDown } from 'lucide-react';
import { useI18n } from '../../i18n';
import { chatService, ChatRoom } from '../../services/chat';
import { webhookService } from '../../services/hook';
import { HookData } from '../../types';
import { ConfirmModal } from '../modals';
import { copyText } from '../../utils/copyText';

interface ConnectionTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  automatedData: any;
  onExecuteCustom: (payload: any) => Promise<any>;
  configBaseUrl?: string;
}

export const ConnectionTestModal: React.FC<ConnectionTestModalProps> = ({ 
  isOpen, 
  onClose, 
  automatedData,
  onExecuteCustom,
  configBaseUrl
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'login' | 'custom'>('login');
  const [copied, setCopied] = useState(false);
  const [customPayload, setCustomPayload] = useState('');
  const [customResult, setCustomResult] = useState<any>(null);
  const [executing, setExecuting] = useState(false);
  const [isCurlCollapsed, setIsCurlCollapsed] = useState(false);

  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [hooks, setHooks] = useState<HookData[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [isTokenCopied, setIsTokenCopied] = useState(false);
  const [isUserIdCopied, setIsUserIdCopied] = useState(false);
  
  const [showScrollUp, setShowScrollUp] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    setShowScrollUp(scrollTop > 20);
    setShowScrollDown(scrollTop + clientHeight < scrollHeight - 20);
  };

  React.useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        if (scrollRef.current) {
          const { scrollHeight, clientHeight } = scrollRef.current;
          setShowScrollDown(scrollHeight > clientHeight);
        }
      }, 500);
    }
  }, [isOpen, activeTab, automatedData, customResult]);

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    targetPayload: string;
  }>({
    isOpen: false,
    targetPayload: ''
  });

  React.useEffect(() => {
    if (isOpen && activeTab === 'custom') {
      const fetchData = async () => {
        setLoadingRooms(true);
        try {
          const [r, h] = await Promise.all([
            chatService.listRooms(),
            webhookService.getAllHooks()
          ]);
          setRooms(r);
          setHooks(h);
        } catch (e) {
          console.error('Failed to fetch rooms/hooks', e);
        } finally {
          setLoadingRooms(false);
        }
      };
      fetchData();
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  /* [FIX-20260830-COPYHTTP2] `utils/copyText`, never `navigator.clipboard`
     directly: the Clipboard API exists only in a SECURE CONTEXT, and this
     dashboard is served over plain http — the call was a silent no-op while
     the success UI fired anyway. copyText falls back to execCommand and
     returns whether the copy really happened. */
  const handleCopy = async (data: any) => {
    if (!(await copyText(JSON.stringify(data, null, 2)))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSetDefault = (payload: string) => {
    if (customPayload.trim()) {
      setConfirmState({ isOpen: true, targetPayload: payload });
    } else {
      setCustomPayload(payload);
      setIsCurlCollapsed(false);
    }
  };

  const confirmSetDefault = () => {
    setCustomPayload(confirmState.targetPayload);
    setIsCurlCollapsed(false);
    setConfirmState({ isOpen: false, targetPayload: '' });
  };

  const currentSelectedRoom = rooms.find(r => r._id === selectedRoomId);
  const hookMap = new Map(hooks.map(h => [h._id, h.alias]));

  const handleExecute = async () => {
    if (!customPayload.trim()) return;
    setExecuting(true);
    setIsCurlCollapsed(true);
    try {
      let payload;
      const trimmed = customPayload.trim();
      
      if (trimmed.toLowerCase().startsWith('curl')) {
        // Simple cURL parser
        payload = {
          url: '',
          method: 'GET',
          headers: {} as Record<string, string>,
          data: undefined as any
        };

        // Extract URL
        const urlMatch = trimmed.match(/(?:'|")?(https?:\/\/[^\s'"]+)(?:'|")?/);
        if (urlMatch) payload.url = urlMatch[1];

        // Extract Method
        const methodMatch = trimmed.match(/(?:-X|--request)\s+['"]?([A-Z]+)['"]?/i);
        if (methodMatch) {
          payload.method = methodMatch[1].toUpperCase();
        } else if (trimmed.includes('--data') || trimmed.includes('-d')) {
          payload.method = 'POST';
        }

        // Extract Headers
        const headerMatches = trimmed.matchAll(/(?:-H|--header)\s+['"]?([^'"]+)['"]?/g);
        for (const match of headerMatches) {
          const parts = match[1].split(':');
          if (parts.length >= 2) {
            payload.headers[parts[0].trim()] = parts.slice(1).join(':').trim();
          }
        }

        // Extract Data (JSON or Raw)
        const dataMatch = trimmed.match(/(?:--data|--data-raw|-d)\s+('({.*})'|"({.*})"|({.*}))/s);
        if (dataMatch) {
          const rawData = dataMatch[2] || dataMatch[3] || dataMatch[4];
          try {
            payload.data = JSON.parse(rawData);
          } catch (e) {
            payload.data = rawData;
          }
        }

        // Extract Form Data
        const formMatches = trimmed.matchAll(/(?:--form|-F)\s+['"]?([^'"]+)['"]?/g);
        for (const match of formMatches) {
          const parts = match[1].split('=');
          if (parts.length >= 2) {
            if (!payload.data) payload.data = {};
            if (typeof payload.data === 'object') {
              payload.data[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
            }
          }
        }
      } else {
        try {
          payload = JSON.parse(trimmed);
        } catch (e) {
          throw new Error('Invalid JSON format. If pasting cURL, ensure it starts with "curl"');
        }
      }

      if (!payload.url) throw new Error('Could not detect target URL');

      const result = await onExecuteCustom(payload);
      setCustomResult(result);
    } catch (e: any) {
      setCustomResult({ error: e.message || 'Execution failed' });
    } finally {
      setExecuting(false);
    }
  };

  const highlightContent = (text: string) => {
    if (!text) return text;
    
    // Split text into tokens to preserve structure but highlight specific words
    const tokens = text.split(/(\b(?:success|failed|error|ok)\b)/gi);
    
    return tokens.map((token, index) => {
      const lowerToken = token.toLowerCase();
      if (lowerToken === 'success' || lowerToken === 'ok') {
        return <span key={index} className="text-emerald-600 font-bold">{token}</span>;
      }
      if (lowerToken === 'failed' || lowerToken === 'error') {
        return <span key={index} className="text-red-600 font-bold">{token}</span>;
      }
      return token;
    });
  };

  const JsonView = ({ data }: { data: any }) => (
    <pre className="text-[13px] font-mono text-slate-900 bg-white p-6 rounded-xl border border-slate-200 shadow-inner leading-relaxed overflow-x-auto whitespace-pre-wrap break-all">
      {highlightContent(JSON.stringify(data, null, 2))}
    </pre>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-white/45 backdrop-blur transition-all duration-300">
      <div className="bg-dark-800 border border-dark-700 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col transform transition-all scale-100 animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="text-primary-500" />
            Connection Test Result
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-dark-700 transition-all"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="px-6 py-2 bg-dark-900/40 flex gap-4 border-b border-dark-700">
          <button
            onClick={() => setActiveTab('login')}
            className={`px-4 py-2 text-sm font-bold transition-all border-b-2 ${
              activeTab === 'login' 
                ? 'border-primary-500 text-primary-400' 
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            Automated Login
          </button>
          <button
            onClick={() => setActiveTab('custom')}
            className={`px-4 py-2 text-sm font-bold transition-all border-b-2 ${
              activeTab === 'custom' 
                ? 'border-primary-500 text-primary-400' 
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            Custom cURL
          </button>
        </div>

        {/* Body */}
        <div 
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto p-6 bg-dark-900/50 custom-scrollbar relative"
        >
          {/* Scroll Indicators */}
          {showScrollUp && (
            <div className="sticky top-0 left-0 right-0 z-20 flex justify-center pointer-events-none h-0">
              <div className="bg-emerald-500 text-white p-2.5 rounded-full shadow-lg shadow-emerald-500/40 translate-y-2 animate-bounce flex items-center justify-center">
                <ArrowUp size={20} strokeWidth={3} />
              </div>
            </div>
          )}
          {activeTab === 'login' ? (
            <JsonView data={automatedData} />
          ) : (
            <div className="flex flex-col gap-4">
              {/* Token Quick Access */}
              {(() => {
                const findToken = (obj: any): string | null => {
                  if (!obj || typeof obj !== 'object') return null;
                  if (obj.access_token) return obj.access_token;
                  if (obj.token) return obj.token;
                  if (obj.data?.access_token) return obj.data.access_token;
                  if (obj.data?.token) return obj.data.token;
                  for (const key in obj) {
                    if (typeof obj[key] === 'object') {
                      const found = findToken(obj[key]);
                      if (found) return found;
                    }
                  }
                  return null;
                };
                const token = findToken(automatedData);
                if (!token) return null;

                return (
                  <div className="bg-primary-500/10 border border-primary-500/20 rounded-xl p-4 flex items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-[10px] font-bold text-primary-400 uppercase tracking-widest">Detected Access Token</span>
                      <code className="text-xs text-slate-900 font-mono truncate">{token}</code>
                    </div>
                    <button
                      onClick={() => {
                        void copyText(token).then((ok) => {
                          if (!ok) return;
                          setIsTokenCopied(true);
                          setTimeout(() => setIsTokenCopied(false), 2000);
                        });
                      }}
                      className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-all"
                    >
                      {isTokenCopied ? <Check size={14} /> : <Copy size={14} />}
                      {isTokenCopied ? 'Copied' : 'Copy Token'}
                    </button>
                  </div>
                );
              })()}

              {/* API Base URL Quick Access */}
              {configBaseUrl && (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-300 delay-75">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">EXTERNAL_API_BASE_URL</span>
                    <code className="text-xs text-slate-900 font-mono truncate">{configBaseUrl}</code>
                  </div>
                  <button
                    onClick={() => {
                      void copyText(configBaseUrl).then((ok) => {
                        if (!ok) return;
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      });
                    }}
                    className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-600 text-white text-xs font-bold transition-all"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy URL'}
                  </button>
                </div>
              )}

              {/* LINE User Selector */}
              <div className="bg-slate-500/5 border border-slate-500/10 rounded-xl p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-300 delay-100">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-slate-500" />
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Active Member Quick Copy</span>
                </div>
                
                <div className="flex items-center gap-3">
                  <select
                    value={selectedRoomId}
                    onChange={(e) => setSelectedRoomId(e.target.value)}
                    className="flex-1 bg-dark-800 border border-dark-600 rounded-lg py-2 px-3 text-xs font-bold text-slate-800 focus:ring-1 focus:ring-primary-500 outline-none transition-all cursor-pointer"
                  >
                    <option value="">Select a user...</option>
                    {rooms.map(room => {
                      const botAlias = room.hook_id ? hookMap.get(room.hook_id) : null;
                      const label = `${room.user_data?.display_name || 'Unknown'} ${botAlias ? `(bot : ${botAlias})` : ''}`;
                      return (
                        <option key={room._id} value={room._id}>
                          {label}
                        </option>
                      );
                    })}
                  </select>

                  {currentSelectedRoom && (
                    <button
                      onClick={() => {
                        void copyText(currentSelectedRoom.line_user_id).then((ok) => {
                          if (!ok) return;
                          setIsUserIdCopied(true);
                          setTimeout(() => setIsUserIdCopied(false), 2000);
                        });
                      }}
                      className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-dark-700 hover:bg-dark-600 text-slate-900 text-xs font-bold transition-all border border-dark-600"
                    >
                      {isUserIdCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                      {isUserIdCopied ? <span className="text-emerald-500">Copied!</span> : 'Copy Member User ID'}
                    </button>
                  )}
                </div>

                {isUserIdCopied && currentSelectedRoom && (
                  <div className="text-[10px] font-mono text-emerald-500 animate-in fade-in zoom-in duration-200">
                    Copied: {currentSelectedRoom.line_user_id}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setIsCurlCollapsed(!isCurlCollapsed)}
                    className={`p-2 rounded-lg transition-all shadow-sm ${
                      isCurlCollapsed 
                        ? 'bg-primary-600/20 text-primary-500 animate-pulse hover:bg-primary-600/30' 
                        : 'bg-dark-700 text-slate-400 hover:text-primary-500 hover:bg-dark-600'
                    }`}
                    title={isCurlCollapsed ? 'Expand' : 'Collapse'}
                  >
                    {isCurlCollapsed ? <ChevronDown size={20} strokeWidth={2.5} /> : <ChevronUp size={20} strokeWidth={2.5} />}
                  </button>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 flex-1">
                    <Terminal size={14} />
                    Custom Payload Editor
                  </label>
                  <div className="flex gap-1">
                    <button
                      onClick={handleExecute}
                      disabled={executing || !customPayload.trim()}
                      className="mr-2 flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-lg shadow-primary-500/20 transition-all border border-primary-500"
                    >
                      {executing ? (
                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Play size={12} fill="currentColor" />
                      )}
                      Execute
                    </button>
                    <button
                      onClick={() => handleSetDefault(`curl --location '{{api_url}}/api/v1/customer/{{replace_line_user_id}}' \\\n--header 'Authorization: Bearer {{a_token}}'`)}
                      className="px-2 py-1.5 bg-dark-700 hover:bg-dark-600 text-slate-400 hover:text-white rounded-lg text-[9px] font-bold uppercase tracking-tight transition-all border border-dark-600"
                    >
                      Default #1
                    </button>
                    <button
                      onClick={() => handleSetDefault(`curl --location '{{api_url}}/api/line/v1/installment_current.php' \\\n--header 'Authorization: Bearer {{a_token}}' \\\n--form 'userid="{{replace_line_user_id}}"'`)}
                      className="px-2 py-1.5 bg-dark-700 hover:bg-dark-600 text-slate-400 hover:text-white rounded-lg text-[9px] font-bold uppercase tracking-tight transition-all border border-dark-600"
                    >
                      Default #2
                    </button>
                  </div>
                </div>
                {!isCurlCollapsed && (
                  <textarea
                    value={customPayload}
                    onChange={(e) => setCustomPayload(e.target.value)}
                    placeholder={JSON.stringify({
                      url: "https://example.com/api",
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json"
                      },
                      data: {
                        key: "value"
                      }
                    }, null, 2)}
                    className="w-full h-48 bg-dark-950 border border-dark-600 rounded-xl p-4 text-emerald-400 font-mono text-xs focus:ring-1 focus:ring-primary-500 outline-none custom-scrollbar"
                  />
                )}
              </div>

              {customResult && (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Execution Result</label>
                  <JsonView data={customResult} />
                </div>
              )}
            </div>
          )}

          {showScrollDown && (
            <div className="sticky bottom-0 left-0 right-0 z-20 flex justify-center pointer-events-none h-0">
              <div className="bg-emerald-500 text-white p-2.5 rounded-full shadow-lg shadow-emerald-500/40 -translate-y-8 animate-bounce flex items-center justify-center">
                <ArrowDown size={20} strokeWidth={3} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-dark-700 bg-dark-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-8 py-2.5 rounded-xl border-2 border-blue-500 text-blue-500 hover:bg-blue-500/10 font-bold text-sm transition-all active:scale-95"
          >
            {t('common.close')}
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmState.isOpen}
        onClose={() => setConfirmState({ ...confirmState, isOpen: false })}
        onConfirm={confirmSetDefault}
        title="Overwrite Content?"
        message="This will replace the current editor content with the default template. Are you sure you want to continue?"
        type="warning"
        confirmLabel="Yes, Overwrite"
        cancelLabel="Keep Current"
      />
    </div>
  );
};
