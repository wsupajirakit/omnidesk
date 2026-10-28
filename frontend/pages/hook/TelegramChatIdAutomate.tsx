import React, { useMemo, useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import { AlertModal } from '../../components/modals';
import { useI18n } from '../../i18n';
import { copyText } from '../../utils/copyText';

type TelegramUpdate = {
  update_id?: number;
  message?: {
    text?: string;
    chat?: {
      id?: number | string;
      title?: string;
      type?: string;
      username?: string;
      first_name?: string;
    };
  };
};

type TelegramResponse = {
  ok?: boolean;
  result?: TelegramUpdate[];
  description?: string;
};

const normalizeToken = (value: string) => {
  let token = value.trim().replace(/\s+/g, '');
  token = token.replace(/^https?:\/\/api\.telegram\.org\/bot/i, '');
  token = token.replace(/\/getUpdates.*$/i, '');
  token = token.replace(/^bot/i, '');
  return token;
};

const prettyJson = (data: unknown) => {
  try {
    return JSON.stringify(data, null, 2);
  } catch (error) {
    return String(data);
  }
};

const TelegramChatIdAutomate: React.FC = () => {
  const { t } = useI18n();
  const [tokenInput, setTokenInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [rawJson, setRawJson] = useState('');
  const [response, setResponse] = useState<TelegramResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [foundChatId, setFoundChatId] = useState<string | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [copiableToken, setCopiableToken] = useState<string | null>(null);
  const [alertState, setAlertState] = useState<{ isOpen: boolean; title: string; message: string; type?: 'success' | 'error' } | null>(null);

  const updates = useMemo(() => (Array.isArray(response?.result) ? response?.result : []), [response]);

  const handleSubmitToken = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeToken(tokenInput);
    if (!normalized) {
      setAlertState({ isOpen: true, title: t('pageui.hook.tg.bad_token_title', 'Token ไม่ถูกต้อง'), message: t('pageui.hook.tg.bad_token_msg', 'กรุณากรอก Telegram token ให้ถูกต้อง') });
      return;
    }

    setIsLoading(true);
    setFoundChatId(null);
    setSearchMessage(null);
    setCopiableToken(null);
    setRawJson('');
    setResponse(null);

    try {
      const url = `https://api.telegram.org/bot${normalized}/getUpdates`;
      const res = await fetch(url);
      const text = await res.text();
      let parsed: TelegramResponse | null = null;
      try {
        parsed = JSON.parse(text) as TelegramResponse;
      } catch (error) {
        parsed = null;
      }

      if (!res.ok) {
        setAlertState({
          isOpen: true,
          title: t('pageui.hook.tg.api_failed', 'เรียก API ไม่สำเร็จ'),
          message: parsed?.description || `HTTP ${res.status}`
        });
      } else if (parsed?.ok === false) {
        setAlertState({
          isOpen: true,
          title: t('pageui.hook.tg.api_error', 'API ตอบกลับผิดพลาด'),
          message: parsed?.description || t('pageui.hook.tg.fetch_failed', 'ไม่สามารถดึงข้อมูลได้')
        });
      } else if (parsed?.ok === true) {
        setCopiableToken(normalized);
      }

      setResponse(parsed);
      setRawJson(parsed ? prettyJson(parsed) : text);
    } catch (error: any) {
      setAlertState({
        isOpen: true,
        title: t('pageui.hook.tg.error', 'เกิดข้อผิดพลาด'),
        message: error?.message || t('pageui.hook.tg.connect_failed', 'ไม่สามารถเชื่อมต่อ Telegram API ได้')
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFindChatId = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const search = keyword.trim();
    if (!search) {
      setSearchMessage(t('pageui.hook.tg.need_keyword', 'กรุณาระบุ keyword ก่อนค้นหา'));
      setFoundChatId(null);
      return;
    }

    const match = updates.find((item) => item?.message?.text?.includes(search));
    if (match?.message?.chat?.id !== undefined && match?.message?.chat?.id !== null) {
      setFoundChatId(String(match.message.chat.id));
      setSearchMessage(null);
    } else {
      setFoundChatId(null);
      setSearchMessage(t('pageui.hook.tg.not_found', 'ไม่พบ chat id จาก keyword นี้ สามารถหา chat id ได้เองจาก json raw ที่แสดง pretty json'));
    }
  };

  return (
    <div className="min-h-screen bg-dark-900 text-slate-900 flex items-start justify-center p-4">
      <div className="w-full max-w-4xl bg-dark-800 border border-dark-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-dark-700">
          <h1 className="text-2xl font-semibold text-slate-900">Telegram Chat id Automate</h1>
        
          <p className="text-sm text-slate-500 mt-1">{t('pageui.hook.tg.intro_1', 'สร้าง bot และดึงเข้ากลุ่ม / ทักหา bot ในกลุ่มด้วยข้อความที่ต้องการใช้เป็น keyword (**ภาษาอังกฤษเท่านั้นไม่เว้นวรรค**)')}</p>
          <p className="text-sm text-slate-500 mt-1">{t('pageui.hook.tg.intro_2', 'กรอก Telegram token แล้วกด Submit เพื่อดึงข้อมูลล่าสุด')}</p>
          <div className="mt-3 text-xs text-slate-500">
            {t('pageui.hook.tg.clip', 'คลิป:')}{' '}
            <a
              href="https://drive.google.com/file/d/EXAMPLE_FILE_ID/view?usp=sharing"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-blue-500/60 bg-blue-600/20 px-3 py-1.5 text-xs font-semibold text-blue-500 underline underline-offset-4 hover:bg-blue-600/30 hover:text-blue-400 transition-colors"
            >
              {t('pageui.hook.tg.clip_link', 'ขั้นตอนการสร้าง telegram bot + chat')}
            </a>
          </div>
        </div>

        <div className="p-6 flex flex-col gap-6">
          <form onSubmit={handleSubmitToken} className="flex flex-col gap-4">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                <label className="block text-sm font-medium text-slate-500">Telegram Token</label>
                {copiableToken && (
                  <button
                    type="button"
                    onClick={() => {
                      // [FIX-20260830-COPYHTTP2] the alert follows the real result
                      void copyText(copiableToken).then((ok) =>
                        setAlertState({
                          isOpen: true,
                          title: ok ? t('pageui.hook.tg.copied', 'คัดลอกแล้ว') : t('pageui.hook.tg.copy_failed', 'คัดลอกไม่สำเร็จ'),
                          message: ok ? t('pageui.hook.tg.copied_value', 'copy แล้ว {value}', { value: copiableToken }) : t('pageui.hook.tg.copy_refused', 'เบราว์เซอร์ปฏิเสธการคัดลอก — ลองใหม่อีกครั้ง'),
                          type: ok ? 'success' : 'error'
                        }),
                      );
                    }}
                    className="inline-flex items-center justify-center rounded-lg border border-blue-500/60 bg-blue-600/20 px-3 py-1.5 text-xs font-semibold text-blue-500 hover:bg-blue-600/30 transition-colors"
                  >
                    Copy token
                  </button>
                )}
              </div>
              <input
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value.replace(/\s+/g, ''))}
                placeholder="123456789:AA..."
                className="w-full rounded-lg bg-dark-900 border border-dark-700 px-4 py-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 text-white px-4 py-2 text-sm font-semibold shadow-lg shadow-primary-500/30 hover:bg-primary-500 transition-colors disabled:opacity-60"
            >
              {isLoading ? t('pageui.hook.tg.loading', 'กำลังโหลด...') : 'Submit'}
            </button>
          </form>

          {updates.length > 0 && (
            <form onSubmit={handleFindChatId} className="flex flex-col gap-4 border-t border-dark-700 pt-6">
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-2">Keyword</label>
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder={t('pageui.hook.tg.keyword_ph', 'เช่น helloyo')}
                  className="w-full rounded-lg bg-dark-900 border border-dark-700 px-4 py-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-semibold shadow-lg shadow-emerald-500/30 hover:bg-emerald-500 transition-colors"
              >
                <Search size={16} /> Find chat id
              </button>

              {foundChatId && (
                <div className="rounded-xl border border-blue-500/40 bg-blue-500/10 p-4 text-blue-500">
                  <div className="text-sm">found chat id</div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-3">
                    <div className="text-2xl font-semibold text-blue-500">{foundChatId}</div>
                    <button
                      type="button"
                      onClick={() => {
                        // [FIX-20260830-COPYHTTP2] the alert follows the real result
                        void copyText(foundChatId).then((ok) =>
                          setAlertState({
                            isOpen: true,
                            title: ok ? t('pageui.hook.tg.copied', 'คัดลอกแล้ว') : t('pageui.hook.tg.copy_failed', 'คัดลอกไม่สำเร็จ'),
                            message: ok ? t('pageui.hook.tg.copied_value', 'copy แล้ว {value}', { value: foundChatId }) : t('pageui.hook.tg.copy_refused', 'เบราว์เซอร์ปฏิเสธการคัดลอก — ลองใหม่อีกครั้ง'),
                            type: ok ? 'success' : 'error'
                          }),
                        );
                      }}
                      className="inline-flex items-center justify-center rounded-lg border border-blue-500/60 bg-blue-600/20 px-4 py-2 text-sm font-semibold text-blue-500 hover:bg-blue-600/30 transition-colors"
                    >
                      Copy chat id
                    </button>
                  </div>
                  <div className="text-xs text-blue-500/80 mt-3">
                    {t('pageui.hook.tg.negative_note', 'chat id (ค่านี้สามารถติดลบได้ไม่ใช่ข้อผิดพลาดหากพบว่ามีค่าติดลบ)')}
                  </div>
                </div>
              )}

              {searchMessage && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-2 text-amber-200">
                  <AlertTriangle size={18} className="mt-0.5" />
                  <span className="text-sm">{searchMessage}</span>
                </div>
              )}
            </form>
          )}

          <div className="border-t border-dark-700 pt-6">
            <h2 className="text-sm font-semibold text-slate-500 mb-3">Raw JSON</h2>
            <pre className="whitespace-pre-wrap text-xs text-slate-400 bg-dark-900 border border-dark-700 rounded-xl p-4 max-h-[360px] overflow-y-auto custom-scrollbar">
              {rawJson || '{\n  "ok": true,\n  "result": []\n}'}
            </pre>
          </div>
        </div>
      </div>

      <AlertModal
        isOpen={Boolean(alertState?.isOpen)}
        onClose={() => setAlertState(null)}
        title={alertState?.title || ''}
        message={alertState?.message || ''}
        type={alertState?.type || 'error'}
      />
    </div>
  );
};

export default TelegramChatIdAutomate;
