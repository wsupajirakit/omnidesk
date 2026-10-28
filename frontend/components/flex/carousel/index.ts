// [FEAT-20260831-FLEXCAROUSEL] Barrel for the card-carousel view of the flex list.
// Its own folder for the same reason `preview/` has one: a different role from the
// editor modals at `components/flex/` root. Re-exported from ../index.ts so the
// page's existing `from '../../components/flex'` import covers it with no new line.
export * from './FlexCardCarousel';
export * from './useFlexViewMode';
export * from './useLazyReveal';
