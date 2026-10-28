/**
 * ==== [FEAT-20260811-FELINT] the file-size RATCHET — warn on growth, waive the past ====
 *
 * WHY THIS EXISTS: pages/ averages ~940 lines with no guardrail, and files keep
 * growing between refactors (HookFormModal grew +96 lines in one day of normal
 * work). The BE has max-lines with a by-filename waiver; this is the FE mirror.
 * See omnidesk-api/todo/fe_bloat_reduction.md §E — this is the plan's ratchet item.
 *
 * THE RULE OF THE WAIVER LIST: files below were already over 400 lines when the
 * ratchet landed (2026-08-11). The list may only SHRINK — split a file under
 * 400, delete its line here. NEVER add a new file to it; a new warning means a
 * new file crossed 400 and should be split instead. ห้ามเพิ่มชื่อไฟล์ใหม่ในลิสต์.
 *
 * Deliberately ONE rule, warn-only: this is a ratchet, not a style gate — it
 * must never block a build or force a refactor mid-task. เตือนอย่างเดียว ไม่บล็อก.
 * revert: delete this file + the two devDependencies + the "lint" script.
 */
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const OVER_400_WHEN_RATCHET_LANDED = [
      'App.tsx',
      'components/admin/UserFormModal.tsx',
      'components/bulk/BulkCloneUsersModal.tsx',
      'components/bulk/BulkMethodModal.tsx',
      'components/campaign/AutoReplyFormModal.tsx',
      'components/campaign/BroadcastFormModal.tsx',
      'components/chat/ChatRoomView.tsx',
      'components/chat/FlexSlipCard.tsx',
      'components/common/MegaMenu.tsx',
      'components/common/Sidebar.tsx',
      'components/dynamic-tag/DynamicTagFormModal.tsx',
      'components/flex/FlexMessageFormModal.tsx',
      'components/hook/ConnectionTestModal.tsx',
      'components/hook/HookCloneModal.tsx',
      'components/hook/HookFormModal.tsx',
      'components/hook/HookPaymentFlexBlock.tsx',
      'components/member/CustomerCards.tsx',
      'components/profile-panel/ProfilePanel.tsx',
      'components/object/ObjectImageFormModal.tsx',
      'pages/admin/AuditLogs.tsx',
      'pages/admin/SystemConfig.tsx',
      'pages/admin/Users.tsx',
      'pages/chat/Contact.tsx',
      'pages/chat/TicketChat.tsx',
      'pages/chat/TicketSupport.tsx',
      'pages/content/FlexMessageList.tsx',
      'pages/content/SlipVerification.tsx',
      'pages/handoff/HandoffHistory.tsx',
      'pages/handoff/HandoffTargets.tsx',
      'pages/hook/CustomTools.tsx',
      'pages/hook/WebhookList.tsx',
      'pages/insight/Dashboard.tsx',
      'pages/insight/InsightReport.tsx',
      'pages/messaging/AutoReplies.tsx',
      'pages/messaging/Broadcasts.tsx',
      'pages/messaging/DynamicTagList.tsx',
      'pages/messaging/TranslationDictList.tsx',
      'services/chat/chatService.ts',
      'services/chat/handoffService.ts',
      'services/chat/ticketService.ts',
      'services/hook/customToolService.ts',
      'services/hook/webhookService.ts',
      'test/HookFormModal.value.test.tsx',];

export default [
  /* [FIX-20260830-VITESTWTSCAN] `.worktrees/<lane>/` is a git worktree —
     a full second copy of this repo — and `dist.bak-*` is a kept build output.
     Without these two the max-lines ratchet counts the same file twice and the
     warning total stops meaning "how many files are over 400".
     revert: drop the last two patterns. */
  {
    ignores: [
      'dist/**',
      'dist.*/**',
      'node_modules/**',
      'public/**',
      '*.min.js',
      '.worktrees/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    // Plugins are REGISTERED but no rule of theirs is enabled — they exist only
    // so the codebase's pre-existing `eslint-disable` comments (react-hooks/*,
    // @typescript-eslint/*) resolve instead of erroring as unknown rules.
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
    },
    // Pre-existing disable comments may be broader than the rules enabled here.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'max-lines': [
        'warn',
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: OVER_400_WHEN_RATCHET_LANDED,
    rules: { 'max-lines': 'off' },
  },
];
