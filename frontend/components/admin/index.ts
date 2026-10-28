// [REFACTOR-20260808-CMPGROUP] Barrel for the `admin` component group (admin-panel modals: user +
// group + system-config forms + change-password). App imports `../components/admin`. Root hubs
// ConfirmModal/AlertModal via `../`; shared infra authStorage via `../../services/authStorage`. No side effects.
// revert: `git mv components/admin/*.tsx components/`, delete folder, repoint Users/Groups/SystemConfig/App
//   back to `../components/<File>` (App uses `./components/ChangePasswordModal`), restore `../` depth.
export * from './UserFormModal';
export * from './GroupFormModal';
// [FEAT-20260817-GROUPBULKSTATUS / FIX-20260817-GROUPPAGER] Groups page sections,
// split out to keep pages/admin/Groups.tsx under the 400-line ceiling.
export * from './groups/GroupBulkStatusBar';
export * from './groups/GroupTablePager';
export * from './groups/GroupTable';
export * from './ConfigFormModal';
export * from './ChangePasswordModal';
// [FEAT-20260816-GROUPSCOPECLONE] copy a group's dynamic tags + flex cards onto other groups
export * from './group-scope';
