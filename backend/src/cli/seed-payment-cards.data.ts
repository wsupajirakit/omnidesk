/**
 * ==== [TEMP-20260810-SEEDCLI] ข้อมูลการ์ด 5 ใบ — snapshot จาก DB ที่ตั้งค่าเสร็จแล้ว ====
 *
 * 🔴 ของชั่วคราว ลบพร้อม `seed-payment-cards.ts` (ดูคำอธิบายที่ไฟล์นั้น)
 *
 * ที่มา: dump จาก `dev_local_omnidesk` OA `omnideskdevoa` เมื่อ 2026-08-10 — ทั้ง content_json
 * ที่แอดมินแก้แล้ว, flag `direct_ticket_on_reply` และข้อความ `direct_ticket_text`
 * ที่พิมพ์เองจาก UI ⇒ ยกไป DB ใหม่ได้สถานะเดียวกันทันที ไม่ต้องนั่งติ๊กใหม่
 *
 * ⚠️ ชื่อการ์ดใส่ได้แค่ a-zA-Z0-9 (ฟอร์มบังคับที่ FlexMessageFormModal.tsx:704 — ออกแบบไว้
 *    แบบนั้น ห้ามแก้) ⇒ `PAYreview` ไม่ใช่ `[PAY] review`
 * ⚠️ มี 5 ใบ ไม่ใช่ 8 — เจ้าของเลือกเอง อีก 3 state ตั้งใจไม่ผูก
 */
export interface SeedCard {
  state: string;
  name: string;
  direct_ticket_on_reply: boolean;
  direct_ticket_text: string;
  content_json: unknown;
}

export const CARDS: SeedCard[] = [
  {
    state: 'statement_not_found',
    name: 'PAYstatementnotfound',
    direct_ticket_on_reply: true,
    direct_ticket_text: 'ยอดที่โอนมา กับยอดเงิน ในสลิป ไม่ถูกต้อง',
    content_json: {
      type: 'bubble',
      hero: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
          },
          {
            type: 'text',
            text: 'เนื่องจากยอดที่โอนมา กับยอดเงิน ในสลิป ไม่ถูกต้อง เดี๋ยวน้องลัคกี้จะแจ้งพี่แอดมินให้มาดูแลต่อนะคะ',
            align: 'center',
            gravity: 'top',
            margin: 'xl',
            size: 'md',
            wrap: true,
            scaling: true,
            adjustMode: 'shrink-to-fit',
          },
        ],
        justifyContent: 'center',
        margin: 'lg',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
            spacing: 'lg',
            margin: 'md',
            height: '20px',
          },
        ],
        flex: 0,
      },
    },
  },
  {
    state: 'review',
    name: 'PAYreview',
    direct_ticket_on_reply: false,
    direct_ticket_text: '',
    content_json: {
      type: 'bubble',
      hero: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
          },
          {
            type: 'text',
            text: 'ไม่สามารถดำเนินรายการอัตโนมัติได้ กรุณาลองใหม่อีกครั้งหรือติดต่อแอดมิน',
            align: 'center',
            gravity: 'top',
            margin: 'xl',
            size: 'xxl',
            wrap: true,
            scaling: true,
            adjustMode: 'shrink-to-fit',
          },
        ],
        justifyContent: 'center',
        margin: 'lg',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            height: 'md',
            action: {
              type: 'message',
              label: 'ติดต่อแอดมิน',
              text: '{{paylink.contact_admin}}',
            },
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
            spacing: 'lg',
            margin: 'md',
            height: '20px',
          },
        ],
        flex: 0,
      },
    },
  },
  {
    state: 'not_linked',
    name: 'PAYnotlinked',
    direct_ticket_on_reply: false,
    direct_ticket_text: '',
    content_json: {
      type: 'bubble',
      hero: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
          },
          {
            type: 'text',
            text: 'ยังไม่ได้ผูกบัญชี กรุณาผูกบัญชีก่อนแล้วส่งสลิปอีกครั้ง',
            align: 'center',
            gravity: 'top',
            margin: 'xl',
            size: 'xxl',
            wrap: true,
            scaling: true,
            adjustMode: 'shrink-to-fit',
          },
        ],
        justifyContent: 'center',
        margin: 'lg',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
            spacing: 'lg',
            margin: 'md',
            height: '20px',
          },
        ],
        flex: 0,
      },
    },
  },
  {
    state: 'no_match_retry',
    name: 'PAYnomatchretry',
    direct_ticket_on_reply: false,
    direct_ticket_text: '',
    content_json: {
      type: 'bubble',
      hero: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
          },
          {
            type: 'text',
            text: 'ไม่พบรายการที่ตรงกับสลิปนี้ กรุณากด "ลองใหม่" เพื่อตรวจสอบรายการถัดไป',
            align: 'center',
            gravity: 'top',
            margin: 'xl',
            size: 'xxl',
            wrap: true,
            scaling: true,
            adjustMode: 'shrink-to-fit',
          },
        ],
        justifyContent: 'center',
        margin: 'lg',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            height: 'md',
            action: {
              type: 'postback',
              label: 'ลองใหม่อีกครั้ง',
              data: '{{paylink.retry}}',
              displayText: 'ส่งสลิปใหม่',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'md',
            action: {
              type: 'message',
              label: 'ติดต่อแอดมิน',
              text: '{{paylink.contact_admin}}',
            },
            offsetTop: 'xl',
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
            spacing: 'lg',
            margin: 'md',
            height: '20px',
          },
        ],
        flex: 0,
      },
    },
  },
  {
    state: 'member_not_match',
    name: 'PAYmembernotmatch',
    direct_ticket_on_reply: true,
    direct_ticket_text: 'บัญชีที่โอนมา ไม่ใช่บัญชีของคุณลูกค้าเอง',
    content_json: {
      type: 'bubble',
      hero: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
          },
          {
            type: 'text',
            text: 'เนื่องจากบัญชีที่โอนมา ไม่ใช่บัญชีของคุณลูกค้าเอง เดี๋ยวน้องลัคกี้จะแจ้งพี่แอดมินให้มาดูแลต่อนะคะ',
            align: 'center',
            gravity: 'top',
            margin: 'xl',
            size: 'xxl',
            wrap: true,
            scaling: true,
            adjustMode: 'shrink-to-fit',
          },
        ],
        justifyContent: 'center',
        margin: 'lg',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
            spacing: 'lg',
            margin: 'md',
            height: '20px',
          },
        ],
        flex: 0,
      },
    },
  },
];
