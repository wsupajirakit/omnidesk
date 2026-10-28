/**
 * [FEAT-20260830-FLEXBULKGROUPS] change the groups of many flex cards at once.
 *
 * WHY IT IS A BE ENDPOINT AND NOT A LOOP HERE
 *   This repo already does bulk edits server-side in three places
 *   (users/bulk-permissions, users/bulk-active, groups/status/bulk). A client
 *   loop would have been the only inconsistent sibling, would have moved the
 *   scope check into the browser, and would leave half the cards written when
 *   request nine of twenty fails.
 *   🔗 CROSS-REPO: the endpoint lives in `omnidesk-api`
 *   (POST /api/flex-messages/bulk-groups) — see the last describe block, which
 *   pins the two halves against each other.
 *
 * THE RISK THIS FEATURE CARRIES
 *   The write REPLACES `group_ids`. "Add" and "replace" look identical until
 *   somebody loses access, so the tests below pin the warning, the two-step
 *   confirm, and — the real defect this design avoids — that a selection can
 *   never outlive the rows it was made on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import {
  FlexBulkGroupsModal,
  useFlexSelection,
} from '../components/flex/bulk';

const root = join(__dirname, '..');
const readSrc = (p: string) => readFileSync(join(root, p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The page's contract in miniature: a page number, three rows, a selection. */
const SelectionHarness: React.FC = () => {
  const [page, setPage] = useState(1);
  const sel = useFlexSelection(`tab|${page}`);
  return (
    <div>
      <button type="button" onClick={() => setPage((p) => p + 1)}>next-page</button>
      <button type="button" onClick={sel.enter}>enter</button>
      <button type="button" onClick={sel.exit}>exit</button>
      <button type="button" onClick={() => sel.selectMany(['a', 'b', 'c'])}>select-page</button>
      {['a', 'b', 'c'].map((id) => (
        <button key={id} type="button" onClick={() => sel.toggle(id)}>{`t-${id}`}</button>
      ))}
      <output data-testid="state">{`${sel.active ? 'on' : 'off'}:${sel.ids.join(',')}`}</output>
    </div>
  );
};

const state = () => screen.getByTestId('state').textContent;

describe('[FEAT-20260830-FLEXBULKGROUPS] the selection', () => {
  it('TARGET 1: bulk mode is off until asked, and ticking accumulates', () => {
    render(<SelectionHarness />);
    expect(state()).toBe('off:');
    fireEvent.click(screen.getByText('enter'));
    fireEvent.click(screen.getByText('t-a'));
    fireEvent.click(screen.getByText('t-c'));
    expect(state()).toBe('on:a,c');
  });

  it('TARGET 2: ticking the same row twice removes it', () => {
    render(<SelectionHarness />);
    fireEvent.click(screen.getByText('t-a'));
    fireEvent.click(screen.getByText('t-a'));
    expect(state()).toBe('off:');
  });

  it('TARGET 3: "select this page" adds without dropping what was ticked', () => {
    render(<SelectionHarness />);
    fireEvent.click(screen.getByText('t-b'));
    fireEvent.click(screen.getByText('select-page'));
    expect(state()).toBe('off:b,a,c');
  });

  it('TARGET 4: ⭐⭐⭐ changing page CLEARS the selection but stays in bulk mode', () => {
    /* The users page keeps its selection across page changes, so the confirm
       dialog lists fewer names than the write touches and the count it restates
       is wrong. On a REPLACE write that is somebody losing access to a card
       nobody ever named. This feature must not copy that. */
    render(<SelectionHarness />);
    fireEvent.click(screen.getByText('enter'));
    fireEvent.click(screen.getByText('t-a'));
    expect(state()).toBe('on:a');
    fireEvent.click(screen.getByText('next-page'));
    expect(state()).toBe('on:');
  });

  it('TARGET 5: leaving bulk mode drops the selection with it', () => {
    render(<SelectionHarness />);
    fireEvent.click(screen.getByText('enter'));
    fireEvent.click(screen.getByText('t-a'));
    fireEvent.click(screen.getByText('exit'));
    expect(state()).toBe('off:');
  });
});

const GROUPS = [
  { value: 'g1', label: 'Group One' },
  { value: 'g2', label: 'Group Two' },
];

const ModalHarness: React.FC<{ open?: boolean }> = ({ open = true }) => {
  const [isOpen, setIsOpen] = useState(open);
  const [value, setValue] = useState<string[]>([]);
  return (
    <div>
      <button type="button" onClick={() => setIsOpen(true)}>reopen</button>
      <button type="button" onClick={() => setIsOpen(false)}>close-it</button>
      <FlexBulkGroupsModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        names={['card A', 'card B']}
        groups={GROUPS}
        value={value}
        onChange={setValue}
        onConfirm={() => undefined}
        saving={false}
      />
    </div>
  );
};

describe('[FEAT-20260830-FLEXBULKGROUPS] the dialog', () => {
  it('TARGET 6: names every card being changed, and says REPLACE before the picker', () => {
    render(<ModalHarness />);
    expect(screen.getByText('card A')).toBeTruthy();
    expect(screen.getByText('card B')).toBeTruthy();
    expect(screen.getByText('flex.bulk_modal_replace_warning')).toBeTruthy();
  });

  it('TARGET 7: ⭐⭐ cannot advance with no group ticked — the API refuses it', () => {
    render(<ModalHarness />);
    const next = screen.getByText('flex.bulk_next') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Group One', { selector: 'input' }));
    expect((screen.getByText('flex.bulk_next') as HTMLButtonElement).disabled).toBe(false);
  });

  it('TARGET 8: the second step restates the count and the exact groups', () => {
    render(<ModalHarness />);
    fireEvent.click(screen.getByLabelText('Group One', { selector: 'input' }));
    fireEvent.click(screen.getByText('flex.bulk_next'));
    expect(screen.getByText('flex.bulk_confirm_question')).toBeTruthy();
    // once as the checkbox label, once in the summary the second step restates
    expect(screen.getAllByText('Group One').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('flex.bulk_confirm_apply')).toBeTruthy();
  });

  it('TARGET 9: ⭐ reopening starts at step one, never on the Apply button', () => {
    /* The users dialog keeps `confirming` across a close, so cancelling on the
       confirm screen and reopening lands straight back on Apply. Not here. */
    render(<ModalHarness />);
    fireEvent.click(screen.getByLabelText('Group One', { selector: 'input' }));
    fireEvent.click(screen.getByText('flex.bulk_next'));
    expect(screen.queryByText('flex.bulk_confirm_apply')).toBeTruthy();
    fireEvent.click(screen.getByText('close-it'));
    fireEvent.click(screen.getByText('reopen'));
    expect(screen.queryByText('flex.bulk_confirm_apply')).toBeNull();
    expect(screen.getByText('flex.bulk_next')).toBeTruthy();
  });
});

describe('[FEAT-20260830-FLEXBULKGROUPS] the wiring', () => {
  it('PIN 1: the page resets the selection on anything that changes the rows', () => {
    const src = stripComments(readSrc('pages/content/FlexMessageList.tsx'));
    const key = src.match(/useFlexSelection\(\s*`([^`]+)`/)?.[1] ?? '';
    for (const part of ['${tab}', '${currentPage}', '${search}', '${groupFilter}', '${typeFilter}']) {
      expect(key, `reset key must include ${part}`).toContain(part);
    }
  });

  it('PIN 2: the checkbox column is counted — colCount, not a third literal', () => {
    const src = stripComments(readSrc('pages/content/FlexMessageList.tsx'));
    expect(src).toMatch(/const\s+colCount\s*=\s*selection\.active\s*\?\s*6\s*:\s*5/);
    expect(src).not.toMatch(/colSpan=\{[56]\}/);
  });

  it('PIN 3: one request for the batch — the page never loops updateFlexMessage', () => {
    const src = stripComments(readSrc('pages/content/FlexMessageList.tsx'));
    const handler = src.slice(
      src.indexOf('const handleBulkGroups'),
      src.indexOf('const fetchGroups'),
    );
    expect(handler).toContain('bulkUpdateGroups(selection.ids');
    expect(handler).not.toMatch(/for\s*\(|\.map\([^)]*updateFlexMessage|Promise\.all/);
  });
});

describe('[FEAT-20260830-FLEXBULKGROUPS] 🔗 CROSS-REPO contract', () => {
  /* The two halves are only correct together, and nothing else in either repo
     compares them. If BE renames a field or the route, this goes red HERE —
     which is the point: FE is the caller, so FE is where the mismatch bites. */
  // Same resolution the repo's other cross-repo census tests use: from test/,
  // '../../backend' is the sibling back-end checkout.
  const be = (p: string) =>
    stripComments(readFileSync(join(__dirname, '../../backend', p), 'utf8'));

  it('PIN 4: FE posts to the exact route BE declares', () => {
    const fe = stripComments(readSrc('services/media/flexMessageService.ts'));
    expect(fe).toContain("/api/flex-messages/bulk-groups");
    expect(be('src/modules/content/flex-messages.controller.ts')).toContain(
      "@Post('flex-messages/bulk-groups')",
    );
  });

  it('PIN 5: FE sends exactly the two keys the DTO declares', () => {
    const fe = stripComments(readSrc('services/media/flexMessageService.ts'));
    const call = fe.slice(fe.indexOf('bulkUpdateGroups:'), fe.indexOf('deleteFlexMessage:'));
    expect(call).toContain('flex_ids: flexIds');
    expect(call).toContain('group_ids: groupIds');

    const dto = be('src/modules/content/dto/flex-message.dto.ts');
    const cls = dto.slice(dto.indexOf('export class BulkFlexGroupsDto'));
    expect(cls).toContain('flex_ids!: unknown[]');
    expect(cls).toContain('group_ids!: unknown[]');
    // forbidNonWhitelisted is on globally: a third key would be a 400, not a
    // silently ignored field.
    expect(cls.split('}')[0].match(/^\s+\w+!/gm) ?? []).toHaveLength(2);
  });

  it('PIN 6: the fields FE reads off the answer are the ones BE returns', () => {
    const result = be('src/modules/content/flex-messages.service.ts');
    const iface = result.slice(
      result.indexOf('export interface BulkFlexGroupsResult'),
      result.indexOf('export interface FlexMessageListItem'),
    );
    for (const field of ['matched', 'modified', 'group_ids', 'updated', 'skipped']) {
      expect(iface, `BE must return ${field}`).toContain(field);
    }
  });
});
