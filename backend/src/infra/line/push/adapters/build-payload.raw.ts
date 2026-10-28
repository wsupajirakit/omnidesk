import { BadRequestException } from '@nestjs/common';

import type { LineMessage } from '../line-push.types';

/**
 * ==== [FEAT-20260820-LINEPUSHADAPTERS] candidate D — dashboard raw push ====
 *
 * Parity with `buildPayloadMessage` (external/hook-outbound.service.ts:266-350,
 * live and untouched until Phase 3). Every rejection keeps LEGACY'S EXACT
 * STRING inside a BadRequestException — the composer surfaces them to the
 * operator verbatim, so the words are contract, not prose. ข้อความ error คือ
 * ของจริงที่ผู้ใช้เห็น ห้ามเปลี่ยนคำ.
 * revert: delete `src/infra/line/` entirely (no runtime importers yet).
 */

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

export function buildRawMessage(message: Record<string, unknown>): LineMessage {
  const type = message['type'];
  if (
    typeof type !== 'string' ||
    !['text', 'image', 'flex', 'video', 'audio'].includes(type)
  ) {
    throw new BadRequestException('Invalid message type');
  }

  if (type === 'text') {
    const text = asString(message['text']);
    if (!text) throw new BadRequestException('message.text is required');
    return { type: 'text', text };
  }

  if (type === 'image') {
    const url = asString(message['image_url']).trim();
    if (!url) throw new BadRequestException('message.image_url is required');
    if (!/^https:\/\//i.test(url)) {
      throw new BadRequestException(
        'message.image_url must start with https://',
      );
    }
    return { type: 'image', originalContentUrl: url, previewImageUrl: url };
  }

  if (type === 'video') {
    const url = asString(message['video_url']).trim();
    const preview = asString(message['preview_image_url']).trim();
    if (!url || !preview) {
      throw new BadRequestException(
        'message.video_url and message.preview_image_url are required',
      );
    }
    if (!/^https:\/\//i.test(url) || !/^https:\/\//i.test(preview)) {
      throw new BadRequestException(
        'video_url and preview_image_url must start with https://',
      );
    }
    return { type: 'video', originalContentUrl: url, previewImageUrl: preview };
  }

  if (type === 'audio') {
    const url = asString(message['audio_url']).trim();
    const duration = Number(message['duration']);
    if (!url || !Number.isFinite(duration)) {
      throw new BadRequestException(
        'message.audio_url and message.duration are required',
      );
    }
    if (!/^https:\/\//i.test(url)) {
      throw new BadRequestException(
        'message.audio_url must start with https://',
      );
    }
    return { type: 'audio', originalContentUrl: url, duration };
  }

  // flex
  const flex = message['flex_json'];
  if (flex === undefined || flex === null || flex === '') {
    throw new BadRequestException('message.flex_json is required');
  }
  let contents: unknown;
  if (typeof flex === 'string') {
    try {
      contents = JSON.parse(flex);
    } catch {
      throw new BadRequestException('message.flex_json must be valid JSON');
    }
  } else {
    contents = flex;
  }
  return {
    type: 'flex',
    altText: message['alt_text'] || 'Message',
    contents,
  };
}
