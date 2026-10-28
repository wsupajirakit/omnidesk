/* [FEAT-20260814-CONTACTPAGE] barrel — Contact page's own pieces
 * Same convention as components/member/index.ts: pages import from the folder,
 * never from deep file paths. revert: delete the components/contact/ folder. */
export { ContactPaginationBar, PER_PAGE_OPTIONS } from './ContactPaginationBar';
export { RefreshProfileButton } from './RefreshProfileButton';
export { ContactHeaderInfo } from './ContactHeaderInfo';
