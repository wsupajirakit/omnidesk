import React, { useEffect, useMemo, useState } from 'react';
import { Hexagon, Lock, User, ArrowRight, Loader2, Globe } from 'lucide-react';
import { authService } from '../../services/admin';
import { AuthState } from '../../types';
import { useI18n } from '../../i18n';
// [FIX-20260801-THEMEBOOT] ใช้ตัวหาธีม/ทาธีมตัวเดียวกับ App (กันสองที่คิดไม่ตรงกัน)
import { resolveTheme, applyTheme } from '../../hooks/themePref';

interface LoginProps {
  onLogin: (authState: AuthState) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const { t, locale, setLocale } = useI18n();
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const cachedSiteName = useMemo(() => {
    if (typeof window === 'undefined') return 'dashboard';
    return localStorage.getItem('site_name')?.trim() || 'dashboard';
  }, []);

  useEffect(() => {
    document.title = cachedSiteName;
  }, [cachedSiteName]);

  // The login screen is designed dark-only (bg-dark-*/70 surfaces). Force the
  // theme-dark class while it's shown so it renders correctly even when the
  // stored theme is light, then restore the previous state on unmount.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-dark'); // the login screen is dark-only
    return () => {
      // THE "refresh reverts theme" ROOT CAUSE lived here: on every refresh the
      // app briefly renders <Login> (authState starts null), and this cleanup
      // blind-removed theme-dark when Login unmounted — wiping the user's dark
      // theme right after boot even though every cache/DB had saved it. Restore
      // the USER'S saved theme instead of blind-removing.
      // [FIX-20260801-THEMEBOOT] เดิมก๊อปตรรกะการหาธีมไว้ตรงนี้อีกชุด (localStorage
      // → zd_user_prefs) แยกจากของ App → พอ App แก้ทางเดียว สองที่จะหลุดจากกัน
      // ตอนนี้เรียก resolveTheme ตัวเดียวกับ App · และเคส "login ครั้งแรก" ที่ยัง
      // ไม่มีอะไรในเครื่องเลย App จะทาซ้ำให้เองหลัง unmount (deps มี authState)
      applyTheme(resolveTheme());
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const authState = await authService.login(username.trim(), password);
      onLogin(authState);
    } catch (err: any) {
      setError(err?.message || t('login.invalid_credentials'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0">
         <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-primary-600/10 blur-[100px]" />
         <div className="absolute bottom-[0%] right-[0%] w-[40%] h-[40%] rounded-full bg-primary-500/10 blur-[100px]" />
      </div>

      <div className="w-full max-w-md bg-dark-800/70 backdrop-blur-xl border border-dark-700 rounded-2xl shadow-2xl p-8 z-10 relative">
        
        <div className="flex flex-col items-center mb-8">
          <div className="bg-gradient-to-tr from-primary-500 to-primary-600 p-3 rounded-xl shadow-lg shadow-primary-500/20 mb-4">
             <Hexagon className="text-white" size={32} fill="currentColor" fillOpacity={0.3} />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">{cachedSiteName}</h2>
          <p className="text-slate-500 text-sm mt-1">{t('login.subtitle')}</p>
          <div className="flex items-center gap-2 mt-3">
            {/* [FIX-20260820-NOGUIDEONLOGIN] the user-manual button used to sit here.
                Owner's call 2026-08-20: the manual is reached from INSIDE the dashboard
                now (App.tsx keeps its button), so the page it opens can be put behind a
                login without breaking the one caller that had no session yet.
                คู่มือย้ายไปกดจากข้างใน ไม่ใช่หน้า login.
                revert: restore this button, the ConfirmModal, the
                `isUserManualConfirmOpen` state and the CircleHelp import. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsLanguageOpen(open => !open)}
                className="px-2.5 py-1.5 rounded-lg border border-dark-600 bg-dark-800 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-dark-700 transition-colors inline-flex items-center gap-1.5"
                title={t('app.language')}
                aria-expanded={isLanguageOpen}
                aria-haspopup="menu"
              >
                <Globe size={14} />
                {locale.toUpperCase()}
              </button>
              {isLanguageOpen && (
                <div className="absolute left-1/2 -translate-x-1/2 mt-2 w-32 rounded-lg border border-dark-600 bg-dark-800 shadow-lg overflow-hidden z-10">
                  <button
                    type="button"
                    onClick={() => {
                      setLocale('en');
                      setIsLanguageOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs font-medium transition-colors ${
                      locale === 'en'
                        ? 'bg-primary-500/10 text-primary-500'
                        : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                    }`}
                  >
                    <span className="mr-2">🇺🇸</span>EN
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLocale('th');
                      setIsLanguageOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs font-medium transition-colors ${
                      locale === 'th'
                        ? 'bg-primary-500/10 text-primary-500'
                        : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                    }`}
                  >
                    <span className="mr-2">🇹🇭</span>TH
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLocale('it');
                      setIsLanguageOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs font-medium transition-colors ${
                      locale === 'it'
                        ? 'bg-primary-500/10 text-primary-500'
                        : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                    }`}
                  >
                    <span className="mr-2">🇮🇹</span>IT
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLocale('zh');
                      setIsLanguageOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs font-medium transition-colors ${
                      locale === 'zh'
                        ? 'bg-primary-500/10 text-primary-500'
                        : 'text-slate-600 hover:bg-dark-700 hover:text-slate-900'
                    }`}
                  >
                    <span className="mr-2">🇨🇳</span>中文
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
             <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide ml-1">{t('login.username')}</label>
             <div className="relative group">
               <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                 <User className="text-slate-400 group-focus-within:text-primary-500 transition-colors" size={18} />
               </div>
               <input
                 type="text"
                 value={username}
                 onChange={(e) => setUsername(e.target.value)}
                 className="w-full bg-dark-800 border border-dark-600 rounded-xl py-3 pl-10 text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                 placeholder="admin"
               />
             </div>
          </div>

          <div className="flex flex-col gap-1">
             <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide ml-1">{t('login.password')}</label>
             <div className="relative group">
               <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                 <Lock className="text-slate-400 group-focus-within:text-primary-500 transition-colors" size={18} />
               </div>
               <input
                 type="password"
                 value={password}
                 onChange={(e) => setPassword(e.target.value)}
                 className="w-full bg-dark-800 border border-dark-600 rounded-xl py-3 pl-10 text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                 placeholder="••••••••••"
               />
             </div>
          </div>

          {error && (
            <div className="text-red-400 text-sm text-center bg-red-500/10 py-2 rounded-lg border border-red-500/20">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 text-white font-semibold py-3 rounded-xl shadow-lg shadow-primary-500/25 transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : (
              <>
                {t('login.sign_in')} <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
      </div>

    </div>
  );
};
