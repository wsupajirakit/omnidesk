/**
 * [FEAT-20260821-QUOTEREPLY] The quote block INSIDE a bubble — what the operator
 * sees on a message that quoted another. Resolves by the provider id the BE
 * stores (`quoted_provider_msg_id` → a sibling's `provider_msg_id`), never by our
 * own `_id`, because that is the id-space LINE speaks.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { QuotedReference } from '../components/chat/QuotedReference';
import { quotedCustomerLabel } from '../components/chat/replyTarget';
import type { ChatMessage } from '../services/chat/chatService';

const msg = (over: Partial<ChatMessage> & { _id: string }): ChatMessage =>
  ({ sender_type: 'customer', message_type: 'text', content: '', created_at: '2026-08-21T10:00:00Z', ...over }) as ChatMessage;

describe('QuotedReference', () => {
  it('renders nothing at all for a message that quotes nothing', () => {
    const { container } = render(<QuotedReference msg={msg({ _id: 'a' })} messages={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows who wrote the quoted message and its text, resolved by provider id', () => {
    const quoted = msg({ _id: 'c1', provider_msg_id: '625', content: 'โอนแล้วครับ', sender_type: 'customer' });
    const ours = msg({ _id: 'b1', sender_type: 'bot', content: 'รับทราบค่ะ', quoted_provider_msg_id: '625' });
    render(<QuotedReference msg={ours} messages={[quoted, ours]} />);
    // owner 21/08: the customer is NAMED; with no identity at all the word is "member"
    expect(screen.getByText('member')).toBeTruthy();
    expect(screen.getByText('โอนแล้วครับ')).toBeTruthy();
  });

  it('a quoted IMAGE reads as "รูปภาพ" — same wording as the composer bar', () => {
    const quoted = msg({ _id: 'c2', provider_msg_id: '626', message_type: 'image', content: '' });
    const ours = msg({ _id: 'b2', sender_type: 'bot', content: 'x', quoted_provider_msg_id: '626' });
    render(<QuotedReference msg={ours} messages={[quoted, ours]} />);
    expect(screen.getByText('รูปภาพ')).toBeTruthy();
  });

  it('quoted message not in the loaded window → a neutral stand-in, never a crash or a blank', () => {
    const ours = msg({ _id: 'b3', sender_type: 'bot', content: 'x', quoted_provider_msg_id: '999' });
    render(<QuotedReference msg={ours} messages={[ours]} />);
    expect(screen.getByText('ข้อความที่อ้างถึง')).toBeTruthy();
  });

  it('a customer quoting OUR message shows "แอดมิน" as the author', () => {
    const ours = msg({ _id: 'b4', sender_type: 'bot', provider_msg_id: '700', content: 'ยอดเข้าแล้วค่ะ', metadata: { sender_name: 'op1' } });
    const theirs = msg({ _id: 'c4', sender_type: 'customer', content: 'ขอบคุณ', quoted_provider_msg_id: '700' });
    render(<QuotedReference msg={theirs} messages={[ours, theirs]} />);
    expect(screen.getByText('แอดมิน')).toBeTruthy();
    expect(screen.getByText('ยอดเข้าแล้วค่ะ')).toBeTruthy();
  });

  it('a real bot message (no operator name) quoted by a customer reads "บอท"', () => {
    const bot = msg({ _id: 'b5', sender_type: 'bot', provider_msg_id: '701', content: 'สวัสดีค่ะ' });
    const theirs = msg({ _id: 'c5', sender_type: 'customer', content: 'x', quoted_provider_msg_id: '701' });
    render(<QuotedReference msg={theirs} messages={[bot, theirs]} />);
    expect(screen.getByText('บอท')).toBeTruthy();
  });

  /* [FEAT-20260821-QUOTEJUMP] owner: the quoted customer's NAME, not the word
     "ลูกค้า" — full name → phone → LINE display name → "member". And the block is
     a way back to the message: click → jump to it. */
  describe('who the customer is, in the owner\'s order', () => {
    const user = (o: Record<string, unknown>) => o as never;
    it('full name first', () => {
      expect(quotedCustomerLabel(user({ full_name: 'สมชาย ใจดี', phone_number: '0812345678', display_name: 'Sz' }))).toBe('สมชาย ใจดี');
    });
    it('then phone', () => {
      expect(quotedCustomerLabel(user({ full_name: '', phone_number: '0812345678', display_name: 'Sz' }))).toBe('0812345678');
    });
    it('then LINE display name', () => {
      expect(quotedCustomerLabel(user({ phone_number: '', display_name: 'Sz' }))).toBe('Sz');
    });
    it('then the word "member" — never blank, never "Unknown"', () => {
      expect(quotedCustomerLabel(user({ display_name: 'Unknown' }))).toBe('member');
      expect(quotedCustomerLabel(undefined)).toBe('member');
    });
    it('the block uses it for a customer message', () => {
      const quoted = msg({ _id: 'c9', provider_msg_id: '900', content: 'โอนแล้ว' });
      const ours = msg({ _id: 'b9', sender_type: 'bot', content: 'x', quoted_provider_msg_id: '900' });
      render(<QuotedReference msg={ours} messages={[quoted, ours]} customer={user({ full_name: 'สมชาย ใจดี' })} />);
      expect(screen.getByText('สมชาย ใจดี')).toBeTruthy();
    });
  });

  describe('snippet by kind — content placeholders never leak', () => {
    it('an image whose content is the literal "[image]" still reads "รูปภาพ"', () => {
      const quoted = msg({ _id: 'c10', provider_msg_id: '901', message_type: 'image', content: '[image]' });
      const ours = msg({ _id: 'b10', sender_type: 'bot', content: 'x', quoted_provider_msg_id: '901' });
      render(<QuotedReference msg={ours} messages={[quoted, ours]} />);
      expect(screen.getByText('รูปภาพ')).toBeTruthy();
      expect(screen.queryByText('[image]')).toBeNull();
    });
    it('a sticker whose content is "[sticker]" reads "สติกเกอร์"', () => {
      const quoted = msg({ _id: 'c11', provider_msg_id: '902', message_type: 'sticker', content: '[sticker]' });
      const ours = msg({ _id: 'b11', sender_type: 'bot', content: 'x', quoted_provider_msg_id: '902' });
      render(<QuotedReference msg={ours} messages={[quoted, ours]} />);
      expect(screen.getByText('สติกเกอร์')).toBeTruthy();
    });
  });

  describe('click → jump', () => {
    it('quoted message loaded → onJump with OUR _id', () => {
      const onJump = vi.fn();
      const quoted = msg({ _id: 'c12', provider_msg_id: '903', content: 'hi' });
      const ours = msg({ _id: 'b12', sender_type: 'bot', content: 'x', quoted_provider_msg_id: '903' });
      render(<QuotedReference msg={ours} messages={[quoted, ours]} onJump={onJump} />);
      fireEvent.click(screen.getByRole('button'));
      expect(onJump).toHaveBeenCalledWith({ id: 'c12', providerMsgId: '903' });
    });
    it('quoted message NOT loaded → onJump with the provider id only, so the host can fetch around it', () => {
      const onJump = vi.fn();
      const ours = msg({ _id: 'b13', sender_type: 'bot', content: 'x', quoted_provider_msg_id: '904' });
      render(<QuotedReference msg={ours} messages={[ours]} onJump={onJump} />);
      fireEvent.click(screen.getByRole('button'));
      expect(onJump).toHaveBeenCalledWith({ id: null, providerMsgId: '904' });
    });
    it('without onJump the block is plain — no button role, nothing to click', () => {
      const quoted = msg({ _id: 'c14', provider_msg_id: '905', content: 'hi' });
      const ours = msg({ _id: 'b14', sender_type: 'bot', content: 'x', quoted_provider_msg_id: '905' });
      render(<QuotedReference msg={ours} messages={[quoted, ours]} />);
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  /* [FEAT-20260831-QUOTESRC] A room opens with TEN messages, so quoting anything
     older left this block with nothing to resolve and it drew the stand-in — which
     is what the owner saw. The BE now resolves the quoted message for the page it
     returns (`quoted_preview`), and this is the fallback that uses it.
     Order: the loaded row first (it is the same row, and it is already here),
     then the BE's answer, then the stand-in. */
  describe('quoted message outside the loaded window — the BE resolved it', () => {
    const preview = (o: Record<string, unknown>) => o as never;

    it('shows the source text even though the message is not in the window', () => {
      const ours = msg({
        _id: 'p1',
        sender_type: 'bot',
        content: 'รับทราบค่ะ',
        quoted_provider_msg_id: '1001',
        quoted_preview: preview({
          id: 'old-1',
          sender_type: 'customer',
          message_type: 'text',
          text: 'สลิปยอดนี้ครับ',
        }),
      });
      render(<QuotedReference msg={ours} messages={[ours]} />);
      expect(screen.getByText('สลิปยอดนี้ครับ')).toBeTruthy();
      expect(screen.queryByText('ข้อความที่อ้างถึง')).toBeNull();
    });

    it('names the customer from the room, exactly as it does for a loaded row', () => {
      const ours = msg({
        _id: 'p2',
        sender_type: 'bot',
        content: 'x',
        quoted_provider_msg_id: '1002',
        quoted_preview: preview({ id: 'old-2', sender_type: 'customer', message_type: 'text', text: 'hi' }),
      });
      render(
        <QuotedReference msg={ours} messages={[ours]} customer={{ full_name: 'สมชาย ใจดี' } as never} />,
      );
      expect(screen.getByText('สมชาย ใจดี')).toBeTruthy();
    });

    it('an operator name in the preview reads "แอดมิน", a bare bot row reads "บอท"', () => {
      const withName = msg({
        _id: 'p3',
        sender_type: 'customer',
        content: 'ขอบคุณ',
        quoted_provider_msg_id: '1003',
        quoted_preview: preview({
          id: 'old-3',
          sender_type: 'bot',
          message_type: 'text',
          text: 'ยอดเข้าแล้วค่ะ',
          sender_name: 'CS_Daw',
        }),
      });
      const { unmount } = render(<QuotedReference msg={withName} messages={[withName]} />);
      expect(screen.getByText('แอดมิน')).toBeTruthy();
      unmount();

      const noName = msg({
        _id: 'p4',
        sender_type: 'customer',
        content: 'x',
        quoted_provider_msg_id: '1004',
        quoted_preview: preview({ id: 'old-4', sender_type: 'bot', message_type: 'text', text: 'สวัสดีค่ะ' }),
      });
      render(<QuotedReference msg={noName} messages={[noName]} />);
      expect(screen.getByText('บอท')).toBeTruthy();
    });

    it('media in the preview is worded, never printed — the same wording as a loaded row', () => {
      const ours = msg({
        _id: 'p5',
        sender_type: 'bot',
        content: 'x',
        quoted_provider_msg_id: '1005',
        quoted_preview: preview({ id: 'old-5', sender_type: 'customer', message_type: 'image', text: '[image]' }),
      });
      render(<QuotedReference msg={ours} messages={[ours]} />);
      expect(screen.getByText('รูปภาพ')).toBeTruthy();
      expect(screen.queryByText('[image]')).toBeNull();
    });

    it('the loaded row still wins — a stale preview cannot override what is on screen', () => {
      const quoted = msg({ _id: 'c15', provider_msg_id: '1006', content: 'ของจริงในหน้าต่าง' });
      const ours = msg({
        _id: 'p6',
        sender_type: 'bot',
        content: 'x',
        quoted_provider_msg_id: '1006',
        quoted_preview: preview({ id: 'c15', sender_type: 'customer', message_type: 'text', text: 'ของเก่าจาก BE' }),
      });
      render(<QuotedReference msg={ours} messages={[quoted, ours]} />);
      expect(screen.getByText('ของจริงในหน้าต่าง')).toBeTruthy();
    });

    it('jumping uses the id the BE resolved — no second round trip to find it', () => {
      const onJump = vi.fn();
      const ours = msg({
        _id: 'p7',
        sender_type: 'bot',
        content: 'x',
        quoted_provider_msg_id: '1007',
        quoted_preview: preview({ id: 'old-7', sender_type: 'customer', message_type: 'text', text: 'hi' }),
      });
      render(<QuotedReference msg={ours} messages={[ours]} onJump={onJump} />);
      fireEvent.click(screen.getByRole('button'));
      expect(onJump).toHaveBeenCalledWith({ id: 'old-7', providerMsgId: '1007' });
    });

    it('no preview and nothing loaded → the stand-in is still what shows', () => {
      const ours = msg({ _id: 'p8', sender_type: 'bot', content: 'x', quoted_provider_msg_id: '1008' });
      render(<QuotedReference msg={ours} messages={[ours]} />);
      expect(screen.getByText('ข้อความที่อ้างถึง')).toBeTruthy();
    });
  });
});
