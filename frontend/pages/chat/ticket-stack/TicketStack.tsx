import React, { type ReactNode } from 'react';
import { ChevronDown, Layers } from 'lucide-react';
import type { TicketStacks } from './groupTicketStacks';
import type { StackExpand } from './useStackExpand';
import { useI18n } from '../../../i18n';

/**
 * [FEAT-20261020-TICKETSTACK] The stack's chrome only — the cards themselves are
 * the page's own card markup, passed in through `renderCard`, so there is ONE
 * card design and this file can never drift from it.
 *
 * Folded:   front card (newest) → toggle bar [count ⌄] → two thin "paper" edges
 * Unfolded: front card → toggle bar [count ⌃] → every older card, full size,
 *           indented behind an accent rail (owner chose full cards, 20/10)
 *
 * The count pill is indigo on purpose: red is the unread badge, amber is the
 * "new" highlight — this number must never be mistaken for either, and it is not
 * part of any tab count. ตัวเลขนี้นับใบในกอง ไม่ใช่ตัวเลขแท็บ ไม่ใช่ยังไม่อ่าน.
 */
interface StackToggleProps {
  groupKey: string;
  size: number;
  expanded: boolean;
  onToggle: (key: string) => void;
  /** 'bar' = full-width strip under a list card · 'inline' = inside the closed-case card */
  variant?: 'bar' | 'inline';
}

const panelIdOf = (key: string) => `tc-stack-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`;

export function StackToggle({ groupKey, size, expanded, onToggle, variant = 'bar' }: StackToggleProps) {
  const { t } = useI18n();
  const older = size - 1;
  const shape =
    variant === 'bar'
      ? 'w-full pl-[52px] pr-3 py-1.5 border-b border-gray-100 dark:border-gray-800/60 bg-slate-50/90 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/60'
      : 'w-full mt-1 px-2.5 py-1.5 rounded-lg border border-slate-200/80 dark:border-slate-700/80 bg-white/70 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-700/60';
  return (
    <button
      type="button"
      data-ticket-stack-toggle
      aria-expanded={expanded}
      aria-controls={panelIdOf(groupKey)}
      title={expanded ? t('ticketui.stack.fold', 'พับเคสก่อนหน้า') : t('ticketui.stack.view_title', 'ดูเคสก่อนหน้าของลูกค้านี้อีก {n} เคส', { n: older })}
      // the card underneath opens the chat on click — the toggle must not
      onClick={(e) => {
        e.stopPropagation();
        onToggle(groupKey);
      }}
      className={`${shape} flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300 transition-colors`}
    >
      <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
        <Layers size={12} className="shrink-0 text-indigo-500 dark:text-indigo-300" />
        {expanded ? t('ticketui.stack.fold', 'พับเคสก่อนหน้า') : t('ticketui.stack.more', 'เคสก่อนหน้าอีก {n} เคส', { n: older })}
      </span>
      <span className="inline-flex items-center gap-1 shrink-0">
        <span
          data-ticket-stack-count
          className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold leading-none bg-indigo-100 text-indigo-700 dark:bg-indigo-500/25 dark:text-indigo-100"
        >
          {size}
        </span>
        <ChevronDown size={14} className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      </span>
    </button>
  );
}

interface TicketStackProps {
  groupKey: string;
  size: number;
  expanded: boolean;
  onToggle: (key: string) => void;
  front: ReactNode;
  rest: ReactNode[];
}

export function TicketStack({ groupKey, size, expanded, onToggle, front, rest }: TicketStackProps) {
  const { t } = useI18n();
  return (
    <div data-ticket-stack={groupKey} className="relative">
      {front}
      <StackToggle groupKey={groupKey} size={size} expanded={expanded} onToggle={onToggle} />
      {expanded ? (
        <div
          id={panelIdOf(groupKey)}
          role="group"
          aria-label={t('ticketui.stack.group_label', 'เคสก่อนหน้า {n} เคส', { n: size - 1 })}
          className="ml-[22px] border-l-2 border-indigo-300 dark:border-indigo-500/60"
        >
          {rest}
        </div>
      ) : (
        <div aria-hidden className="pointer-events-none" data-ticket-stack-edges>
          <div className="mx-3 h-1 rounded-b-md bg-slate-200/90 dark:bg-slate-700/80" />
          <div className="mx-6 h-1 rounded-b-md bg-slate-100 dark:bg-slate-800/80" />
        </div>
      )}
    </div>
  );
}

/**
 * Render one slot of the list: a plain card, or a stack around it.
 * `stacks === null` (flag off) or a stack of one ⇒ exactly `renderCard(front, idx)`
 * — the page's original output, untouched.
 * Older cards get index -1 so the card window never animates them as "fresh".
 */
export function renderTicketStackSlot<T extends { _id: string }>(
  stacks: TicketStacks<T> | null,
  front: T,
  frontIdx: number,
  expand: StackExpand,
  renderCard: (tk: T, cardIdx: number) => ReactNode,
): ReactNode {
  const group = stacks?.byFront.get(String(front._id));
  if (!group || group.rest.length === 0) return renderCard(front, frontIdx);
  const open = expand.isOpen(group.key);
  return (
    <TicketStack
      key={group.key}
      groupKey={group.key}
      size={group.size}
      expanded={open}
      onToggle={expand.toggle}
      front={renderCard(front, frontIdx)}
      rest={open ? group.rest.map((tk) => renderCard(tk, -1)) : []}
    />
  );
}
