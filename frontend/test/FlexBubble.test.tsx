import { describe, it, expect } from 'vitest';
import { render as rtlRender } from '@testing-library/react';
import React from 'react';
import { FlexBubble, canRenderFlex } from '../components/chat/FlexBubble';

/**
 * [FEAT-20260809-FLEXRENDER] Contract tests for the spec-accurate Flex renderer.
 *
 * Two things are locked down here, and they fail for different reasons:
 *   (A) SECURITY — the sanitiser must strip every script vector. These assert on the
 *       rendered DOM, so they break the moment DOMPurify or PURIFY_CONFIG is weakened.
 *   (B) SPEC COVERAGE — the five LINE features the legacy renderer got wrong. Each case
 *       is drawn from a real `flex_messages` row shape, so a regression here means real
 *       customer templates render wrong again.
 * เทสนี้ต้องพังถ้ามีคนถอด DOMPurify หรือถอยกลับไปตัววาดเอง.
 */

const html = (json: any) => rtlRender(<FlexBubble json={json} />).container.innerHTML;

describe('FlexBubble — security (must strip all script vectors)', () => {
  it('escapes markup injected through text (stored XSS via content_json)', () => {
    const out = html({
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: [
        { type: 'text', text: '<img src=x onerror="alert(1)">' },
      ] },
    });
    // What matters is that NOTHING EXECUTES. DOMPurify keeps a neutered <img> (the tag is
    // allow-listed because Flex genuinely uses images) but strips the onerror handler and
    // the src that triggers it — so the payload can never fire.
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/src=["']?x/i);
  });

  it('strips the onclick that flex-render itself emits for actions', () => {
    // Not hypothetical: scanning all 151 real templates showed flex-render emitting
    // onclick="…" in its generated markup, so ordinary data reaches this path.
    const out = html({
      type: 'bubble',
      footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary',
          action: { type: 'message', label: 'tap', text: "'); alert(1); ('" } },
      ] },
    });
    expect(out).not.toMatch(/onclick/i);
  });

  it('drops javascript: URIs on link actions', () => {
    const out = html({
      type: 'bubble',
      footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', action: { type: 'uri', label: 'go', uri: 'javascript:alert(1)' } },
      ] },
    });
    expect(out).not.toMatch(/javascript:/i);
  });

  it('keeps legitimate content while sanitising', () => {
    const out = html({
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: [
        { type: 'text', text: 'ยอดโอน 500 บาท', color: '#00C853', weight: 'bold' },
      ] },
    });
    expect(out).toContain('ยอดโอน 500 บาท');
    expect(out).toContain('#00C853');
  });
});

describe('FlexBubble — LINE spec coverage the legacy renderer lacked', () => {
  it('renders layout:"baseline" (413 uses across 11 real templates)', () => {
    const out = html({
      type: 'bubble',
      body: { type: 'box', layout: 'baseline', contents: [
        { type: 'text', text: 'baseline-probe', flex: 0 },
      ] },
    });
    expect(out).toContain('baseline-probe');
    expect(out.length).toBeGreaterThan(0);
  });

  it('renders EVERY bubble of a carousel, not just the first', () => {
    // The legacy path unwrapped to contents[0]; cards 2..n vanished silently.
    const out = html({
      type: 'carousel',
      contents: [
        { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'card-one' }] } },
        { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'card-two' }] } },
        { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'card-three' }] } },
      ],
    });
    expect(out).toContain('card-one');
    expect(out).toContain('card-two');
    expect(out).toContain('card-three');
  });

  it('accepts the {type:"flex"} envelope as well as a bare container', () => {
    const out = html({
      type: 'flex', altText: 'alt',
      contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'enveloped' }] } },
    });
    expect(out).toContain('enveloped');
  });

  it('renders span children (multi-colour text in one line)', () => {
    const out = html({
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: [
        { type: 'text', contents: [
          { type: 'span', text: 'part-a', weight: 'bold' },
          { type: 'span', text: 'part-b', color: '#FF0000' },
        ] },
      ] },
    });
    expect(out).toContain('part-a');
    expect(out).toContain('part-b');
  });
});

describe('FlexBubble — fallback safety', () => {
  it('canRenderFlex gates only real containers', () => {
    expect(canRenderFlex({ type: 'bubble' })).toBe(true);
    expect(canRenderFlex({ type: 'carousel' })).toBe(true);
    expect(canRenderFlex({ type: 'flex', contents: { type: 'bubble' } })).toBe(true);
    // Anything else must fall through to the legacy renderer rather than blank the card.
    expect(canRenderFlex(null)).toBe(false);
    expect(canRenderFlex({ type: 'text' })).toBe(false);
    expect(canRenderFlex({})).toBe(false);
  });

  it('renders nothing (never throws) on malformed JSON', () => {
    expect(() => rtlRender(<FlexBubble json={{ type: 'bubble', body: 'not-an-object' }} />)).not.toThrow();
  });
});

/**
 * [FEAT-20260817-ADMINBTNLINK] Buttons in the ADMIN chat view lead somewhere.
 *
 * WHY THIS EXISTS: a card's buttons are `postback` / `message` actions, which
 * flex-render emits as `<a onclick="alert(…)">` with NO href. The sanitiser
 * strips every `on*` handler (correctly — that is the XSS guard), so in the
 * ticket-support chat an admin sees buttons that do nothing at all.
 *
 * THE RULE (owner, 17/08): the customer's button in LINE must keep working
 * exactly as it does — this changes NOTHING on the wire — while the copy an
 * admin looks at in the dashboard opens `https://google.com` when clicked.
 *
 * HOW, and why not `onclick`: the actions are rewritten to `uri` actions BEFORE
 * rendering, so flex-render emits a real `<a href>` that survives the
 * allow-list. No handler is ever restored — the file's security note stays true.
 * ลูกค้ากดใน LINE ได้เหมือนเดิม · แอดมินกดในแดชบอร์ดไป google
 *
 * OPT-IN: only a caller that passes `linkButtonsTo` is affected. The flex
 * DESIGNER preview deliberately does not, so it keeps showing the customer's
 * card untouched.
 */
describe('[FEAT-20260817-ADMINBTNLINK] admin-side button links', () => {
  const card = (action: any) => ({
    type: 'bubble',
    footer: { type: 'box', layout: 'vertical', contents: [
      { type: 'button', style: 'secondary', action },
    ] },
  });
  const RETRY = { type: 'postback', label: 'ลองใหม่', data: 'pay:resume:RUN1:1' };
  const ADMIN = { type: 'message', label: 'ติดต่อแอดมิน', text: 'ติดต่อแอดมิน' };

  it('without the prop nothing changes — a postback button still has no href', () => {
    const out = html(card(RETRY));
    expect(out).toContain('ลองใหม่');
    expect(out).not.toContain('href');
  });

  it('with the prop a postback button becomes a real link to the target', () => {
    const out = rtlRender(
      <FlexBubble json={card(RETRY)} linkButtonsTo="https://google.com" />,
    ).container;
    const a = out.querySelector('a[href]') as HTMLAnchorElement | null;
    expect(a).toBeTruthy();
    expect(a!.getAttribute('href')).toBe('https://google.com');
    // the label the admin reads must survive the rewrite
    expect(out.innerHTML).toContain('ลองใหม่');
  });

  it('a message button (ติดต่อแอดมิน) is linked too', () => {
    const out = rtlRender(
      <FlexBubble json={card(ADMIN)} linkButtonsTo="https://google.com" />,
    ).container;
    expect(out.querySelector('a[href]')?.getAttribute('href')).toBe('https://google.com');
    expect(out.innerHTML).toContain('ติดต่อแอดมิน');
  });

  it('opens in a new tab and never hands the opener over', () => {
    const a = rtlRender(
      <FlexBubble json={card(RETRY)} linkButtonsTo="https://google.com" />,
    ).container.querySelector('a[href]') as HTMLAnchorElement;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
  });

  it('SECURITY — the rewrite restores no handler', () => {
    const out = rtlRender(
      <FlexBubble json={card(RETRY)} linkButtonsTo="https://google.com" />,
    ).container.innerHTML;
    expect(out).not.toContain('onclick');
  });

  /* The dangerous URI must be blocked on the path where it actually REACHES the
     renderer — without the rewrite. (With `linkButtonsTo` the action is replaced
     before rendering, so asserting it there proves nothing: that was the first
     version of this test and a mutation showed it could not fail.) */
  it('SECURITY — a javascript: uri in the card is still blocked, rewrite or not', () => {
    const evil = card({ type: 'uri', label: 'x', uri: 'javascript:alert(1)' });
    expect(html(evil)).not.toContain('javascript:');
    const linked = rtlRender(
      <FlexBubble json={evil} linkButtonsTo="https://google.com" />,
    ).container.innerHTML;
    expect(linked).not.toContain('javascript:');
  });

  it('leaves non-button content alone', () => {
    const out = rtlRender(
      <FlexBubble
        json={{ type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [
          { type: 'text', text: 'ยอด 400 บาท' },
        ] } }}
        linkButtonsTo="https://google.com"
      />,
    ).container.innerHTML;
    expect(out).toContain('ยอด 400 บาท');
    expect(out).not.toContain('href');
  });

  /* ⚠️ Build the action FRESH here. The first version of this test reused the
     shared `RETRY` const, which an earlier case had already rendered — so if the
     rewrite mutated its input, the damage was done before `before` was captured
     and the assertion compared a mutated object with itself. It passed while a
     mutation that mutates the caller's JSON was live (caught by mutation
     testing, 17/08). เทสที่ใช้ fixture ร่วมกันจับ mutation ไม่ได้ */
  it('the input JSON is never mutated — the caller keeps its postback intact', () => {
    const json = card({ type: 'postback', label: 'ลองใหม่', data: 'pay:resume:RUN1:1' });
    const before = JSON.stringify(json);
    rtlRender(<FlexBubble json={json} linkButtonsTo="https://google.com" />);
    expect(JSON.stringify(json)).toBe(before);
    // stated explicitly: the customer's action must still be a postback
    expect((json.footer.contents[0] as any).action.type).toBe('postback');
    expect((json.footer.contents[0] as any).action.data).toBe('pay:resume:RUN1:1');
  });
});
