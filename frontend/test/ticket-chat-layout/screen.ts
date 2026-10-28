/**
 * [REFACTOR-20261027-TCSPLIT] Screen helpers for test/ticketChatLayout.dom.test.tsx — split out
 * of that suite to keep it under 400 lines. They read and poke the rendered page only; the rig
 * (mocks, stubs, WS fan-out) stays in the suite because vi.mock must be hoisted there.
 */
import { act, fireEvent, prettyDOM, screen } from '@testing-library/react';

/* wait until the screen stops changing (two equal shots 40ms apart), not a fixed pause: under a
   loaded parallel run a fixed pause can shoot mid-load, and a case that times out keeps running
   in the background and clicks into the NEXT case's screen (seen once — every later case red) */
export const settle = async () => {
  let prev = '';
  for (let i = 0; i < 100; i++) {
    await act(() => new Promise((r) => setTimeout(r, 40)));
    const cur = shot();
    if (cur === prev) return;
    prev = cur;
  }
  throw new Error('screen never settled');
};
export const shot = (): string => prettyDOM(document.body, Infinity, { highlight: false }) || '';
export const call = (id: string) => {
  const el = document.querySelector(`[data-call="${id}"]`) as HTMLElement | null;
  if (!el) throw new Error(`no stub prop ${id}`);
  fireEvent.click(el);
};
export function tab(label: string): HTMLElement {
  const btn = screen.getAllByRole('button').find((b) => (b.textContent ?? '').trim().startsWith(label));
  if (!btn) throw new Error(`tab "${label}" not found`);
  return btn as HTMLElement;
}
/* the ✕ of the dialog painted last — closes it through its own onClose */
export const closeTopDialog = () => {
  const xs = Array.from(document.querySelectorAll('button')).filter((b) => b.querySelector('svg.lucide-x'));
  if (!xs.length) throw new Error('no dialog ✕ on screen');
  fireEvent.click(xs[xs.length - 1]);
};
export const card = (name: string) => screen.getByText(new RegExp(name)).closest('[data-chat-card]') as HTMLElement;
