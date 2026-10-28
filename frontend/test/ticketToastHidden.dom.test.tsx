/**
 * [FIX-20260829-NOTICARDHIDDEN] the ticket noti card is hidden — noti card hidden
 * ===========================================================================
 * Owner 29/08: the card is to be hidden, and kept ready to bring back later.
 *
 * 🔴 IT WAS NEVER POSITIONED. `TicketToast` carries no `fixed` and no `absolute` —
 *    only `flex items-center gap-3 …`. Rendered last inside the app container it
 *    therefore lands in normal flow at the BOTTOM-LEFT of the page and takes up
 *    real layout space, instead of floating clear of the content the way the
 *    other toasts in this app do (`TicketSupport.tsx` uses `fixed bottom-5 right-5`).
 *    That is the "ป้ายเด้งซ้ายล่าง" that was reported.
 *
 * 🔴 HIDDEN BY ONE FLAG, NOT BY DELETION. The whole component, its 5s auto-dismiss
 *    and its caller stay exactly as they were, so bringing it back is flipping
 *    `TICKET_TOAST_ENABLED` to `true` — and whoever does will still have to give
 *    it a `fixed` corner first, which is why that is written down where they will
 *    read it rather than left to be rediscovered.
 *
 * revert: set `TICKET_TOAST_ENABLED = true` in `components/chat/TicketToast.tsx`.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TicketToast, TICKET_TOAST_ENABLED } from '../components/chat/TicketToast';

describe('[NOTICARDHIDDEN] the ticket noti card does not render', () => {
  it('⭐⭐ 🔴 a toast with content still renders nothing at all', () => {
    const { container } = render(
      <TicketToast toast={{ hook_name: 'anything' } as never} onDismiss={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('⭐⭐ the switch is off, and it is the only thing deciding', () => {
    /* Asserted directly so the flag cannot be quietly inverted while the render
       test keeps passing for some other reason. */
    expect(TICKET_TOAST_ENABLED).toBe(false);
  });

  it('⭐ nothing renders even with no toast — the old empty case is unchanged', () => {
    const { container } = render(<TicketToast toast={null as never} onDismiss={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});
