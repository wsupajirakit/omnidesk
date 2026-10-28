import React from 'react';
import { X, Smartphone, Info, AlertTriangle, ExternalLink, Copy, Check } from 'lucide-react';
import { useI18n } from '../../i18n';
import { FlexBubble, canRenderFlex } from '../chat/FlexBubble';
import { copyText } from '../../utils/copyText';

/**
 * [FEAT-20260809-FLEXRENDER] Designer preview switch — mirrors the one in FlexSlipCard.tsx.
 *
 * Kept as a separate constant (not a shared import) on purpose: the chat room and the
 * designer preview can be rolled back INDEPENDENTLY if only one of them misbehaves.
 *
 * true  → preview through <FlexBubble/>, so the designer sees exactly what LINE renders
 *         and exactly what the chat room shows (same component, one source of truth).
 * false → legacy renderItem() below, i.e. the exact pre-2026-08-09 preview.
 * revert: flip to false. renderItem() is untouched and still wired to the else-branch.
 * เปลี่ยนเป็น false = กลับไปพรีวิวแบบเดิมทันที ตัวเดิมยังอยู่ครบ.
 */
const USE_FLEX_RENDER = true;

interface FlexPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  flexJson: any;
  replacements?: Record<string, string>;
}

export const FlexPreviewModal: React.FC<FlexPreviewModalProps> = ({ isOpen, onClose, flexJson, replacements = {} }) => {
  const { t } = useI18n();
  const [hasAcceptedWarning, setHasAcceptedWarning] = React.useState(false);
  const [showToast, setShowToast] = React.useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setHasAcceptedWarning(false);
      setShowToast(false);
    }
  }, [isOpen]);

  if (!isOpen || !flexJson) return null;

  // Replacement helper that handles both {{tag}} and tag
  const processValue = (val: any) => {
    if (typeof val !== 'string') return val;
    let result = val;
    
    // 1. Precise match first (e.g. "status_text" matches exactly)
    Object.entries(replacements).forEach(([key, value]) => {
      const pureKey = key.replace(/[{}]/g, '');
      const strValue = String(value);
      if (result === pureKey) {
        result = strValue;
      }
    });

    // 2. Substring replacements (e.g. "B {{amount}}" -> "B 1,500.00")
    Object.entries(replacements).forEach(([key, value]) => {
      const strValue = String(value);
      result = result.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), strValue);
      // Also try replacing without braces if it's found as a substring
      const pureKey = key.replace(/[{}]/g, '');
      result = result.replace(new RegExp(pureKey, 'g'), strValue);
    });

    // 3. Resolve relative URLs to absolute if it looks like an asset path
    if (result.startsWith('/')) {
      result = window.location.origin + result;
    }

    return result;
  };

  const handleCopyJson = async () => {
    const processObject = (obj: any): any => {
      if (Array.isArray(obj)) {
        return obj.map(item => processObject(item));
      } else if (obj !== null && typeof obj === 'object') {
        const next: any = {};
        Object.keys(obj).forEach(key => {
          next[key] = processObject(obj[key]);
        });
        return next;
      }
      return processValue(obj);
    };

    const processedJson = processObject(flexJson);
    const jsonStr = JSON.stringify(processedJson, null, 2);
    // [FIX-20260830-COPYHTTP2] the toast waits for a copy that really happened
    if (!(await copyText(jsonStr))) return;
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  };

  const renderItem = (item: any, index: number): React.ReactNode => {
    if (!item) return null;

    switch (item.type) {
      case 'box':
        const boxStyles: React.CSSProperties = {
          display: 'flex',
          flexDirection: item.layout === 'vertical' ? 'column' : 'row',
          padding: item.paddingAll || item.paddingTop || item.paddingBottom || item.paddingStart || item.paddingEnd || 0,
          backgroundColor: item.backgroundColor,
          width: item.width || 'auto',
          height: item.height || 'auto',
          flex: item.flex !== undefined ? item.flex : 0,
          alignItems: item.align === 'center' ? 'center' : item.align === 'end' ? 'flex-end' : 'stretch',
          justifyContent: item.justifyContent === 'center' ? 'center' : item.justifyContent === 'flex-end' ? 'flex-end' : 'flex-start',
          gap: item.spacing === 'md' ? '8px' : item.spacing === 'sm' ? '4px' : '0px',
          borderRadius: item.cornerRadius || '0px',
          marginTop: item.margin === 'md' ? '8px' : item.margin === 'lg' ? '12px' : item.margin === 'xl' ? '16px' : item.margin === 'xxl' ? '24px' : '0'
        };
        return (
          <div key={index} style={boxStyles}>
            {item.contents?.map((child: any, idx: number) => renderItem(child, idx))}
          </div>
        );

      case 'text':
        const fontSizeMap: any = { 
          xxs: '11px', 
          xs: '13px', 
          sm: '15px', 
          md: '17px', 
          lg: '20px', 
          xl: '24px', 
          xxl: '30px' 
        };
        const textStyles: React.CSSProperties = {
          color: item.color || '#333',
          fontSize: fontSizeMap[item.size] || '14px',
          fontWeight: item.weight === 'bold' ? 'bold' : 'normal',
          textAlign: item.align as any || 'left',
          flex: item.flex !== undefined ? item.flex : 0,
          marginTop: item.margin === 'md' ? '4px' : '0',
          alignSelf: item.gravity === 'center' ? 'center' : 'auto',
          lineHeight: '1.4'
        };
        return (
          <div key={index} style={textStyles}>
            {processValue(item.text)}
          </div>
        );

      case 'image':
        const imgUrl = processValue(item.url);
        
        const sizeMap: any = { 
          xxs: '32px', 
          xs: '48px', 
          sm: '64px', 
          md: '80px', 
          lg: '110px', 
          xl: '140px', 
          xxl: '180px' 
        };
        const imgSize = sizeMap[item.size] || (item.size && item.size.endsWith('px') ? item.size : '80px');

        return (
          <div 
            key={index} 
            style={{ 
              display: 'flex',
              flex: item.flex !== undefined ? item.flex : 0,
              justifyContent: item.align === 'center' ? 'center' : item.align === 'end' ? 'flex-end' : 'flex-start',
              alignItems: item.gravity === 'center' ? 'center' : 'flex-start',
              marginTop: item.margin === 'md' ? '8px' : '0'
            }}
          >
            <img
              src={imgUrl || '/blank.png'}
              alt="flex item"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = '/blank.png';
              }}
              style={{
                width: imgSize,
                maxWidth: '100%',
                height: 'auto',
                aspectRatio: item.aspectRatio || '1/1',
                objectFit: item.aspectMode === 'cover' ? 'cover' : 'contain',
                backgroundColor: 'transparent'
              }}
            />
          </div>
        );

      case 'spacer':
        const spacerSize: any = { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px', xxl: '32px' };
        return <div key={index} style={{ height: spacerSize[item.size] || '8px', width: '100%' }} />;

      case 'separator':
        return <div key={index} style={{ height: '1px', width: '100%', backgroundColor: item.color || '#eeeeee', margin: '12px 0' }} />;

      default:
        return null;
    }
  };

  const getBubbleWidth = (size?: string) => {
    switch (size) {
      case 'nano': return '120px';
      case 'micro': return '160px';
      case 'kilo': return '260px';
      case 'mega': return '300px';
      case 'giga': return '350px';
      default: return '300px';
    }
  };

  const bubble = flexJson.type === 'bubble' ? flexJson : (flexJson.contents?.[0] || flexJson);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity">
      <div 
        className="w-full max-w-2xl bg-slate-100 rounded-[2rem] shadow-2xl overflow-hidden flex flex-col h-[85vh] border-[8px] border-slate-900 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Speaker Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-8 bg-slate-900 rounded-b-3xl z-50 flex items-center justify-center">
            <div className="w-12 h-1.5 bg-slate-800 rounded-full mb-1"></div>
        </div>

        <div className="flex items-center justify-between px-8 py-5 border-b border-slate-200 bg-white pt-10">
          <div className="flex items-center gap-2">
            <Smartphone size={18} className="text-secondary-500" />
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-tighter">LINE Simulator</h3>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleCopyJson}
              className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-dark-600 bg-white text-slate-700 hover:bg-slate-50 transition-all text-sm font-bold shadow-sm"
              title={t('common.copy_json_preview')}
            >
              {showToast ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
              <span>{showToast ? t('common.copied_title') : t('common.copy_json_preview')}</span>
            </button>
            <button 
              onClick={onClose} 
              className="flex items-center gap-2 px-4 py-1.5 rounded-full border-2 border-blue-500 text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition-all text-sm font-bold shadow-sm"
            >
              <span>Close</span>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col items-center bg-[#ebebed] custom-scrollbar relative">
          {!hasAcceptedWarning && (
            <div className="absolute inset-0 z-[60] bg-slate-900/95 backdrop-blur-md flex items-center justify-center p-6 text-center">
              <div className="flex flex-col items-center gap-6 max-w-md animation-slide-up">
                <div className="w-20 h-20 bg-orange-500/20 rounded-full flex items-center justify-center border border-orange-500/30">
                  <AlertTriangle size={40} className="text-orange-500" />
                </div>
                
                <div className="space-y-3">
                  <h4 className="text-xl font-bold text-white tracking-tight">
                    {t('flex.simulator_warning_title')}
                  </h4>
                  <p className="text-[15px] text-slate-300 leading-relaxed font-medium whitespace-pre-line px-2">
                    {t('flex.simulator_warning_desc')}
                  </p>
                </div>

                <div className="w-full space-y-3">
                  <a 
                    href="https://developers.line.biz/flex-simulator/" 
                    target="_blank" 
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white text-xs font-bold transition-all"
                  >
                    <ExternalLink size={14} />
                    {t('flex.simulator_link_label')}
                  </a>
                  
                  <button 
                    onClick={() => setHasAcceptedWarning(true)}
                    className="w-full py-4 bg-primary-600 hover:bg-primary-500 text-white rounded-xl font-black text-sm shadow-xl shadow-primary-500/30 transition-all uppercase tracking-widest"
                  >
                    {t('common.i_understand')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Flex Bubble Container */}
          {USE_FLEX_RENDER && canRenderFlex(flexJson) ? (
            /* [FEAT-20260809-FLEXRENDER] Spec-accurate preview. Feeds the WHOLE flexJson
               (not `bubble`) so a carousel previews every card — line 196 unwraps to
               contents[0], which is exactly why designers saw only the first one. */
            <div className="w-full mb-4 overflow-x-auto">
              <FlexBubble json={flexJson} />
            </div>
          ) : (
          <div
            className="w-full rounded-2xl overflow-hidden shadow-sm bg-white flex flex-col mb-4"
            style={{
               maxWidth: getBubbleWidth(bubble.size),
               boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
            }}
          >
             {/* Header */}
             {bubble.header && renderItem(bubble.header, 999)}


             {/* Hero */}
             {bubble.hero && renderItem(bubble.hero, 888)}

             {/* Body */}
             {bubble.body && (
               <div style={{ paddingBottom: '20px' }}>
                 {renderItem(bubble.body, 777)}
               </div>
             )}

             {/* Footer */}
             {bubble.footer && renderItem(bubble.footer, 666)}
          </div>
          )}
          
          <div className="flex items-start gap-2 max-w-md p-4 bg-white/50 border border-slate-200 rounded-2xl shadow-sm italic font-medium mt-auto">
             <Info size={14} className="text-secondary-500 shrink-0 mt-0.5" />
             <p className="text-[10px] text-slate-500 leading-normal">
                {t('pageui.flex.preview_note', 'จำลองการแสดงผลเพื่อตรวจสอบความถูกต้องของข้อมูลและโครงสร้างเบื้องต้น')}
             </p>
          </div>
        </div>

        {/* Home Bar */}
        <div className="h-6 bg-white flex justify-center items-center pb-2">
            <div className="w-32 h-1.5 bg-slate-200 rounded-full"></div>
        </div>
      </div>
    </div>
  );
};
