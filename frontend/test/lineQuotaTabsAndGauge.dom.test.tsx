import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HookPageTabs } from '../components/hook/list/HookPageTabs';
import { LineQuotaGauge } from '../components/hook/quota/line/LineQuotaGauge';
import type { HookQuotaResponse } from '../types';

describe('HookPageTabs component', () => {
  it('renders manage and quota tabs and handles switching', () => {
    const onChange = vi.fn();
    render(<HookPageTabs active="manage" onChange={onChange} />);

    expect(screen.getByTestId('hook-tab-manage')).toBeInTheDocument();
    expect(screen.getByTestId('hook-tab-quota')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('hook-tab-quota'));
    expect(onChange).toHaveBeenCalledWith('quota');
  });
});

describe('LineQuotaGauge component', () => {
  it('renders unlimited quota label correctly', () => {
    const data: HookQuotaResponse = {
      quota: { type: 'none' },
      consumption: { totalUsage: 50 },
      remaining: null,
    };

    render(<LineQuotaGauge data={data} />);
    expect(screen.getByText(/unlimited|ไม่จำกัด/i)).toBeInTheDocument();
  });

  it('renders blue bar for quota usage <= 90%', () => {
    const data: HookQuotaResponse = {
      quota: { type: 'limited', value: 1000 },
      consumption: { totalUsage: 500 },
      remaining: 500,
    };

    const { container } = render(<LineQuotaGauge data={data} />);
    expect(screen.getByText('50%')).toBeInTheDocument();
    const bar = container.querySelector('.bg-blue-500');
    expect(bar).toBeInTheDocument();
  });

  it('renders red bar for quota usage > 90%', () => {
    const data: HookQuotaResponse = {
      quota: { type: 'limited', value: 1000 },
      consumption: { totalUsage: 950 },
      remaining: 50,
    };

    const { container } = render(<LineQuotaGauge data={data} />);
    expect(screen.getByText('95%')).toBeInTheDocument();
    const bar = container.querySelector('.bg-rose-500');
    expect(bar).toBeInTheDocument();
  });

  it('renders loading skeleton when loading is true', () => {
    render(<LineQuotaGauge loading={true} />);
    expect(screen.getByText(/loading|กำลังโหลด/i)).toBeInTheDocument();
  });

  it('renders error state with retry button', () => {
    const onRetry = vi.fn();
    render(<LineQuotaGauge error="Connection error" onRetry={onRetry} />);
    expect(screen.getByText(/error|โหลดไม่สำเร็จ/i)).toBeInTheDocument();
    const retryBtn = screen.getByRole('button');
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('LineQuotaTable component', () => {
  it('mounts and renders without throwing G.getGroups error', async () => {
    const { LineQuotaTable } = await import('../components/hook/quota/line/LineQuotaTable');
    render(<LineQuotaTable showHeaderCard={true} />);
    expect(screen.getByTestId('line-quota-table-container')).toBeInTheDocument();
  });
});

