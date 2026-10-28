import React from 'react';

/**
 * Shared skeleton primitives for progressive (per-card) loading.
 *
 * Rationale: pages used to gate their entire render behind a single
 * `if (loadingA || loadingB || loadingC)` spinner, so the whole screen stayed
 * blank until the slowest request finished. These let each card resolve on its
 * own — the page frame paints immediately and numbers fill in as they arrive.
 */

/** Generic shimmering block. Compose it for bespoke layouts. */
export const SkeletonBlock: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded-md bg-slate-200/70 dark:bg-dark-700 ${className}`} />
);

/**
 * Placeholder matching the metric-card layout (label, big number, icon chip).
 * Keeps the same box dimensions as the real card so nothing shifts when the
 * value lands.
 */
export const SkeletonStatCard: React.FC<{ accent?: string }> = ({ accent = 'bg-slate-300' }) => (
  <div className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-dark-700 dark:bg-dark-800">
    <div className={`absolute inset-y-0 left-0 w-1 ${accent} opacity-40`} />
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <SkeletonBlock className="mb-3 h-3 w-28" />
        <SkeletonBlock className="h-8 w-24" />
      </div>
      <SkeletonBlock className="h-11 w-11 shrink-0 rounded-xl" />
    </div>
  </div>
);

/** A row of metric-card skeletons (default 4, matching the metric groups). */
export const SkeletonStatRow: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonStatCard key={i} />
    ))}
  </div>
);

/** Placeholder for chart/panel cards (donut, bar chart, trend graph). */
export const SkeletonChartCard: React.FC<{ height?: string; title?: boolean }> = ({
  height = 'h-64',
  title = true,
}) => (
  <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-dark-700 dark:bg-dark-800">
    {title && <SkeletonBlock className="mb-4 h-4 w-48" />}
    <SkeletonBlock className={`w-full ${height}`} />
  </div>
);

export default SkeletonBlock;
