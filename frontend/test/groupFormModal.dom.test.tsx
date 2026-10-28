/**
 * [FEAT-20260915-GROUPFORM] Tests for GroupFormModal:
 * - Dynamic height: panel uses max-h-[90vh] instead of locked h-[90vh]
 * - Required clone on create: validates cloneFrom when cloneSources exist
 * - Updated label (without "(ไม่บังคับ)") and hint text
 * - Edit mode does not require clone
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GroupFormModal } from '../components/admin/GroupFormModal';
import { I18nProvider } from '../i18n';
import type { GroupEntry } from '../types';

const MOCK_GROUPS: GroupEntry[] = [
  { _id: 'g1', group_name: 'Group A', description: 'Desc A', status: true },
  { _id: 'g2', group_name: 'Group B', description: 'Desc B', status: true },
];

const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

describe('[GROUPFORM] GroupFormModal dynamic height, validation, and i18n', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('panel uses max-h-[90vh] not locked h-[90vh]', () => {
    const { baseElement } = wrap(
      <GroupFormModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        cloneSources={MOCK_GROUPS}
      />,
    );

    const panel = Array.from(baseElement.querySelectorAll('div')).find((d) =>
      /rounded-xl/.test(d.className),
    );
    expect(panel).toBeTruthy();
    expect(panel!.className).toContain('max-h-[90vh]');
    const tokens = panel!.className.split(/\s+/);
    expect(tokens).not.toContain('h-[90vh]');
  });

  it('displays updated label without (ไม่บังคับ) and has red asterisk', () => {
    wrap(
      <GroupFormModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        cloneSources={MOCK_GROUPS}
      />,
    );

    expect(screen.getByText(/คัดลอก Flex Message และ Dynamic Tag จากกลุ่ม/)).toBeInTheDocument();
    expect(screen.queryByText(/\(ไม่บังคับ\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\(optional\)/)).not.toBeInTheDocument();

    // Check hint text
    expect(
      screen.getByText('ให้เลือกกลุ่ม เว็บที่มีความใกล้เคียงกันมากที่สุด หรืออยู่ในเครือเดียวกัน'),
    ).toBeInTheDocument();
  });

  it('validates and blocks submission when cloneFrom is not selected on create', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    wrap(
      <GroupFormModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        cloneSources={MOCK_GROUPS}
      />,
    );

    // Fill group name
    const nameInput = screen.getByPlaceholderText('การตลาด');
    fireEvent.change(nameInput, { target: { value: 'New Group' } });

    // Click submit without choosing clone source
    const saveBtn = screen.getAllByRole('button', { name: /บันทึก/i })[0];
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText('กรุณาเลือกกลุ่มที่ต้องการคัดลอก')).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits successfully when group name and clone source are selected', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    wrap(
      <GroupFormModal
        isOpen={true}
        onClose={onClose}
        onSubmit={onSubmit}
        cloneSources={MOCK_GROUPS}
      />,
    );

    // Fill group name
    const nameInput = screen.getByPlaceholderText('การตลาด');
    fireEvent.change(nameInput, { target: { value: 'New Group' } });

    // Open SearchableSelect
    const selectBtn = screen.getByRole('button', { name: /เลือกกลุ่มต้นแบบ/i });
    fireEvent.click(selectBtn);

    // Select Group A
    const optionA = await screen.findByText('Group A');
    fireEvent.click(optionA);

    // Error should not be present
    expect(screen.queryByText('กรุณาเลือกกลุ่มที่ต้องการคัดลอก')).not.toBeInTheDocument();

    // Click submit
    const saveBtn = screen.getAllByRole('button', { name: /บันทึก/i })[0];
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ group_name: 'New Group' }),
        'g1',
      );
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('edit mode does not require clone and does not display clone field', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    wrap(
      <GroupFormModal
        isOpen={true}
        onClose={onClose}
        onSubmit={onSubmit}
        initialData={MOCK_GROUPS[0]}
        cloneSources={MOCK_GROUPS}
      />,
    );

    // Clone field should not be rendered
    expect(screen.queryByText(/คัดลอก Flex Message และ Dynamic Tag จากกลุ่ม/)).not.toBeInTheDocument();

    // Click submit
    const saveBtn = screen.getAllByRole('button', { name: /บันทึก/i })[0];
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ group_name: 'Group A' }),
        undefined,
      );
      expect(onClose).toHaveBeenCalled();
    });
  });
});
