/**
 * [FIX-20260918-HOOKSORDER] No hook may sit below a conditional return.
 * =============================================================================
 * This exists because it happened, in a build the owner opened: three hooks were
 * added to `RoomTranslateModal` under its `if (!isOpen) return null`. A closed
 * modal ran five hooks, an open one ran eight, and the first open threw React
 * error #310 — "Rendered more hooks than during the previous render" — which
 * takes the whole chat page down, not just the modal.
 *
 * `tsc` cannot see it, the modal's own suites cannot see it (they mount with
 * `isOpen` already true, so the count never changes), and the eslint rules-of-
 * hooks rule does not flag a hook after an early return either. It is only
 * visible by reading the file in order — which is what this does.
 *
 * ## What it checks
 *
 * For every component file that contains a conditional `return` at the top level
 * of a component body, no `useXxx(` call may appear after it. Comments and
 * strings are stripped first so a hook NAMED in a comment (this repo's comments
 * quote code constantly) cannot produce a false alarm.
 *
 * Scoped to the components this session touched plus the two that hold early
 * returns today — a whole-repo sweep belongs in its own change, with its own
 * baseline. เอาไว้กันไฟล์ที่เพิ่งแก้ก่อน ค่อยขยายทีหลัง
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = [
  'components/chat/room-header/parts/room-translate/RoomTranslateModal.tsx',
  'components/chat/room-header/parts/room-translate/RoomTranslateWizardSteps.tsx',
  'components/chat/room-header/parts/room-translate/RoomLangRequiredNotice.tsx',
  'components/chat/room-header/parts/room-translate/ScrollHintArrows.tsx',
  'components/chat/room-header/parts/room-translate/Step4LangSummary.tsx',
  /* [FEAT-20260919-SHOWORIGSRC] added 19/09 — the modal gained two hooks and a
     new section this round, which is exactly the change that caused the #310
     crash this guard was written for. */
  'components/chat/room-header/parts/room-translate/Step2ShowOriginal.tsx',
  'components/chat/room-header/parts/room-translate/ShowOriginalSourceChoice.tsx',
  'components/chat/room-header/parts/room-translate/AllRoomsShowOriginalSection.tsx',
  'components/chat/room-header/parts/HeaderActions.tsx',
  'components/chat/chat-input/AutoSendConfirm.tsx',
];

/** Block comments, line comments and string bodies — all noise for this check. */
const strip = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

const read = (f: string) => strip(readFileSync(resolve(__dirname, '..', f), 'utf8'));

/** `useThing(`, `useThing<T>(`, `useThing <T> (` — all of them. */
const HOOK_CALL = /\buse[A-Z]\w*\s*(?:<[^;\n]*>)?\s*\(/g;

describe('[HOOKSORDER] every hook sits above the early return', () => {
  it.each(FILES)('%s', (file) => {
    const src = read(file);

    /* A conditional early return at component-body indentation. Two spaces is
       what this codebase uses for a component's own statements; a deeper one is
       inside a callback and is not a hook boundary. */
    const guard = src.match(/\n {2}if \([^\n]*\)\s*return [^\n]*;/);
    if (!guard) return; // no early return in this file — nothing to police

    const after = src.slice(guard.index! + guard[0].length);
    /* ⚠️ The generic is load-bearing in this pattern: `useRef<HTMLDivElement>(`
       and `useState<1 | 2 | 3 | 4>(` do NOT match a bare `useXxx(`. The first
       version of this guard missed exactly that, so a mutation that moved a
       `useRef<…>` below the early return stayed green — the check was measuring
       nothing for the one file it was written for. ต้องเผื่อ generic ไม่งั้นจับไม่ได้ */
    const hooksAfter = after.match(HOOK_CALL) ?? [];

    expect(hooksAfter).toEqual([]);
  });

  it('🔴 a hook WITH A GENERIC is caught — the hole the first version had', () => {
    const bad = strip(`
export const Broken = ({ isOpen }) => {
  const [a] = useState(false);

  if (!isOpen) return null;

  const ref = useRef<HTMLDivElement>(null);
  return <div ref={ref}>{a}</div>;
};
`);
    const guard = bad.match(/\n {2}if \([^\n]*\)\s*return [^\n]*;/);
    const after = bad.slice(guard!.index! + guard![0].length);

    expect(after.match(HOOK_CALL)).toHaveLength(1);
  });

  it('🔴 the check can actually fail — it is not matching nothing', () => {
    // A file shaped like the bug, to prove the regex finds what it claims to.
    const bad = strip(`
export const Broken = ({ isOpen }) => {
  const [a, setA] = useState(false);

  if (!isOpen) return null;

  const [b, setB] = useState(false);
  return <div>{a}{b}</div>;
};
`);
    const guard = bad.match(/\n {2}if \([^\n]*\)\s*return [^\n]*;/);
    const after = bad.slice(guard!.index! + guard![0].length);

    expect(guard).toBeTruthy();
    expect(after.match(HOOK_CALL)).toEqual(['useState(']);
  });

  it('a hook merely NAMED in a comment does not trip it', () => {
    const fine = strip(`
export const Fine = ({ isOpen }) => {
  const [a] = useState(false);

  if (!isOpen) return null;

  /* useState( lives above this line, never below it */
  return <div>{a}</div>;
};
`);
    const guard = fine.match(/\n {2}if \([^\n]*\)\s*return [^\n]*;/);
    const after = fine.slice(guard!.index! + guard![0].length);

    expect(after.match(HOOK_CALL)).toBeNull();
  });
});
