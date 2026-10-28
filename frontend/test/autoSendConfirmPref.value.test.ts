/**
 * [FEAT-20260918-AUTOSENDREMEMBER] "จำค่านี้ไว้" — the default must survive everything
 * =============================================================================
 * One rule carries this whole feature: **anything other than a stored literal
 * `true` means ASK**. Being asked once too often costs a click; skipping a
 * confirm nobody asked to skip sends a translated message to a customer with no
 * review, and a sent LINE message cannot be recalled.
 *
 * So the cases below are mostly the ways the answer can be missing or wrong —
 * a legacy account, an unset section, a truthy-but-not-true value, storage that
 * throws — and every one of them has to come back "ask".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getInitialPreferences, saveLocalPreference, savePreferences } = vi.hoisted(() => ({
  getInitialPreferences: vi.fn(),
  saveLocalPreference: vi.fn(),
  savePreferences: vi.fn(),
}));

vi.mock('../services/admin/preferencesService', () => ({
  getInitialPreferences,
  saveLocalPreference,
  savePreferences,
}));

import {
  skipAutoSendConfirm,
  rememberAutoSendConfirm,
  AUTO_SEND_CONFIRM_PREF_PATH,
} from '../services/chat/autoSendConfirmPref';

beforeEach(() => {
  vi.clearAllMocks();
  savePreferences.mockResolvedValue({});
});
afterEach(() => vi.restoreAllMocks());

describe('[AUTOSENDREMEMBER] 🔴 the default is ASK', () => {
  it.each([
    ['a legacy account with no preferences at all', null],
    ['preferences that exist but have no chat section', {}],
    ['a chat section that never set the flag', { chat: {} }],
    ['the flag explicitly false', { chat: { skip_auto_send_confirm: false } }],
    ['the flag null', { chat: { skip_auto_send_confirm: null } }],
    ['the flag undefined', { chat: { skip_auto_send_confirm: undefined } }],
    ['a truthy string instead of a boolean', { chat: { skip_auto_send_confirm: 'yes' } }],
    ['the number 1', { chat: { skip_auto_send_confirm: 1 } }],
    ['the flag on the wrong level', { skip_auto_send_confirm: true }],
    ['chat holding a non-object', { chat: 'on' }],
  ])('%s ⇒ still asks', (_name, prefs) => {
    getInitialPreferences.mockReturnValue(prefs);

    expect(skipAutoSendConfirm()).toBe(false);
  });

  it('unreadable storage asks rather than assuming consent', () => {
    getInitialPreferences.mockImplementation(() => {
      throw new Error('localStorage is disabled');
    });

    expect(skipAutoSendConfirm()).toBe(false);
  });

  it('a stored literal true — and only that — skips the confirm', () => {
    getInitialPreferences.mockReturnValue({ chat: { skip_auto_send_confirm: true } });

    expect(skipAutoSendConfirm()).toBe(true);
  });
});

describe('[AUTOSENDREMEMBER] remembering writes once, locally first', () => {
  it('writes the local cache synchronously so the very next send sees it', () => {
    rememberAutoSendConfirm(true);

    // The send happens in the same tick as the confirm; a value that only
    // existed after a network round trip would be read too late.
    expect(saveLocalPreference).toHaveBeenCalledTimes(1);
    expect(saveLocalPreference).toHaveBeenCalledWith({
      chat: { skip_auto_send_confirm: true },
    });
  });

  it('persists to the account as well, so another device inherits it', () => {
    rememberAutoSendConfirm(true);

    expect(savePreferences).toHaveBeenCalledWith({
      chat: { skip_auto_send_confirm: true },
    });
  });

  it('🔴 a failed save never reaches the caller — the message still goes out', async () => {
    savePreferences.mockRejectedValue(new Error('network down'));

    expect(() => rememberAutoSendConfirm(true)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // let the rejection settle
  });

  it('🔴 storage that throws does not stop the server write', () => {
    saveLocalPreference.mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => rememberAutoSendConfirm(true)).not.toThrow();
    expect(savePreferences).toHaveBeenCalled();
  });

  it('can be turned back off through the same door', () => {
    rememberAutoSendConfirm(false);

    expect(saveLocalPreference).toHaveBeenCalledWith({
      chat: { skip_auto_send_confirm: false },
    });
  });

  it('the documented path matches what is actually written', () => {
    // A drift guard: the constant is what other code and any future settings
    // screen would reference, so it must describe the real shape.
    rememberAutoSendConfirm(true);
    const patch = saveLocalPreference.mock.calls[0]![0] as Record<string, any>;
    const [section, key] = AUTO_SEND_CONFIRM_PREF_PATH.split('.');

    expect(patch[section!]).toBeDefined();
    expect(patch[section!][key!]).toBe(true);
  });
});
