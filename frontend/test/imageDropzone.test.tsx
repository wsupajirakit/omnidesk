/* [FEAT-20260818-DROPIMAGE] ลากรูปมาวางที่กล่องพิมพ์ในหน้า ticket-support
 * ===========================================================================
 * ข้อกำหนด 18/08: ช่องตอบต้องรับรูปด้วยการลากมาวางได้ (เดิมมีแค่ปุ่มเลือกไฟล์ + Ctrl+V)
 *
 * ที่ต้องพิสูจน์ และเหตุที่ต้องเทสจริงไม่ใช่แค่ compile ผ่าน:
 *   1. `imageFilesFromDrop` อ่าน `dataTransfer.files` · กรองเฉพาะ image/* · เคารพเพดาน
 *   2. hook ต้อง `preventDefault` ที่ dragover (ถ้าไม่ทำ เบราว์เซอร์จะไม่ยอมให้วางเลย
 *      — บั๊กนี้ compile ผ่านและเงียบสนิท)
 *   3. ตัวนับ depth: ลากผ่าน element ลูกแล้วกรอบต้องไม่กระพริบ
 *   4. วางของที่ไม่ใช่รูป ต้องไม่กลืน gesture (ไม่ preventDefault)
 *   5. ถาดเต็ม 5 หรือโหมดโน๊ต = ไม่รับ ไม่โชว์กรอบ
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  imageFilesFromDrop,
  dragHasFiles,
  imageFilesFromPaste,
} from '../utils/imageTransfer';
import { useImageDropzone } from '../services/chat/useImageDropzone';
import ComposerDropOverlay from '../components/chat/ComposerDropOverlay';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const img = (name = 'a.png', type = 'image/png') =>
  new File([new Uint8Array([1, 2, 3])], name, { type });

const drop = (files: File[], types: string[] = ['Files']) => {
  const e: any = {
    dataTransfer: { files, types, dropEffect: 'none' },
    preventDefault: vi.fn(),
  };
  return e;
};

describe('[DROPIMAGE] imageFilesFromDrop', () => {
  it('⭐ อ่านรูปจาก dataTransfer.files ได้', () => {
    const files = imageFilesFromDrop(drop([img('shot.png')]), 5);
    expect(files).toHaveLength(1);
    expect(files[0].type).toBe('image/png');
  });

  it('⭐ กรองเฉพาะรูป — pdf / โฟลเดอร์ (type ว่าง) ต้องไม่ถูกแนบ', () => {
    const pdf = new File([new Uint8Array([1])], 'doc.pdf', {
      type: 'application/pdf',
    });
    const folder = new File([], 'my-folder', { type: '' });
    expect(imageFilesFromDrop(drop([pdf, folder]), 5)).toEqual([]);
    // ลากมาปนกัน → เอาแต่รูป
    const mixed = imageFilesFromDrop(drop([pdf, img('ok.jpg', 'image/jpeg'), folder]), 5);
    expect(mixed).toHaveLength(1);
    expect(mixed[0].type).toBe('image/jpeg');
  });

  it('⭐ เคารพเพดานช่องว่าง และรักษาลำดับ', () => {
    const many = [img('1.png'), img('2.png'), img('3.png')];
    expect(imageFilesFromDrop(drop(many), 2)).toHaveLength(2);
    expect(imageFilesFromDrop(drop(many), 0)).toEqual([]);
    const three = imageFilesFromDrop(drop(many), 5);
    expect(three.map((f) => f.name)).toEqual([
      expect.stringMatching(/^drop-\d+-1\.png$/),
      expect.stringMatching(/^drop-\d+-2\.png$/),
      expect.stringMatching(/^drop-\d+-3\.png$/),
    ]);
  });

  it('ตั้งชื่อคนละ prefix กับ paste เพื่อไล่ที่มาใน log ได้', () => {
    expect(imageFilesFromDrop(drop([img()]), 5)[0].name).toMatch(/^drop-/);
    const pasted = imageFilesFromPaste(
      {
        clipboardData: {
          items: [{ kind: 'file', type: 'image/png', getAsFile: () => img() }],
        },
      } as never,
      5,
    );
    expect(pasted[0].name).toMatch(/^paste-/);
  });

  it('ไม่มี dataTransfer ก็ไม่ throw', () => {
    expect(imageFilesFromDrop({ dataTransfer: null } as never, 5)).toEqual([]);
    expect(imageFilesFromDrop({ dataTransfer: {} } as never, 5)).toEqual([]);
  });

  it('dragHasFiles: ลากไฟล์ = true · ลากข้อความ/ลิงก์ = false', () => {
    expect(dragHasFiles(['Files'])).toBe(true);
    expect(dragHasFiles(['application/x-moz-file'])).toBe(true);
    expect(dragHasFiles(['text/plain', 'text/uri-list'])).toBe(false);
    expect(dragHasFiles(undefined)).toBe(false);
    expect(dragHasFiles([])).toBe(false);
  });
});

describe('[DROPIMAGE] useImageDropzone', () => {
  const setup = (free = 5, enabled = true) => {
    const onFiles = vi.fn();
    const hook = renderHook(() => useImageDropzone(free, enabled, onFiles));
    return { hook, onFiles };
  };

  it('⭐ dragover ต้อง preventDefault ไม่งั้นเบราว์เซอร์ไม่ยอมให้วาง', () => {
    const { hook } = setup();
    const e = drop([]);
    act(() => hook.result.current.dropHandlers.onDragOver(e));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.dataTransfer.dropEffect).toBe('copy');
    expect(hook.result.current.isDragging).toBe(true);
  });

  it('⭐ วางรูปแล้วส่งต่อเข้า seam เดียวกับปุ่มเลือกไฟล์ + ปิดกรอบ', () => {
    const { hook, onFiles } = setup();
    const e = drop([img('x.png')]);
    act(() => hook.result.current.dropHandlers.onDragEnter(e));
    expect(hook.result.current.isDragging).toBe(true);
    act(() => hook.result.current.dropHandlers.onDrop(e));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0]).toHaveLength(1);
    expect(hook.result.current.isDragging).toBe(false);
  });

  it('⭐ ลากผ่าน element ลูก (enter 3 / leave 2) กรอบต้องยังอยู่ ไม่กระพริบ', () => {
    const { hook } = setup();
    const h = () => hook.result.current.dropHandlers;
    act(() => { h().onDragEnter(drop([])); h().onDragEnter(drop([])); h().onDragEnter(drop([])); });
    act(() => { h().onDragLeave(drop([])); h().onDragLeave(drop([])); });
    expect(hook.result.current.isDragging).toBe(true);
    act(() => h().onDragLeave(drop([])));
    expect(hook.result.current.isDragging).toBe(false);
  });

  it('⭐ วางของที่ไม่ใช่รูป = ไม่กลืน gesture (ไม่ preventDefault) และไม่แนบอะไร', () => {
    const { hook, onFiles } = setup();
    const pdf = new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' });
    const e = drop([pdf]);
    act(() => hook.result.current.dropHandlers.onDrop(e));
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('⭐ ถาดเต็ม (free=0) = ไม่รับ ไม่โชว์กรอบ', () => {
    const { hook, onFiles } = setup(0);
    const e = drop([img()]);
    act(() => hook.result.current.dropHandlers.onDragEnter(e));
    act(() => hook.result.current.dropHandlers.onDrop(e));
    expect(hook.result.current.isDragging).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('⭐ ปิดรับ (โหมดโน๊ต / ยังไม่รับเคส / กำลังส่ง) = ไม่รับเลย', () => {
    const { hook, onFiles } = setup(5, false);
    const e = drop([img()]);
    act(() => hook.result.current.dropHandlers.onDragEnter(e));
    act(() => hook.result.current.dropHandlers.onDrop(e));
    expect(hook.result.current.isDragging).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('ลากข้อความมา (ไม่ใช่ไฟล์) ไม่ต้องโชว์กรอบ', () => {
    const { hook } = setup();
    const e = drop([], ['text/plain']);
    act(() => hook.result.current.dropHandlers.onDragEnter(e));
    expect(hook.result.current.isDragging).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});

describe('[DROPIMAGE] ComposerDropOverlay', () => {
  it('ไม่ได้ลากอยู่ = ไม่ render อะไรเลย (หน้าเหมือนเดิมก่อนมีฟีเจอร์)', () => {
    const { container } = render(<ComposerDropOverlay active={false} free={5} max={5} />);
    expect(container.innerHTML).toBe('');
  });

  it('⭐ ลากอยู่ = บอกวางได้ + เหลืออีกกี่รูป และต้องไม่กินอีเวนต์', () => {
    const { container } = render(<ComposerDropOverlay active free={3} max={5} />);
    expect(screen.getByText('วางรูปที่นี่เพื่อแนบ')).toBeTruthy();
    expect(screen.getByText(/แนบได้อีก 3 รูป/).textContent).toContain('สูงสุด 5');
    /* pointer-events-none: ถ้าโดนถอด overlay จะยิง dragleave ทันทีที่โผล่
       ⇒ กรอบกระพริบ + การวางไปลงบน overlay ไม่เข้ากล่อง */
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('pointer-events-none');
    expect(root.className).toContain('absolute');
    expect(root.className).toContain('border-dashed');
  });
});

/** หน้าเพจ render ใน vitest ไม่ได้ (fetch ตอน mount + WS) จึงล็อกสายที่ต่อไว้ที่ source */
describe('[DROPIMAGE] TicketChat ต่อสายไว้จริง', () => {
  const code = ticketChatSource();

  it('⭐ กล่องพิมพ์รับ handler ชุด drop และมี relative ให้ overlay เกาะ', () => {
    expect(code).toContain('{...dropHandlers}');
    /* [FIX-20260830-TRAYBOTTOM] this used to pin the literal
       "className={`relative border rounded-lg shadow-sm", but that box is now
       wrapped in chatComposerRootClass(...) so the fullscreen tray gets a
       bounded ancestor. What this test actually guards is unchanged: the
       overlay's anchor still carries `relative` and it is still the FIRST
       class, so nothing can shift the overlay's positioning context. */
    expect(code).toMatch(/`relative border rounded-lg shadow-sm/);
    expect(code).toContain('<ComposerDropOverlay active={isDragging}');
  });

  it('⭐ ใช้ seam เดียวกับปุ่มเลือกไฟล์ (stageImages) ไม่ได้เขียน upload ใหม่', () => {
    expect(code).toMatch(/useImageDropzone\(\s*freeImageSlots,[\s\S]{0,120}stageImages,/);
    expect(code).toContain("mode === 'reply'");
  });

  it('ไม่มีตัวกรอง/เพดานซ้ำในหน้าเพจ (กันกฎแตกเป็นสองชุด)', () => {
    // การกรอง image/* ต้องอยู่ที่ helper ที่เดียว
    expect(code).not.toContain("startsWith('image/')");
  });
});
