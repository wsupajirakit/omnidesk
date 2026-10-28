/**
 * [FIX-20260909-LOADINGLOOK] Both places you wait for a translation wait the
 * same way — and there is only one copy of the four balls.
 *
 * 🔴 Owner, 09/09, twice: first *"loading ball effect สีสันสวย ๆ ม่วงเข้ม ม่วงอ่อน
 *    ฟ้าเข้ม ฟ้าอ่อน"*, then — when only the modal had it — *"loading ยังไม่สวยนะ
 *    … ที่จุดที่ต้องรอโหลดแปลภาษา"*. The composer strip still had a grey spinner,
 *    so the same action looked like two features depending on where it started.
 *
 * ⚠️ WHY A SOURCE TEST AND NOT A RENDER TEST: jsdom computes no animation and no
 *    layout, so "it looks the same" cannot be observed — what CAN be observed is
 *    that neither call site owns its own copy of the colours. That is the thing
 *    that would drift.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

const DOTS = read('components/chat/TranslateLoadingDots.tsx');
const SITES = {
  'the picker modal': read('components/chat/LanguagePicker.tsx'),
  'the composer strip': read('components/chat/chat-input/ComposerTranslateTray.tsx'),
};

describe('the translate wait has ONE look', () => {
  it('⭐⭐ the four colours the owner asked for, written exactly once', () => {
    for (const c of ['bg-violet-600', 'bg-violet-300', 'bg-sky-600', 'bg-sky-300']) {
      expect(DOTS).toContain(c);
    }
  });

  it('⭐⭐⭐ every place that waits renders the shared component', () => {
    for (const [what, src] of Object.entries(SITES)) {
      expect(src, what).toContain('TranslateLoadingDots');
    }
  });

  it('⭐⭐⭐ and no call site keeps a private copy of the balls', () => {
    /* the drift this file exists to stop: a fifth colour, or a changed timing,
       landing in one of the two and not the other */
    for (const [what, src] of Object.entries(SITES)) {
      expect(src, what).not.toMatch(/bg-violet-\d00/);
      expect(src, what).not.toMatch(/animate-bounce|tc-balls-run/);
    }
  });

  it('⭐⭐ it is the TRAVELLING ball, not the bounce that was built first', () => {
    /* Owner sent a react-loading screenshot: the balls move right and the box
       clips them. A bounce-in-place is a different animation wearing the same
       name, and that is what the first attempt shipped. */
    expect(DOTS).toContain('tc-balls-run');
    expect(DOTS).toContain('overflow-hidden');
    /* comments stripped: the header EXPLAINS the bounce it replaced, and that
       sentence is worth keeping — it is the class in the markup that must be
       gone, not the word on the page */
    expect(DOTS.replace(/\/\*[\s\S]*?\*\//g, ' ')).not.toContain('animate-bounce');
    const css = read('index.css');
    expect(css).toContain('@keyframes tcBallsRun');
    /* geometry in ball-widths, so one keyframe serves every size */
    expect(css).toMatch(/tcBallsRun[\s\S]{0,160}translateX\(-100%\)/);
    expect(css).toMatch(/tcBallsRun[\s\S]{0,200}translateX\(600%\)/);
  });

  it('⭐ the composer strip no longer rounds a grey Loader2 at the admin', () => {
    expect(SITES['the composer strip']).not.toContain('Loader2');
  });
});
