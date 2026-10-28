import React, { useEffect, useState } from 'react';
import { ChatMessage } from '../../services/chat';
import { flexMessageService } from '../../services/media';

/** [FEAT-20260817-ADMINBTNLINK] Where a card button takes the ADMIN (never the
 *  customer). One constant so the destination is changed in exactly one place. */
const ADMIN_BUTTON_LINK = 'https://google.com';
import { FlexBubble, canRenderFlex } from './FlexBubble';

/**
 * [FEAT-20260809-FLEXRENDER] Master switch: spec-accurate renderer vs. legacy renderer.
 *
 * true  → render through <FlexBubble/> (flex-render + DOMPurify), which follows the
 *         official LINE Flex layout spec. Fixes 16 real templates in `flex_messages`
 *         that render wrong under the legacy path — chiefly layout:"baseline" (413 uses),
 *         spacing xs/xl/xxl (148), bubble.styles (36) and carousel (11, where only the
 *         first bubble was ever drawn).
 * false → fall back to renderFlexNode() below, i.e. the exact pre-2026-08-09 behaviour.
 *
 * revert: flip this to false. The legacy renderer is kept intact in this file on purpose —
 *         nothing was deleted — so the rollback is one boolean, no code restore needed.
 *         Do the same in FlexPreviewModal.tsx to roll back the designer preview too.
 * เปลี่ยนเป็น false = กลับไปใช้ตัวเดิมทันที โค้ดเดิมยังอยู่ครบ ไม่ได้ลบ.
 */
const USE_FLEX_RENDER = true;

interface FlexSlipCardProps {
  msg: ChatMessage;
}

// ── Shared Cache for Flex Templates to prevent duplicate API requests ─────────────
let cachedTemplates: any[] | null = null;
let templateFetchPromise: Promise<any[]> | null = null;

const getFlexTemplates = async (): Promise<any[]> => {
  if (cachedTemplates) return cachedTemplates;
  if (templateFetchPromise) return templateFetchPromise;

  templateFetchPromise = flexMessageService.listFlexMessages({ limit: 100 })
    .then(res => {
      cachedTemplates = res.data || [];
      return cachedTemplates;
    })
    .catch(err => {
      console.error('[FlexSlipCard] Failed to fetch flex templates:', err);
      return [];
    });

  return templateFetchPromise;
};

const isWhiteColor = (color?: string): boolean => {
  if (!color) return false;
  const c = color.toLowerCase().trim();
  return c === '#fff' || c === '#ffffff' || c === 'white' || c.startsWith('rgba(255,255,255') || c.startsWith('rgb(255,255,255');
};

// Helper to check if a color is a bright signal color (like Red / Green warnings)
const isSignalColor = (color?: string): boolean => {
  if (!color) return false;
  const c = color.toLowerCase().trim();
  if (c.includes('red') || c.includes('green') || c.includes('orange') || c.includes('purple')) return true;
  if (c.startsWith('#')) {
    const hex = c.replace('#', '');
    let r = 0, g = 0, b = 0;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    }
    // High red (warning/danger note) or high green (success)
    if (r > 180 && g < 100 && b < 100) return true;
    if (g > 160 && r < 100) return true;
  }
  return false;
};

const isDarkOrMutedColor = (color?: string): boolean => {
  if (!color) return true;
  const c = color.toLowerCase().trim();
  if (c === '#2b4263' || c === '#1e293b' || c === '#334155' || c === '#475569' || c === '#64748b' || c === '#333333' || c === '#111111' || c === '#000000' || c === 'black') return true;
  if (c.startsWith('#')) {
    const hex = c.replace('#', '');
    let r = 0, g = 0, b = 0;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    }
    // Dark or muted blue, slate, grey, black
    if (r < 140 && g < 140 && b < 160) return true;
  }
  return false;
};

// ── Full LINE Flex Message JSON Renderer Component ─────────────────────────────
const renderFlexNode = (item: any, index: number): React.ReactNode => {
  if (!item) return null;

  switch (item.type) {
    case 'box': {
      const boxStyles: React.CSSProperties = {
        display: 'flex',
        flexDirection: item.layout === 'vertical' ? 'column' : 'row',
        padding: item.paddingAll || item.paddingTop || item.paddingBottom || item.paddingStart || item.paddingEnd || 0,
        backgroundColor: item.backgroundColor,
        width: item.width || 'auto',
        height: item.height || 'auto',
        flex: item.flex !== undefined ? item.flex : undefined,
        alignItems: item.align === 'center' ? 'center' : item.align === 'end' ? 'flex-end' : 'stretch',
        justifyContent: item.justifyContent === 'center' ? 'center' : item.justifyContent === 'flex-end' ? 'flex-end' : item.justifyContent === 'space-between' ? 'space-between' : 'flex-start',
        gap: item.spacing === 'md' ? '8px' : item.spacing === 'sm' ? '4px' : item.spacing === 'lg' ? '12px' : '0px',
        borderRadius: item.cornerRadius || '0px',
        marginTop: item.margin === 'md' ? '8px' : item.margin === 'lg' ? '12px' : item.margin === 'xl' ? '16px' : item.margin === 'xxl' ? '24px' : '0',
        borderWidth: item.borderWidth ? item.borderWidth : undefined,
        borderColor: item.borderColor ? item.borderColor : undefined,
        borderStyle: item.borderColor ? 'solid' : undefined,
      };
      return (
        <div key={index} style={boxStyles}>
          {item.contents?.map((child: any, idx: number) => renderFlexNode(child, idx))}
        </div>
      );
    }

    case 'text': {
      const fontSizeMap: Record<string, string> = { 
        xxs: '10px', 
        xs: '12px', 
        sm: '13px', 
        md: '14px', 
        lg: '16px', 
        xl: '18px', 
        xxl: '22px' 
      };

      const isExplicitWhite = isWhiteColor(item.color);
      const isLargeHeader = item.size === 'xl' || item.size === 'xxl' || (item.weight === 'bold' && item.size === 'lg');
      const hasSignalColor = isSignalColor(item.color);
      const isDarkColor = isDarkOrMutedColor(item.color);

      // If text is white or large header title, force white (#FFFFFF) in inline style.
      // If text is red/green signal warning, force signal color in inline style.
      // If text has dark/muted color (like #2b4263 for person names) or no color, DO NOT set inline color style!
      // Instead, apply Tailwind class 'text-slate-800 dark:text-white dark:font-medium' so in Dark Theme it renders 100% PURE WHITE!
      const textColor = (isExplicitWhite || isLargeHeader) 
        ? '#FFFFFF' 
        : hasSignalColor 
        ? item.color 
        : (!isDarkColor ? item.color : undefined);

      const textStyles: React.CSSProperties = {
        color: textColor,
        fontSize: fontSizeMap[item.size] || (item.size && item.size.endsWith('px') ? item.size : '13px'),
        fontWeight: item.weight === 'bold' ? 'bold' : 'normal',
        textAlign: item.align as any || 'left',
        flex: item.flex !== undefined ? item.flex : undefined,
        marginTop: item.margin === 'md' ? '4px' : item.margin === 'sm' ? '2px' : '0',
        alignSelf: item.gravity === 'center' ? 'center' : 'auto',
        lineHeight: '1.4',
        wordBreak: 'break-word',
        overflowWrap: 'break-word',
        whiteSpace: 'normal', // Ensure long names wrap neatly without overflowing right border
        maxWidth: '100%',
        paddingRight: '2px',
      };

      return (
        <div 
          key={index} 
          style={textStyles} 
          className={!textColor ? 'text-slate-800 dark:text-white dark:font-medium' : undefined}
        >
          {item.text}
        </div>
      );
    }

    case 'image': {
      const isBankLogo = item.url && (item.url.includes('/banks/') || item.url.includes('bank') || item.url.includes('KBANK') || item.url.includes('SCB') || item.url.includes('BBL') || item.url.includes('KTB') || item.url.includes('TTB'));
      const sizeMap: Record<string, string> = { 
        xxs: isBankLogo ? '44px' : '36px', 
        xs: isBankLogo ? '48px' : '48px', 
        sm: isBankLogo ? '54px' : '64px', 
        md: '88px', 
        lg: '120px', 
        xl: '150px', 
        xxl: '200px',
        full: '100%'
      };
      const imgSize = sizeMap[item.size] || (item.size && item.size.endsWith('px') ? item.size : (isBankLogo ? '48px' : '80px'));

      return (
        <div 
          key={index} 
          style={{ 
            display: 'flex',
            flex: item.flex !== undefined ? item.flex : undefined,
            justifyContent: item.align === 'center' ? 'center' : item.align === 'end' ? 'flex-end' : 'flex-start',
            alignItems: item.gravity === 'center' ? 'center' : 'flex-start',
            marginTop: item.margin === 'md' ? '8px' : '0',
            width: item.size === 'full' ? '100%' : 'auto',
            paddingLeft: isBankLogo ? '4px' : '0',
            paddingRight: isBankLogo ? '4px' : '0',
            minWidth: isBankLogo ? '48px' : 'auto'
          }}
        >
          <img
            src={item.url || '/blank.png'}
            alt="flex item"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
            className={isBankLogo ? 'rounded-full shadow-md border border-white/30' : ''}
            style={{
              width: imgSize,
              height: isBankLogo ? imgSize : 'auto',
              minWidth: isBankLogo ? imgSize : undefined,
              minHeight: isBankLogo ? imgSize : undefined,
              maxWidth: '100%',
              aspectRatio: item.aspectRatio || (isBankLogo ? '1/1' : 'auto'),
              objectFit: isBankLogo ? 'cover' : (item.aspectMode === 'cover' ? 'cover' : 'contain'),
              backgroundColor: isBankLogo ? '#FFFFFF' : 'transparent',
              flexShrink: 0
            }}
          />
        </div>
      );
    }

    case 'button': {
      const isPrimary = item.style === 'primary';
      const isSecondary = item.style === 'secondary';
      return (
        <div key={index} style={{ marginTop: item.margin === 'md' ? '8px' : item.margin === 'lg' ? '12px' : '4px', flex: item.flex !== undefined ? item.flex : undefined }}>
          <button
            type="button"
            className={`w-full py-2 px-3 rounded-xl font-bold text-xs transition-all ${
              isPrimary
                ? 'bg-primary-600 hover:bg-primary-500 text-white shadow-sm'
                : isSecondary
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200'
                : 'text-primary-600 hover:underline'
            }`}
            style={{ backgroundColor: item.color || undefined }}
            onClick={() => {
              if (item.action?.type === 'uri' && item.action?.uri) {
                window.open(item.action.uri, '_blank');
              }
            }}
          >
            {item.action?.label || 'Action'}
          </button>
        </div>
      );
    }

    case 'separator':
      return <div key={index} style={{ height: '1px', width: '100%', backgroundColor: item.color || 'rgba(226, 232, 240, 0.6)', margin: '8px 0' }} />;

    case 'spacer': {
      const spacerSize: Record<string, string> = { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px', xxl: '32px' };
      return <div key={index} style={{ height: spacerSize[item.size] || '8px', width: '100%' }} />;
    }

    case 'icon': {
      const iconSizeMap: Record<string, string> = {
        xxs: '36px',
        xs: '44px',
        sm: '48px',
        md: '52px',
        lg: '60px',
        xl: '68px',
        xxl: '76px'
      };
      const iconSize = iconSizeMap[item.size] || (item.size && item.size.endsWith('px') ? item.size : '48px');
      return (
        <div style={{ paddingLeft: '4px', paddingRight: '4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <img
            key={index}
            src={item.url}
            alt="icon"
            className="rounded-full shadow-md border border-white/30 object-cover flex-shrink-0 bg-white"
            style={{ width: iconSize, height: iconSize, minWidth: iconSize, minHeight: iconSize, display: 'inline-block' }}
          />
        </div>
      );
    }

    default:
      return null;
  }
};

const getBubbleWidth = (size?: string) => {
  switch (size) {
    case 'nano': return '200px';
    case 'micro': return '240px';
    case 'kilo': return '300px';
    case 'mega': return '360px';
    case 'giga': return '380px';
    default: return '360px';
  }
};

const formatThaiDateTime = (dateInput?: any) => {
  if (!dateInput) return '';
  const now = new Date(dateInput);
  if (isNaN(now.getTime())) return String(dateInput);
  const weekday = now.toLocaleDateString("th-TH", { weekday: "long", timeZone: "Asia/Bangkok" });
  const day = now.toLocaleDateString("th-TH", { day: "2-digit", timeZone: "Asia/Bangkok" });
  const month = now.toLocaleDateString("th-TH", { month: "long", timeZone: "Asia/Bangkok" });
  // [FIX-20260729-TICKETTYPE] was `toLocaleString(...) * 1 + 543` — multiplying a
  // string by 1 works at runtime but TS rejects it. Number() says the same thing
  // and the output is byte-identical (Gregorian year -> 2-digit Buddhist year).
  const yearBE = (Number(now.toLocaleString("en-US", { year: "numeric", timeZone: "Asia/Bangkok" })) + 543).toString().slice(-2);
  const timeStr = now.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Bangkok"
  });
  return `${weekday}ที่ ${day} ${month} ${yearBE} ${timeStr}`;
};

export const FlexSlipCard: React.FC<FlexSlipCardProps> = ({ msg }) => {
  /* [UI-20260826-FLEXHUGRIGHT] เจ้าของแจ้ง: "bubble flex มันออกห่างจากขวาเกินไป"
     ต้นเหตุ: แถวของบอทเป็น `justify-end` ก็จริง แต่กล่องครอบใน `ChatRoomView`
     เป็น `max-w-[75%] w-fit` ส่วนการ์ดนี้ถูก cap ไว้ที่ `max-w-[380px]`
     ⇒ เมื่อกล่องครอบกว้างกว่า 380px การ์ดซึ่งเป็น block จะเกาะ **ซ้าย**
       ของกล่อง เหลือช่องว่างโบ๋ทางขวา (`text-right` บนกล่องครอบขยับได้เฉพาะ
       inline content ไม่ขยับ block ลูก)
     ⇒ `ml-auto` คือคู่ของ block กับ `text-right` — ดันการ์ดไปชิดขวาของกล่องครอบ

     🔴 รอบแก้ที่ 2 (เจ้าของแจ้งว่า "flex ยังไม่ชิดขวา"): `ml-auto` อย่างเดียวไม่พอ
        เพราะรากเดิมเป็น `w-full` = `width:100%` ⇒ กล่อง **กางเต็มพื้นที่ของกล่องครอบ**
        ส่วน bubble ข้างในความกว้างมาจากไลบรารี `flex-render` เอง (ไม่ใช่ 380px เสมอ)
        ⇒ กล่องกว้างกว่าการ์ด แล้ว margin auto ก็ไม่มีที่ว่างให้ดัน — เห็นเป็นช่องโบ๋เท่าเดิม
        ⇒ เปลี่ยนเป็น `w-fit` ให้กล่อง **หดพอดีการ์ด** แล้ว `ml-auto` จึงดันได้จริง
        (`w-full` ไม่ได้ให้ประโยชน์อะไรที่นี่ เพราะมี `max-w-[380px]` คุมอยู่แล้ว)

     ⚠️ เฉพาะฝั่งที่ไม่ใช่ลูกค้าเท่านั้น · การ์ดฝั่งลูกค้าต้องเกาะซ้ายเหมือนเดิม
        ถ้าใส่ไม่มีเงื่อนไข การ์ดฝั่งลูกค้าจะกระเด็นไปขวาทั้งที่ควรอยู่ซ้าย
     ⚠️ ไม่แตะความกว้าง (`max-w-[380px]`) — เจ้าของขอให้ชิดขวา ไม่ได้ขอให้ใหญ่ขึ้น
     revert: ลบตัวแปรนี้และ `${hugRight}` ทั้งสองจุด */
  /* 🔴 รอบแก้ที่ 4 — วัดได้แล้วว่าทำไมสามรอบก่อนไม่ได้ผล (เลิกเดา)
     ─────────────────────────────────────────────────────────────────────────
     รัน `flex-render` จริงแล้วอ่าน HTML ที่มันปล่อย: **ไม่มี inline width เลย**
     มันปล่อย `<div class="flex-preview">` แล้วความกว้างมาจาก stylesheet ของไลบรารี
       · `node_modules/flex-render/dist/index.css` → `.LyMe { max-width: 300px }`
       · `.T1 { width: auto }`  ⇒ ตัว bubble เป็น **block กางเต็มกล่อง แต่ไม่เกิน 300px**
     ส่วนกล่องนอกของเราเป็น `max-w-[380px]`
     ⇒ กล่อง 380px มี bubble 300px นั่งชิดซ้าย **เหลือช่องว่างขวา 80px**
       (ตรงกับระยะที่วัดจากภาพที่เจ้าของส่งมาพอดี)

     ทำไม `ml-auto` (รอบ 1) และ `w-fit` (รอบ 2,3) ไม่ช่วย:
       `.flex-preview` เป็น block `width:auto` ⇒ มันกางเต็มกล่องเสมอ
       กล่องนอกจึงไม่เคย "หด" ตาม bubble และ margin auto ก็ไม่มีที่ว่างให้ดัน
     ⇒ ทางที่ได้ผลคือทำกล่องนอกเป็น **flex container** แล้ว `justify-end`
       flex item จะหดตาม content (300px) แล้วถูกดันไปชิดขวา ไม่ว่ากล่องจะกว้างเท่าไหร่

     ⚠️ ต้องมี `flex` ด้วยเสมอ ใส่แค่ `justify-end` เฉย ๆ ไม่มีผลกับ block
     ⚠️ ฝั่งลูกค้าใช้ `justify-start` ⇒ ชิดซ้ายเหมือนเดิมทุกประการ
     revert: เปลี่ยนกลับเป็น '' / 'ml-auto' แล้วลบ `flex` ออกจากรากทั้งสอง */
  /* 🔴 รอบ 5 — `justify-end` ที่กล่องนอกยังไม่พอ เพราะช่องว่างอยู่ **ลึกกว่านั้นอีกชั้น**
     `.flex-preview` (ราก HTML ที่ไลบรารีปล่อยมา) กางเต็มกล่อง แล้ว `.LyMe` ที่ถูก
     `max-width:300px` คุมไว้ก็นั่งชิดซ้ายอยู่ข้างใน `.flex-preview` อีกที
     ⇒ ต้องมีกฎ CSS เจาะเข้าไปถึง `.flex-preview` ด้วย — อยู่ที่ `index.css`
       ใต้แท็ก [UI-20260826-FLEXHUGRIGHT] · คลาสนี้คือตัวเปิดกฎนั้น
     ⚠️ คลาสฝั่ง React (`flex justify-end`) **ยังต้องอยู่** — มันจัดตำแหน่งชั้นนอก
        ส่วนกฎ CSS จัดชั้นใน ทั้งสองอันทำคนละหน้าที่ ขาดตัวใดตัวหนึ่งก็ยังเหลือช่องว่าง */
  const hugRight = msg.sender_type === 'customer'
    ? 'flex justify-start'
    : 'flex justify-end tc-flex-right';
  const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
  const metadata = msg.metadata || {};
  const [resolvedFlex, setResolvedFlex] = useState<any>(metadata.flex_json || null);

  const verifyResult = metadata.slip_verify_result || metadata.slip_data || null;

  // Extract title & code
  let flexTitle = contentStr;
  let flexCode = '';
  const match = contentStr.match(/\[Flex(?:-Error)?\]\s*([^(]+)(?:\(([^)]+)\))?/i);
  if (match) {
    flexCode = match[1]?.trim() || '';
    flexTitle = match[2]?.trim() || match[1]?.trim() || contentStr;
  }

  useEffect(() => {
    if (metadata.flex_json) {
      setResolvedFlex(metadata.flex_json);
      return;
    }

    let isMounted = true;
    getFlexTemplates().then(templates => {
      if (!isMounted) return;
      
      const flexName = flexCode.toLowerCase().trim();
      const flexLabel = flexTitle.toLowerCase().trim();
      const matchedTpl = templates.find(t => {
        const tName = (t.name || '').toLowerCase().trim();
        const tId = String(t._id || t.id || '');
        const docId = String(metadata.flex_doc_id || '');
        return (tId && docId && tId === docId) ||
               (tName && (tName === flexName || tName === flexLabel || (flexName && tName.includes(flexName)) || (flexLabel && tName.includes(flexLabel))));
      });

      if (matchedTpl && matchedTpl.content_json) {
        let flexString = JSON.stringify(matchedTpl.content_json);
        const createdTime = formatThaiDateTime(msg.created_at);

        const tagMap: Record<string, string> = {
          amount: verifyResult?.amount || '',
          slip_date: verifyResult?.slip_date || '',
          date_on_slip: verifyResult?.date_on_slip || verifyResult?.slip_date || '',
          check_datetime: createdTime || verifyResult?.check_datetime || '',
          current_datetime: createdTime || verifyResult?.current_datetime || '',
          trans_ref: verifyResult?.trans_ref || '',
          sender_bank_name: verifyResult?.sender_bank_name || verifyResult?.sender?.bank_name || '',
          sender_name: verifyResult?.sender_name || verifyResult?.sender?.account_name || '',
          sender_acc_no: verifyResult?.sender_acc_no || verifyResult?.sender?.account_no || '',
          receiver_bank_name: verifyResult?.receiver_bank_name || verifyResult?.receiver?.bank_name || '',
          receiver_name: verifyResult?.receiver_name || verifyResult?.receiver?.account_name || '',
          receiver_acc_no: verifyResult?.receiver_acc_no || verifyResult?.receiver?.account_no || ''
        };

        flexString = flexString.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/gi, (matchKey, key) => {
          const lowerKey = key.toLowerCase();
          if (tagMap[lowerKey] !== undefined && tagMap[lowerKey] !== null) {
            return String(tagMap[lowerKey]);
          }
          return '';
        });

        try {
          setResolvedFlex(JSON.parse(flexString));
        } catch {
          setResolvedFlex(matchedTpl.content_json);
        }
      }
    });

    return () => { isMounted = false; };
  }, [metadata.flex_json, flexCode, flexTitle, metadata.flex_doc_id, verifyResult]);

  // If no resolvedFlex from metadata or API, construct a clean LINE Flex Bubble JSON template
  let targetBubble = resolvedFlex;
  if (resolvedFlex) {
    if (resolvedFlex.type === 'flex' && resolvedFlex.contents) {
      targetBubble = resolvedFlex.contents.type === 'carousel' ? resolvedFlex.contents.contents[0] : resolvedFlex.contents;
    } else if (resolvedFlex.type === 'carousel' && Array.isArray(resolvedFlex.contents)) {
      targetBubble = resolvedFlex.contents[0];
    } else if (resolvedFlex.contents && (!resolvedFlex.type || resolvedFlex.type !== 'bubble')) {
      targetBubble = resolvedFlex.contents;
    }
  }

  if (!targetBubble || targetBubble.type !== 'bubble') {
    const isSuccess = flexCode.includes('success') && !flexCode.includes('not_match');
    const isOutOfTime = flexCode.includes('out_of_time');
    const isDup = flexCode.includes('duplicate');
    const isNotMatch = flexCode.includes('not_match');
    const isMinAmount = flexCode.includes('min_amount');
    const isError = flexCode.includes('error') || flexCode.includes('not_found');

    const headerTitle = isSuccess ? 'ตรวจสอบสลิปสำเร็จ' : 
                        isOutOfTime ? 'สลิปเกินเวลา' : 
                        isDup ? 'สลิปนี้ถูกใช้งานแล้ว' : 
                        isNotMatch ? 'บัญชีผู้รับไม่ตรง' : 
                        isMinAmount ? 'ยอดเงินต่ำกว่ากำหนด' : 
                        isError ? 'สลิปมีปัญหา/ไม่พบสลิป' : 
                        flexTitle || 'รายละเอียดสลิป';

    // Header background colors strictly matching real flex_messages template designs in MongoDB:
    // flex_success = Green (#00C853), flex_out_of_time = Blue (#0F4C81), flex_duplicate/error/not_match = Red (#CC0000)
    const headerBgColor = isSuccess ? '#00C853' : isOutOfTime ? '#0F4C81' : '#CC0000';

    const amountText = verifyResult?.amount
      ? `${Number(verifyResult.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} บาท`
      : undefined;

    targetBubble = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        backgroundColor: headerBgColor,
        alignItems: 'flex-start',
        contents: [
          {
            type: 'text',
            text: headerTitle,
            weight: 'bold',
            size: 'xl',
            color: '#FFFFFF'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '14px',
        spacing: 'md',
        contents: [
          ...(amountText ? [
            {
              type: 'box',
              layout: 'horizontal',
              justifyContent: 'space-between',
              alignItems: 'center',
              contents: [
                { type: 'text', text: 'ยอดเงินโอน', size: 'xs', color: '#64748B' },
                { type: 'text', text: amountText, size: 'md', weight: 'bold', color: '#059669' }
              ]
            },
            { type: 'separator', color: '#F1F5F9' }
          ] : []),
          ...(verifyResult?.sender?.bank_name ? [
            {
              type: 'box',
              layout: 'horizontal',
              justifyContent: 'space-between',
              contents: [
                { type: 'text', text: 'ผู้โอน', size: 'xs', color: '#64748B' },
                { type: 'text', text: `${verifyResult.sender.bank_name} (${verifyResult.sender.account_name || 'N/A'})`, size: 'xs', weight: 'bold', color: '#334155' }
              ]
            }
          ] : []),
          ...(verifyResult?.receiver?.bank_name ? [
            {
              type: 'box',
              layout: 'horizontal',
              justifyContent: 'space-between',
              contents: [
                { type: 'text', text: 'ผู้รับ', size: 'xs', color: '#64748B' },
                { type: 'text', text: `${verifyResult.receiver.bank_name} (${verifyResult.receiver.account_name || 'N/A'})`, size: 'xs', weight: 'bold', color: '#334155' }
              ]
            }
          ] : []),
          ...(verifyResult?.trans_ref ? [
            {
              type: 'box',
              layout: 'horizontal',
              justifyContent: 'space-between',
              contents: [
                { type: 'text', text: 'TransRef', size: 'xxs', color: '#94A3B8' },
                { type: 'text', text: verifyResult.trans_ref, size: 'xxs', weight: 'bold', color: '#475569' }
              ]
            }
          ] : []),
          { type: 'separator', color: '#F1F5F9' },
          {
            type: 'box',
            layout: 'horizontal',
            justifyContent: 'space-between',
            contents: [
              { type: 'text', text: 'รหัส Flex Template:', size: 'xxs', color: '#94A3B8' },
              { type: 'text', text: flexCode || 'Flex Reply', size: 'xxs', color: '#64748B' }
            ]
          }
        ]
      }
    };
  }

  // [FEAT-20260809-FLEXRENDER] Preferred path — hand the ORIGINAL flex JSON to the
  // spec-accurate renderer. `resolvedFlex` is used (not `targetBubble`) so a carousel keeps
  // every bubble; the legacy path below unwraps to contents[0] and silently drops the rest.
  // Falls through to the legacy renderer when the flag is off or the JSON is not a real
  // container (e.g. the synthesised fallback bubble built above from slip metadata).
  if (USE_FLEX_RENDER && canRenderFlex(resolvedFlex)) {
    return (
      <div className={`w-fit max-w-[380px] text-left my-1 overflow-x-auto ${hugRight}`}>
        {/* [FEAT-20260817-ADMINBTNLINK] This is the ADMIN's view of the card in
            the chat / ticket-support room. The customer's buttons are postback /
            message actions, which render here as dead controls (the sanitiser
            strips every handler). Owner's rule 17/08: they open google.com for
            the admin instead. The customer's card on LINE is untouched — this is
            a render-time decision in the dashboard only.
            revert: drop the linkButtonsTo prop. */}
        <FlexBubble json={resolvedFlex} linkButtonsTo={ADMIN_BUTTON_LINK} />
      </div>
    );
  }

  return (
    <div className={`w-fit max-w-[380px] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-md overflow-hidden text-left my-1 ${hugRight}`}>
      <div
        className="w-full rounded-2xl overflow-hidden bg-white dark:bg-slate-900 flex flex-col"
        style={{ maxWidth: getBubbleWidth(targetBubble.size) }}
      >
        {/* Header */}
        {targetBubble.header && renderFlexNode(targetBubble.header, 999)}

        {/* Hero Image */}
        {targetBubble.hero && renderFlexNode(targetBubble.hero, 888)}

        {/* Body */}
        {targetBubble.body && renderFlexNode(targetBubble.body, 777)}

        {/* Footer */}
        {targetBubble.footer && renderFlexNode(targetBubble.footer, 666)}
      </div>
    </div>
  );
};
