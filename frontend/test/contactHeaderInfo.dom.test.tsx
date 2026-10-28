/* [FEAT-20260814-CONTACTPAGE]+[FEAT-20260814-PROFILESYNC] Contact header card
 * ===========================================================================
 * Owner's 3-step spec (14/08), pinned literally:
 *  - one line, collapsed BY DEFAULT
 *  - collapsed shows name + phone + LINE id + copy — COMPLETE
 *  - avatar and the sync-LINE button appear ONLY after expanding
 * Plus the sync flow itself: right payload out, fresh profile handed back via
 * onSynced, and a failed sync stays quiet (no onSynced, page intact).
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock('../services/chat', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    chatService: { ...(mod as any).chatService, syncUserProfile: mocks.sync },
  };
});

import { ContactHeaderInfo } from '../components/contact';

const room: any = {
  _id: 'r1',
  hook_id: 'h1',
  line_user_id: 'U1',
  user_data: {
    display_name: 'judy',
    phone_number: '0955550010',
    line_user_id: 'U1',
    picture_url: 'https://pic.example/p.jpg',
  },
};

const setup = () => {
  const onCopy = vi.fn();
  const onSynced = vi.fn();
  const utils = render(<ContactHeaderInfo room={room} onCopy={onCopy} onSynced={onSynced} />);
  return { ...utils, onCopy, onSynced };
};

// no beforeEach reset needed — each test below installs its own implementation
describe('[CONTACTPAGE] collapsed by default — name + labels complete, no avatar/sync', () => {
  it('shows name, phone, LINE id and the copy button while collapsed', () => {
    const t = setup();
    expect(t.container.textContent).toContain('judy');
    expect(t.container.textContent).toContain('0955550010');
    expect(t.container.textContent).toContain('U1');
    fireEvent.click(t.getByTitle('คัดลอก LINE user id'));
    expect(t.onCopy).toHaveBeenCalledWith('U1');
  });

  /* [FIX-20260814-INFOICON] Owner, 14/08: the toggle shows the info ICON, not the
   * word "info". The chevron stays as the open/closed indicator, and the title
   * keeps the word so the control is still findable by name. */
  it('the toggle is an icon, not the literal word "info"', () => {
    const t = setup();
    const toggle = t.getByTitle('เปิด info');
    expect(toggle.textContent).not.toContain('info');
    // two icons: the info mark and the chevron that reports the state
    expect(toggle.querySelectorAll('svg').length).toBe(2);
  });

  it('hides the avatar and the sync button until expanded — owner: "ต้องกดเปิดก่อน"', () => {
    const t = setup();
    expect(t.container.querySelector('img')).toBeNull();
    expect(t.container.textContent).not.toContain('sync LINE');
    fireEvent.click(t.getByTitle('เปิด info'));
    expect(t.container.querySelector('img')).not.toBeNull();
    expect(t.container.textContent).toContain('sync LINE');
    // and it folds back
    fireEvent.click(t.getByTitle('พับ info'));
    expect(t.container.querySelector('img')).toBeNull();
  });
});

describe('[PROFILESYNC] sync-LINE button', () => {
  it('sends {hookId, lineUserId} and hands the fresh profile to onSynced', async () => {
    const fresh = { line_user_id: 'U1', display_name: 'judy ✨', picture_url: 'p2.jpg' };
    mocks.sync.mockResolvedValue({ success: true, data: fresh });
    const t = setup();
    fireEvent.click(t.getByTitle('เปิด info'));
    fireEvent.click(t.getByText('sync LINE'));
    await waitFor(() => expect(t.onSynced).toHaveBeenCalledWith(fresh));
    expect(mocks.sync).toHaveBeenCalledWith({ hookId: 'h1', lineUserId: 'U1' });
  });

  it('a failed sync stays quiet: no onSynced, an error marker appears, page intact', async () => {
    // synchronous throw — the component's try/catch swallows it identically to
    // an awaited rejection, but no rejected promise ever floats for vitest's
    // unhandled-rejection detector to (falsely) flag the test with
    mocks.sync.mockImplementation(() => { throw new Error('LINE down'); });
    const t = setup();
    fireEvent.click(t.getByTitle('เปิด info'));
    fireEvent.click(t.getByText('sync LINE'));
    await waitFor(() => expect(t.getByTitle('LINE down')).toBeTruthy());
    expect(t.onSynced).not.toHaveBeenCalled();
    expect(t.container.textContent).toContain('judy'); // header still standing
  });
});
