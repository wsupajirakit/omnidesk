/**
 * Chat.tsx
 * Main Chat Management Page (Replaces DemoChat.tsx)
 * 
 * Created/Updated by: Gemini 3.6 Flash (2026-07-22)
 * Purpose: Main chat page rendering channel/bot selector, room list, and shared ChatRoomView component.
 * DB impact: NONE (Frontend UI page)
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { getStoredAuth } from '../../services/authStorage';
import {
  Search,
  ChevronDown,
  Loader2
} from 'lucide-react';
import { chatService, ChatRoom } from '../../services/chat';
import { webhookService } from '../../services/hook';
import { HookData } from '../../types';
import { useI18n } from '../../i18n';
import { ChatRoomView } from '../../components/chat';

const Chat: React.FC = () => {
  const { t } = useI18n();
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<ChatRoom | null>(null);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [roomPage, setRoomPage] = useState(1);
  const [roomsHasMore, setRoomsHasMore] = useState(false);
  const [loadingMoreRooms, setLoadingMoreRooms] = useState(false);

  const [isSpotlightOpen, setIsSpotlightOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const spotlightRef = useRef<HTMLInputElement | null>(null);
  const isInitialLoad = useRef(true);

  const [hooks, setHooks] = useState<HookData[]>([]);
  const [selectedHookId, setSelectedHookId] = useState<string>('');
  const [showPickToast, setShowPickToast] = useState(true);
  // Toast auto-hides after a few seconds; re-shows whenever no channel is picked.
  useEffect(() => {
    if (selectedHookId) { setShowPickToast(false); return; }
    setShowPickToast(true);
    const t = window.setTimeout(() => setShowPickToast(false), 4000);
    return () => window.clearTimeout(t);
  }, [selectedHookId]);
  const [loadingHooks, setLoadingHooks] = useState(false);
  const [botProfiles, setBotProfiles] = useState<Record<string, { pictureUrl: string; updatedAt: number }>>({});
  const [isBotSelectorOpen, setIsBotSelectorOpen] = useState(false);

  const botSelectorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (botSelectorRef.current && !botSelectorRef.current.contains(event.target as Node)) {
        setIsBotSelectorOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchBotProfiles = useCallback(async (allHooks: HookData[], force = false) => {
    const CACHE_KEY = 'bot_profiles_cache';
    const CACHE_TTL = 10 * 60 * 1000;

    try {
      const stored = localStorage.getItem(CACHE_KEY);
      let currentCache = stored ? JSON.parse(stored) : {};
      const now = Date.now();

      const updatedProfiles = { ...currentCache };
      let hasChanges = false;

      const promises = allHooks.map(async (hook) => {
        const cacheItem = updatedProfiles[hook._id];
        if (!force && cacheItem && now - cacheItem.updatedAt < CACHE_TTL) {
          return;
        }

        try {
          const data = await webhookService.getHookBotInfo(hook._id);
          if (data.pictureUrl) {
            updatedProfiles[hook._id] = {
              pictureUrl: data.pictureUrl,
              updatedAt: now
            };
            hasChanges = true;
          }
        } catch (e) {
          console.error(`Failed to fetch bot info for ${hook.line_oa_name}:`, e);
        }
      });

      await Promise.all(promises);

      if (hasChanges) {
        localStorage.setItem(CACHE_KEY, JSON.stringify(updatedProfiles));
        setBotProfiles(updatedProfiles);
      } else {
        setBotProfiles(currentCache);
      }
    } catch (error) {
      console.error('Failed to fetch bot profiles:', error);
    }
  }, []);

  useEffect(() => {
    const fetchHooksAndProfiles = async () => {
      try {
        setLoadingHooks(true);
        const data = await webhookService.getAllHooks();
        const auth = getStoredAuth();
        const allowed = auth?.allowed_hooks ?? auth?.user?.allowed_hooks ?? null;
        const filtered = allowed ? data.filter((h: any) => allowed.includes(h._id)) : data;
        setHooks(filtered);
        if (filtered.length > 0) {
          await fetchBotProfiles(filtered);
        }
      } catch (error) {
        console.error('Failed to fetch hooks', error);
      } finally {
        setLoadingHooks(false);
      }
    };
    fetchHooksAndProfiles();
  }, [fetchBotProfiles]);

  const ROOMS_PAGE_SIZE = 40;

  const fetchRooms = useCallback(async () => {
    if (!selectedHookId) {
      setRooms([]);
      setLoadingRooms(false);
      return;
    }
    try {
      setLoadingRooms(true);
      const { data, meta } = await chatService.listRoomsPaged(
        selectedHookId,
        1,
        ROOMS_PAGE_SIZE,
      );
      setRooms(data);
      setRoomPage(1);
      setRoomsHasMore(meta.page < meta.pages);
      if (data.length > 0 && isInitialLoad.current) {
        setSelectedRoom(data[0]);
        isInitialLoad.current = false;
      }
    } catch (error) {
      console.error('Failed to fetch rooms', error);
    } finally {
      setLoadingRooms(false);
    }
  }, [selectedHookId]);

  const loadMoreRooms = useCallback(async () => {
    if (loadingMoreRooms || !roomsHasMore || !selectedHookId) return;
    const nextPage = roomPage + 1;
    try {
      setLoadingMoreRooms(true);
      const { data, meta } = await chatService.listRoomsPaged(
        selectedHookId,
        nextPage,
        ROOMS_PAGE_SIZE,
      );
      setRooms(prev => {
        const seen = new Set(prev.map(r => r._id));
        return [...prev, ...data.filter(r => !seen.has(r._id))];
      });
      setRoomPage(nextPage);
      setRoomsHasMore(meta.page < meta.pages);
    } catch (error) {
      console.error('Failed to load more rooms', error);
    } finally {
      setLoadingMoreRooms(false);
    }
  }, [loadingMoreRooms, roomsHasMore, roomPage, selectedHookId]);

  const handleRoomsScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      loadMoreRooms();
    }
  }, [loadMoreRooms]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  useEffect(() => {
    if (!isSpotlightOpen) return;
    spotlightRef.current?.focus();
  }, [isSpotlightOpen]);

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch {
      return '';
    }
  };

  const filteredRooms = useMemo(() => {
    if (!searchValue.trim()) return rooms;
    const term = searchValue.toLowerCase();
    return rooms.filter(r =>
      (r.user_data?.display_name || '').toLowerCase().includes(term) ||
      (r.user_data?.nickname || '').toLowerCase().includes(term) ||
      (r.line_user_id || '').toLowerCase().includes(term)
    );
  }, [rooms, searchValue]);

  return (
    <div className="demo-chat h-[calc(100vh-64px)] -m-4 md:-m-6 lg:-m-8 bg-slate-100 text-slate-900 overflow-hidden flex flex-col">
      {/* Top Header: Bot Selector */}
      <div className="bg-white border-b border-slate-200 px-6 py-2 flex items-center justify-center shrink-0 z-30 h-14">
        <div className="relative" ref={botSelectorRef}>
          <button
            onClick={() => {
              const nextState = !isBotSelectorOpen;
              setIsBotSelectorOpen(nextState);
              if (nextState) {
                fetchBotProfiles(hooks, true);
              }
            }}
            className="flex items-center gap-3 px-4 py-1.5 rounded-full hover:bg-slate-50 transition-all border border-transparent hover:border-slate-200"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-[10px] text-white font-bold shadow-sm overflow-hidden">
              {selectedHookId && botProfiles[selectedHookId] ? (
                <img src={botProfiles[selectedHookId].pictureUrl} alt="bot profile" className="w-full h-full object-cover" />
              ) : (
                '🤖'
              )}
            </div>
            <div className="text-left">
              <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider leading-none mb-1">Channel</div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-700">
                  {hooks.find(h => h._id === selectedHookId)?.line_oa_name || 'Select Bot'}
                </span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${isBotSelectorOpen ? 'rotate-180' : ''}`} />
              </div>
            </div>
          </button>

          {isBotSelectorOpen && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden py-2 animate-in fade-in zoom-in duration-200">
              <div className="px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-50 mb-1">
                Available Line OAs
              </div>
              <div className="max-h-[320px] overflow-y-auto custom-scrollbar">
                {hooks.map((h) => (
                  <button
                    key={h._id}
                    onClick={() => {
                      setSelectedHookId(h._id || '');
                      setSelectedRoom(null);
                      setIsBotSelectorOpen(false);
                    }}
                    className={`w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors ${selectedHookId === h._id ? 'bg-primary-50' : ''}`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-xs overflow-hidden">
                      {botProfiles[h._id] ? (
                        <img src={botProfiles[h._id].pictureUrl} alt="bot profile" className="w-full h-full object-cover" />
                      ) : (
                        '🤖'
                      )}
                    </div>
                    <div className="text-left">
                      <div className={`text-sm font-semibold ${selectedHookId === h._id ? 'text-primary-600' : 'text-slate-700'}`}>{h.line_oa_name}</div>
                      <div className="text-[10px] text-slate-400">{h.company_name || 'No company'}</div>
                    </div>
                  </button>
                ))}
              </div>
              {loadingHooks && (
                <div className="p-4 text-center">
                  <Loader2 size={20} className="animate-spin text-primary-500 mx-auto" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Small toast: prompt to pick a channel (no blocking modal) */}
      {!selectedHookId && showPickToast && (
        <div className="fixed top-28 left-1/2 -translate-x-1/2 z-40 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-2 bg-slate-800 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg">
            <span>👆</span>
            <span>{t('chatpage.pick_channel', 'เลือก Channel ด้านบนเพื่อดูห้องแชท')}</span>
          </div>
        </div>
      )}

      {/* Main split view */}
      <div className="flex-1 flex gap-0 h-full overflow-hidden relative min-h-0">
        {/* Left Sidebar: Chat Rooms */}
        <section className={`w-full lg:w-[320px] bg-white border-r border-slate-200 flex flex-col h-full min-h-0 shrink-0 ${selectedRoom ? 'hidden lg:flex' : 'flex'}`}>
          <div className="p-3 border-b border-slate-200 flex items-center justify-between">
            <span className="font-semibold text-slate-700 text-sm">
              {hooks.find(h => h._id === selectedHookId)?.line_oa_name || 'Messages'}
            </span>
          </div>

          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
                <Search size={14} />
              </span>
              <input
                type="text"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder={t('chatpage.search', 'ค้นหาชื่อ / LINE ID...')}
                className="w-full bg-slate-50 border border-slate-200 pl-8 pr-3 py-1.5 rounded-lg text-slate-900 placeholder-slate-400 text-xs focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 custom-scrollbar" onScroll={handleRoomsScroll}>
            {loadingRooms ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                <Loader2 className="mx-auto animate-spin mb-2" size={20} />
                {t('chatpage.loading', 'กำลังโหลดห้องแชต...')}
              </div>
            ) : filteredRooms.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">{t('chatpage.empty', 'ไม่พบรายการแชต')}</div>
            ) : (
              filteredRooms.map((room) => (
                <button
                  key={room._id}
                  onClick={() => setSelectedRoom(room)}
                  className={`w-full p-3 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left ${selectedRoom?._id === room._id ? 'bg-primary-50/60 border-l-4 border-primary-500' : ''}`}
                >
                  <img
                    src={room.user_data?.picture_url || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'}
                    alt={room.user_data?.display_name}
                    className="w-10 h-10 rounded-full object-cover shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm text-slate-800 truncate">
                      {room.user_data?.display_name || room.line_user_id}
                      {room.user_data?.nickname && (
                        <span className="text-xs text-slate-400 ml-1 font-normal">
                          ({room.user_data.nickname})
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      {room.last_message?.text || 'No messages'}
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-400 text-right shrink-0 flex flex-col items-end gap-1">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${room.assist_status ? 'bg-green-100 text-blue-600' : 'bg-yellow-100 text-orange-500'}`}>
                      Assist: {room.assist_status ? 'ON' : 'OFF'}
                    </span>
                    <span>{formatTime(room.last_message?.timestamp)}</span>
                  </div>
                </button>
              ))
            )}
            {loadingMoreRooms && (
              <div className="p-4 text-center text-slate-400">
                <Loader2 className="mx-auto animate-spin" size={18} />
              </div>
            )}
          </div>
        </section>

        {/* Right Section: Reusable ChatRoomView (Chat Messages + User Details) */}
        <section className="flex-1 flex h-full overflow-hidden min-w-0">
          <ChatRoomView
            room={selectedRoom}
            hookId={selectedHookId}
          />
        </section>
      </div>
    </div>
  );
};

export default Chat;
