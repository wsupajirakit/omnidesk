import React, { useState, useEffect } from 'react';
import { X, Copy, Check, MousePointer2, ClipboardType, ChevronDown } from 'lucide-react';
import { useI18n } from '../../i18n';
import { copyText } from '../../utils/copyText';
import { readPath } from '../../utils/readPath';

interface DynamicTagPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  path: string;
  jsonContent: any;
  diffContent?: any;
  highlightPath?: string;
  isInline?: boolean;
}

interface JsonLine {
  text: string;
  path: string;
  isKey: boolean;
  isDiff?: boolean;
}

/**
 * [REFACTOR-20260905-READPATHTRUTH] exported (was module-private) so
 * test/readPathSingleTruth.test.ts can pin the invariant this file's
 * repoint to the shared `readPath` (utils/readPath.ts) relies on: a path is
 * only ever extended past a key whose value is a confirmed non-null object
 * (the `typeof value === 'object' && value !== null` check below), so no
 * path this function builds can traverse a falsy/primitive intermediate IN
 * THE SAME OBJECT it was built from. That invariant is what makes
 * handleCopyPath's repoint a no-observable-change move rather than an
 * assumption — see utils/readPath.ts's header for the full measurement.
 */
export function generateJsonLines(obj: any, path: string = '', indent: number = 0, diffObj?: any): JsonLine[] {
  const lines: JsonLine[] = [];
  const space = ' '.repeat(indent * 4);

  if (Array.isArray(obj)) {
    lines.push({ text: `${space}[`, path, isKey: false });
    obj.forEach((item, index) => {
      const currentPath = path ? `${path}.${index}` : `${index}`;
      const subLines = generateJsonLines(item, currentPath, indent + 1, diffObj);
      if (index < obj.length - 1) {
        subLines[subLines.length - 1].text += ',';
      }
      lines.push(...subLines);
    });
    lines.push({ text: `${space}]`, path, isKey: false });
  } else if (obj !== null && typeof obj === 'object') {
    lines.push({ text: `${space}{`, path, isKey: false });
    const keys = Object.keys(obj);
    keys.forEach((key, index) => {
      const value = obj[key];
      const currentPath = path ? `${path}.${key}` : key;
      /* [REFACTOR-20260905-READPATHTRUTH] diffObj is a DIFFERENT object than the
         one currentPath was built from, so unlike the handleCopyPath call below,
         this one is not covered by the generateJsonLines invariant. Reachable
         only when a caller passes `diffContent` — grep shows none do today, so
         this is a documented behaviour choice for unreached code, not a proven
         no-op like the other repoint. See utils/readPath.ts's header. */
      const diffValue = diffObj ? readPath(diffObj, currentPath) : undefined;
      const isDiff = diffObj !== undefined && JSON.stringify(value) !== JSON.stringify(diffValue);
      
      if (typeof value === 'object' && value !== null) {
        const subLines = generateJsonLines(value, currentPath, indent + 1, diffObj);
        subLines[0].text = `${space}    "${key}": ${subLines[0].text.trim()}`;
        subLines[0].isDiff = isDiff;
        if (index < keys.length - 1) {
          subLines[subLines.length - 1].text += ',';
        }
        lines.push(...subLines);
      } else {
        const displayedValue = typeof value === 'string' ? `"${value}"` : value;
        lines.push({ 
          text: `${space}    "${key}": ${displayedValue}${index < keys.length - 1 ? ',' : ''}`, 
          path: currentPath,
          isKey: true,
          isDiff: isDiff
        });
      }
    });
    lines.push({ text: `${space}}`, path, isKey: false });
  } else {
    lines.push({ text: `${space}${JSON.stringify(obj)}`, path, isKey: false, isDiff: diffObj !== undefined && JSON.stringify(obj) !== JSON.stringify(diffObj) });
  }
  return lines;
}

export const DynamicTagPreviewModal: React.FC<DynamicTagPreviewModalProps> = ({
  isOpen,
  onClose,
  title,
  path,
  jsonContent,
  diffContent,
  highlightPath,
  isInline = false
}) => {
  const { t } = useI18n();
  const [toast, setToast] = useState<{ message: string; path: string; value: string } | null>(null);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [showScrollArrow, setShowScrollArrow] = useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Define jsonLines early to avoid ReferenceError in useEffect
  const jsonLines = isOpen || isInline ? generateJsonLines(jsonContent, '', 0, diffContent) : [];

  const checkScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      setShowScrollArrow(scrollTop + clientHeight < scrollHeight - 20);
    }
  };

  useEffect(() => {
    const timer = setTimeout(checkScroll, 100);
    window.addEventListener('resize', checkScroll);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', checkScroll);
    };
  }, [isOpen, isInline, jsonLines.length]); // Use length instead of the object itself to avoid loops

  /* [REFACTOR-20260905-READPATHTRUTH] `p` here is always either `line.path`
     (only rendered/clickable when truthy — see the `{line.path && (...)}`
     guard below) or the top-level `path` prop, both of which were built by
     generateJsonLines walking THIS SAME `jsonContent` — so the invariant on
     that function guarantees no falsy/primitive intermediate can appear on
     the way back down. Repointing to the shared `readPath` here changes
     nothing observable; see utils/readPath.ts's header for the proof and
     test/readPathSingleTruth.test.ts for the pinned regression test. */

  /* [FIX-20260830-COPYHTTP2] `utils/copyText`, never `navigator.clipboard`
     directly: the Clipboard API exists only in a SECURE CONTEXT, and this
     dashboard is served over plain http — the call was a silent no-op while
     the success UI fired anyway. copyText falls back to execCommand and
     returns whether the copy really happened. */
  const handleCopyFull = async () => {
    if (!(await copyText(JSON.stringify(jsonContent, null, 4)))) return;
    setToast({ message: 'Full JSON Copied', path: 'Root', value: 'Entire object' });
    setTimeout(() => setToast(null), 3000);
  };

  const handleCopyPath = async (p: string) => {
    if (!(await copyText(p))) return;
    const val = readPath(jsonContent, p);
    const displayVal = typeof val === 'object' ? '...' : String(val);
    setToast({ message: 'Path Copied!', path: p, value: displayVal });
    setTimeout(() => setToast(null), 3000);
  };

  const content = (
    <div className={`${isInline ? 'flex-1 h-full' : 'bg-dark-800 w-full max-w-5xl rounded-2xl border border-dark-700 shadow-2xl max-h-[90vh] overflow-hidden'} flex flex-col relative`}>
      {/* Scroll Indicator Arrow */}
      {showScrollArrow && (
        <div className="absolute bottom-[20px] left-[64px] z-[55] pointer-events-none flex flex-col items-center animate-bounce">
          <div className="bg-primary-500 text-white p-1.5 rounded-full shadow-lg shadow-primary-500/50">
            <ChevronDown size={20} strokeWidth={3} />
          </div>
          <span className="text-[10px] font-black uppercase text-primary-500 mt-1 bg-white px-1.5 py-0.5 rounded shadow whitespace-nowrap">Scroll Down (JSON)</span>
        </div>
      )}

      {/* Enhanced Toast Notification */}
      {toast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[70] bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-6 duration-300 border border-emerald-400/30 backdrop-blur-md">
          <div className="bg-white/20 p-2 rounded-lg">
            <Check size={20} className="text-white" />
          </div>
          <div className="flex flex-col min-w-[200px]">
            <span className="text-sm font-black tracking-tight">{toast.message}</span>
            <div className="mt-1 space-y-0.5">
              <p className="text-[10px] font-mono opacity-90 truncate max-w-[250px]">
                <span className="opacity-60">Path:</span> {toast.path}
              </p>
              <p className="text-[10px] font-mono opacity-90 truncate max-w-[250px]">
                <span className="opacity-60">Value:</span> {toast.value}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between p-6 border-b border-dark-700">
        <div>
          <h3 className="text-xl font-bold text-slate-900">{title}</h3>
          <p className="text-sm text-slate-500 mt-1">Preview Path: <code className="bg-dark-900 px-2 py-0.5 rounded text-primary-700 font-bold">{path}</code></p>
        </div>
        {!isInline && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyFull}
              className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 transition-colors flex items-center gap-2 text-sm font-medium border border-dark-600 shadow-sm"
              title="Copy All JSON Data"
            >
              <Copy size={18} />
              {t('common.copy_full') || 'Copy Full'}
            </button>
            <button
              onClick={() => handleCopyPath(path)}
              className="p-2 rounded-lg bg-primary-600/10 text-primary-500 hover:bg-primary-600/20 transition-colors flex items-center gap-2 text-sm font-medium border border-primary-500/20 shadow-sm"
              title="Copy Root Path"
            >
              <MousePointer2 size={18} />
              Copy Path
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-red-500 transition-colors border border-dark-600"
            >
              <X size={20} />
            </button>
          </div>
        )}
        {isInline && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyFull}
              className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 transition-colors flex items-center gap-2 text-sm font-medium border border-dark-600"
            >
              <Copy size={18} />
              Copy Full
            </button>
            <button
              onClick={() => handleCopyPath(path)}
              className="p-2 rounded-lg bg-primary-600/10 text-primary-500 hover:bg-primary-600/20 transition-colors flex items-center gap-2 text-sm font-medium border border-primary-500/20"
            >
              <MousePointer2 size={18} />
              Path
            </button>
          </div>
        )}
      </div>

      {/* Path Status Bar */}
      <div className="px-6 py-2 bg-dark-900 border-b border-dark-700 flex items-center gap-2 min-h-[40px]">
        <MousePointer2 size={14} className="text-primary-500" />
        <span className="text-xs font-mono text-slate-400">Path: </span>
        <span className="text-xs font-mono text-primary-400 font-bold truncate">
          {hoveredPath || 'Hover over a line to see JSON path'}
        </span>
      </div>

      <div 
        ref={scrollRef}
        onScroll={checkScroll}
        className="flex-1 overflow-auto bg-white large-scrollbar font-mono text-sm min-h-0 pr-12"
      >
        <div className="inline-min-w-full">
          {jsonLines.map((line, i) => (
            <div
              key={i}
              onMouseEnter={() => line.path && setHoveredPath(line.path)}
              onMouseLeave={() => setHoveredPath(null)}
              className={`group flex transition-colors py-0.5 relative ${
                line.isDiff ? 'bg-orange-50/50' : 
                line.path && highlightPath && (line.path === highlightPath || highlightPath.startsWith(line.path + '.')) ? 'bg-primary-50/80 shadow-inner' :
                'hover:bg-emerald-100/90'
              }`}
            >
              <div className="w-12 pr-4 text-slate-400 text-right select-none border-r border-slate-200 shrink-0 bg-slate-50">
                {i + 1}
              </div>
              <div className="flex-1 pl-4 text-black whitespace-pre pr-32">
                {line.text}
              </div>
              {line.path && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1">
                  <button
                    onClick={() => handleCopyPath(line.path)}
                    className="p-1.5 rounded bg-white border border-slate-200 shadow-sm transition-all flex items-center gap-2 text-[11px] font-bold text-primary-600 hover:bg-primary-50"
                  >
                    <MousePointer2 size={12} />
                    Copy Path
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {!isInline && (
        <div className="p-4 border-t border-dark-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-xl bg-dark-700 hover:bg-dark-600 text-slate-900 text-sm font-bold transition-all"
          >
            {t('common.close')}
          </button>
        </div>
      )}
    </div>
  );

  if (isInline) return content;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-dark-900/60 backdrop-blur-sm">
      {content}
    </div>
  );
};
