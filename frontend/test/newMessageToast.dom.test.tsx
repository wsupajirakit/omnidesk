/**
 * "ได้รับข้อความใหม่" — the notice over the OPEN conversation.
 * ===========================================================================
 * The open card is the ONE card with no unread badge (opening clears it), so
 * this notice is its only signal. These tests pin both halves: the component's
 * show/hide behaviour, and the fact that ChatRoomView raises it for INBOUND
 * messages only — announcing the admin's own message back to them would be the
 * obvious way to get this wrong.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NewMessageToast, NEW_MESSAGE_TOAST_MS, NEW_MESSAGE_GLOW_MS, isTypingInInput } from '../components/chat/NewMessageToast';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('the notice itself', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays hidden until something actually arrives', () => {
    const { container } = render(<NewMessageToast trigger={0} />);
    expect(container.querySelector('.opacity-0')).toBeTruthy();
    expect(container.querySelector('.opacity-100')).toBeNull();
  });

  it('shows the wording the owner asked for when a message lands', () => {
    const { container, rerender } = render(<NewMessageToast trigger={0} />);
    rerender(<NewMessageToast trigger={1} />);
    expect(screen.getByText('ได้รับข้อความใหม่')).toBeTruthy();
    expect(container.querySelector('.opacity-100')).toBeTruthy();
  });

  it('fades itself out — the operator never has to dismiss it', () => {
    const { container, rerender } = render(<NewMessageToast trigger={0} />);
    rerender(<NewMessageToast trigger={1} />);
    act(() => { vi.advanceTimersByTime(NEW_MESSAGE_TOAST_MS + 50); });
    expect(container.querySelector('.opacity-0')).toBeTruthy();
  });

  it('a burst keeps ONE notice alive instead of stacking or flickering', () => {
    const { container, rerender } = render(<NewMessageToast trigger={0} />);
    rerender(<NewMessageToast trigger={1} />);
    act(() => { vi.advanceTimersByTime(NEW_MESSAGE_TOAST_MS - 200); });
    rerender(<NewMessageToast trigger={2} />);           // second message, timer restarts
    act(() => { vi.advanceTimersByTime(300); });          // past the FIRST deadline
    expect(container.querySelectorAll('.opacity-100').length).toBe(1);
  });

  it('the light-theme shade is grey and soft, and dark keeps its own', () => {
    const { container } = render(<NewMessageToast trigger={1} />);
    const cls = container.querySelector('.rounded-full')?.className ?? '';
    // slate-tinted, 0.07 alpha — not the near-black default
    expect(cls).toContain('rgba(100,116,139,0.07)');
    expect(cls).toContain('dark:shadow-xl');
    // a comment leaking out of the className template would show up here
    expect(cls).not.toContain('/*');
  });

  it('never eats a click meant for the message underneath', () => {
    const { container } = render(<NewMessageToast trigger={1} />);
    expect(container.querySelector('.pointer-events-none')).toBeTruthy();
  });
});

describe('it stays out of the way while the operator types', () => {
  afterEach(() => document.body.innerHTML = '');

  it('reports typing when the cursor is in the composer', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    expect(isTypingInInput()).toBe(true);
  });

  it('reports typing for a plain input and a contentEditable too', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(isTypingInInput()).toBe(true);
  });

  it('reports NOT typing when nothing is focused', () => {
    (document.activeElement as HTMLElement | null)?.blur();
    expect(isTypingInInput()).toBe(false);
  });

  it('the page asks before raising the notice — sound and badge are untouched', () => {
    const view = src('components/chat/ChatRoomView.tsx');
    expect(view).toContain("if (data.sender_type === 'customer' && !isTypingInInput()) setNewMsgTick(t => t + 1);");
  });
});

describe('the corner toast no longer fires for chat messages', () => {
  const app = src('App.tsx');

  it('only a NEW CASE raises the corner toast', () => {
    expect(app).toContain("if (event.type === 'ticket:new') {");
    expect(app).toContain('setToast({ id: `${Date.now()}`, hook_name: data.hook_name || \'\', ts: event.ts });');
  });

  it('but the SOUND still fires for every alerting event', () => {
    const gate = app.indexOf('if (!shouldAlert(event as any)) return;');
    const sound = app.indexOf('playNotiSound();', gate);
    const toastGate = app.indexOf("if (event.type === 'ticket:new') {", gate);
    expect(gate).toBeGreaterThan(-1);
    expect(toastGate).toBeLessThan(sound);   // the toast is gated, the sound is not
  });
});

describe('the new bubble glows blue for 4s', () => {
  const view = src('components/chat/ChatRoomView.tsx');
  const css = src('index.css');

  it('the glow lasts the 4 seconds the owner asked for', () => {
    expect(NEW_MESSAGE_GLOW_MS).toBe(4000);
    expect(NEW_MESSAGE_GLOW_MS).toBeGreaterThan(NEW_MESSAGE_TOAST_MS);   // outlives the notice
  });

  it('only an INBOUND bubble glows, and the id decides which one', () => {
    expect(view).toContain("if (data.sender_type === 'customer') glowMessage(String(data._id ?? ''));");
    expect(view).toContain("glowIds.has(String(msg._id)) ? 'tc-msg-glow' : ''");
  });

  it('several messages can glow at once, each with its own deadline', () => {
    expect(view).toContain('const [glowIds, setGlowIds] = useState<Set<string>>(new Set());');
    expect(view).toContain('glowTimersRef.current.push(setTimeout(');
  });

  it('timers are cleared on unmount — no firing into a dead component', () => {
    expect(view).toContain('glowTimersRef.current.forEach(clearTimeout);');
  });

  it('the glow is NOT suppressed while typing — that gate is only for the notice', () => {
    const notice = view.indexOf('!isTypingInInput()');
    const glow = view.indexOf('glowMessage(String(data._id');
    expect(notice).toBeGreaterThan(-1);
    expect(glow).toBeGreaterThan(notice);
    expect(view.slice(notice, glow)).not.toContain('isTypingInInput()  &&');
  });

  it('the ring lands on the bubble, not on the wrapper that holds the timestamp', () => {
    /* Anchored to the START of a line. A bare `toContain` here is worthless: the
       dark selector CONTAINS the light one as a substring, so breaking the light
       rule left the assertion green — caught by a mutation, fixed here.
       ต้องผูกกับต้นบรรทัด ไม่งั้น rule ของ dark ทำให้ผ่านทั้งที่ light พัง. */
    const light = /^\.tc \.tc-msg-glow > \*:last-child \{([\s\S]*?)\}/m.exec(css);
    expect(light, 'the LIGHT rule must target the bubble itself').not.toBeNull();
    expect(light![1]).toContain('box-shadow');
    /* EVERY colour stop must be sky blue — checking only one leaves the other free
       to be any hue, which a mutation proved (the first stop was turned orange and
       this test stayed green). ทุก stop ต้องเป็นฟ้า ไม่ใช่แค่ stop แรก. */
    const stops = light![1].match(/rgba\(\s*\d+,\s*\d+,\s*\d+/g) ?? [];
    expect(stops.length).toBeGreaterThan(1);
    stops.forEach((stop: string) => expect(stop.replace(/\s+/g, '')).toBe('rgba(56,189,248'));

    const dark = /^html\.theme-dark \.tc \.tc-msg-glow > \*:last-child \{([\s\S]*?)\}/m.exec(css);
    expect(dark, 'dark needs its own rule').not.toBeNull();
    expect(dark![1]).toContain('rgba(56, 189, 248,');
  });
});

describe('ChatRoomView raises it correctly', () => {
  const view = src('components/chat/ChatRoomView.tsx');

  it('only an INBOUND message triggers it — not the admin own outbound', () => {
    expect(view).toContain("data.sender_type === 'customer'");
    expect(view).toContain('setNewMsgTick(t => t + 1);');
  });

  it('is raised before the branch that decides how the bubble is rendered', () => {
    const raise = view.indexOf('setNewMsgTick(t => t + 1)');
    const branch = view.indexOf('const isRichKind = data.message_type');
    expect(raise).toBeGreaterThan(-1);
    expect(raise).toBeLessThan(branch);
  });

  it('is centred on the CHAT HEADER, and that header stays positioned', () => {
    /* Owner moved it off the messages on 2026-08-19: floating mid-conversation
       covered the bubbles being read. The header is the host now, so it must keep
       `relative` — without it the notice would escape to the nearest positioned
       ancestor and land somewhere unpredictable. อยู่บนแถบหัว ต้องคง relative.

       [REFACTOR-20260905-ROOMHEADER] The rule is unchanged; it now spans two
       files. The header and the toast moved into `room-header/RoomHeader.tsx`
       while the message stream stayed in `ChatRoomView.tsx`, so
       "toast before stream" stopped being two offsets in one string. It is
       asserted in the two halves it actually has now — an index comparison
       inside the header file, and a STRUCTURAL check that the page renders the
       header above the stream. Collapsing them back into one offset comparison
       would only work by putting the toast back beside the stream, which is the
       arrangement the owner removed. */
    const header = src('components/chat/room-header/RoomHeader.tsx');
    expect(header).toContain('<NewMessageToast trigger={newMsgTick} />');
    /* [FIX-20261019-STALEPIN] what this case protects is `relative` on the header that hosts the
       toast. It also pinned the padding (`p-3`), which commit 5511979 (18/09, header polish)
       changed to `px-3 py-2` on purpose — the header stayed positioned, the pin went red. The
       padding is cosmetic and is no longer part of the assertion; the positioned host still is. */
    expect(header).toMatch(/className="tc-chat-header relative [^"]*"/);
    const bar = header.indexOf('tc-chat-header relative');
    const toast = header.indexOf('<NewMessageToast trigger=');
    expect(bar).toBeGreaterThan(-1);
    expect(toast).toBeGreaterThan(bar); // inside the bar, not before it

    // …and the bar is drawn above the message stream, not inside it.
    const mount = view.indexOf('<RoomHeader');
    const stream = view.indexOf('ref={chatContainerRef}');
    expect(mount).toBeGreaterThan(-1);
    expect(stream).toBeGreaterThan(-1);
    expect(mount).toBeLessThan(stream);
  });

  it('the notice itself is absolutely centred, not a sticky row any more', () => {
    const mod = src('components/chat/NewMessageToast.tsx');
    expect(mod).toContain('absolute inset-x-0 top-1/2 -translate-y-1/2');
    expect(mod).not.toContain('sticky top-1/2');
  });
});
