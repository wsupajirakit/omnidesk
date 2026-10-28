import type { LineMessage } from '../line-push.types';

/**
 * ==== [FEAT-20260820-LINEPUSHADAPTERS] candidate G — register flow ====
 *
 * Parity with hook-reply/customer-register.handler.ts (live and untouched
 * until Phase 3):
 *  · the bubble is BYTE-FROZEN legacy JSON (:53-87) — layout, copy, the stray
 *    space, empty `contents: []` fillers. Owner's standing order in that file:
 *    "ห้ามแก้ layout/ข้อความนอกจากผู้ใช้สั่ง". Only the `uri` is dynamic.
 *  · altText "ลงทะเบียนสมาชิก" is passed explicitly at the call site (:291).
 *  · the already-registered copy is EXACT, spaces included (:222-224).
 * revert: delete `src/infra/line/` entirely (no runtime importers yet).
 */

export function buildRegisterFlexMessage(registerUrl: string): LineMessage {
  return {
    type: 'flex',
    altText: 'ลงทะเบียนสมาชิก',
    contents: {
      type: 'bubble',
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'separator' },
          {
            type: 'text',
            text: 'ผู้ใช้งานสามารถลงทะเบียนสมาชิก โดยการกดปุ่มสีเขียวนี้',
            margin: 'md',
            size: 'lg',
            wrap: true,
            align: 'center',
            style: 'normal',
            contents: [],
          },
          { type: 'separator' },
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            action: { type: 'uri', label: 'ลงทะเบียน', uri: registerUrl },
          },
          { type: 'box', layout: 'vertical', contents: [], margin: 'sm' },
          { type: 'separator' },
        ],
        flex: 0,
      },
    },
  };
}

export function buildAlreadyRegisteredTextMessage(
  fullName: string,
): LineMessage {
  return { type: 'text', text: `คุณ ${fullName} ได้ลงทะเบียน เรียบร้อยแล้ว` };
}
