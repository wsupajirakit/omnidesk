// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      'prettier/prettier': ['error', { endOfLine: 'auto' }],

      /* `any` is how a typed codebase quietly becomes an untyped one, and the
       * scaffold ships with this rule off. Explicit `any` is an error; the
       * inference-driven variants warn so they surface in review without
       * blocking unrelated work. */
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',

      /* A forgotten await on a database write looks fine and loses data. */
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      /* Type-only imports must be marked: with emitDecoratorMetadata the emitted
       * require() would otherwise keep a runtime dependency on a module that
       * exists only for its types. */
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      /* Size ceiling. Not a style preference: the legacy backend's 4,900-line
       * controller is exactly what this project exists to avoid, and by the time
       * a file is that large nobody volunteers to split it. */
      'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],

      /* Logging goes through the injected pino logger, so it is structured,
       * redacted and correlated with a request id. */
      'no-console': 'error',

      /* Layering: config <- infra <- modules. A feature module reaching into
       * another module's internals turns two modules into one; cross-module use
       * goes through the barrel ('@/modules/<name>'). */
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*/*'],
              message:
                'Import a module through its barrel (@/modules/<name>), not its internal files.',
            },
          ],
        },
      ],
    },
  },
  {
    /* Infrastructure sits below feature modules and must not depend upward. */
    files: ['src/infra/**/*.ts', 'src/config/**/*.ts', 'src/common/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*'],
              message:
                'infra/config/common must not depend on feature modules — dependencies point one way.',
            },
          ],
        },
      ],
    },
  },
  {
    /* Tests assert on untyped JSON and stub collaborators; the unsafe-* rules
     * would fire on nearly every assertion without catching a real defect. */
    files: ['z-test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'max-lines': 'off',
    },
  },
  {
    /* LIFTED code — the accepted-debt list in check-list.md.
     *
     * These files are step one of a two-step port: the legacy controller is
     * expressed in TypeScript first so it runs and can be diffed against the
     * live legacy backend, then split once its endpoints are golden-green.
     * Splitting at the same time as changing framework would make any
     * behavioural difference unattributable.
     *
     * The waiver is BY FILENAME on purpose. A global `max-lines: off` would
     * hide the debt; having to add each path by hand keeps the list short and
     * makes removing an entry the visible end of the rewrite. Every other rule
     * — including no-explicit-any — still applies to these files.
     */
    files: [
      'src/modules/hooks/hooks.service.ts',
      'src/modules/hooks/hooks.controller.ts',
      // Ported from customToolController.js / dynamicTagController.js. Both are
      // one legacy controller each, kept whole so the golden diff attributes any
      // difference to the port rather than to a restructuring done at the same
      // time. Split once their endpoints are golden-green (P7a).
      'src/modules/hooks/custom-tools.service.ts',
      'src/modules/hooks/dynamic-tags.service.ts',
      'src/modules/chat/chat.service.ts',
      'src/modules/chat/chat.controller.ts',
      'src/modules/tickets/tickets.service.ts',
      'src/modules/tickets/tickets.controller.ts',
      'src/modules/tickets/insight-reports.service.ts',
      'src/modules/handoff/handoff-chain.service.ts',
      'src/modules/handoff/handoff-callback.service.ts',
      // Translation dictionary: both are DATA tables lifted from legacy config
      // modules, not logic. Splitting them would only move rows between files
      // while breaking the 1:1 correspondence with the legacy source that makes
      // them diffable — the seed in particular is generated, never hand-edited.
      'src/modules/system/dict-spec/flex-var-spec.ts',
      'src/modules/system/dict-spec/translation-dict-seed.ts',
      /* flexMessageController.js (691 lines) lifted whole. It is one CRUD
       * surface whose five handlers share the scope filter, the name-uniqueness
       * check, the tag counter and the grant-to-hooks helper, so splitting it
       * before its golden cases exist would move those helpers around at the
       * same time as the framework changed. Unblocked once all six
       * /api/flex-messages endpoints are golden-green. */
      'src/modules/content/flex-messages.service.ts',
      'src/modules/external/external-api.service.ts',
      'src/modules/external/custom-tool.service.ts',
      /* The five outbound POST handlers (hookController.js push /
       * test-external-api / execute-external-endpoint / compare-external-api,
       * plus customToolController.js testCustomTool) lifted whole. They share
       * the hook lookup, the group guard and the custom-tool-vs-external-api
       * branch that legacy applies identically in three of them, so splitting
       * them before their golden cases exist would move those helpers at the
       * same time as the framework changed. Unblocked once the success paths
       * are golden-green — which R10 currently forbids exercising. */
      'src/modules/external/hook-outbound.service.ts',
      /* customer-link: legacy's config.js + controller + adapter fused into one
       * service (the adapter was never separately callable — the controller is
       * its only caller). Kept whole so the golden diff attributes a difference
       * to the port rather than to a restructuring done at the same time.
       * Unblocked once all seven /customer-link endpoints are golden-green,
       * including the upstream success paths that R10 currently forbids
       * exercising. */
      'src/modules/customer-link/customer-link.service.ts',
      /* webhookController.js `_processWebhook` (legacy:2320-4970) lifted whole.
       * It is ONE function in legacy — 2,650 lines of straight-line control flow
       * in which the ORDER of the gates is the behaviour, and several branches
       * read state written hundreds of lines earlier (slipVerifyResult,
       * customerMsg, autoUnassistTriggeredMinutes, forceReAssistAfterReply).
       * The decisions are already extracted into webhook-routing.ts and the
       * pure utils beside it; what remains here is the drive order, and cutting
       * that into pieces before the side-effect diff is green would move the
       * gates at the same time as the framework changed — the one thing that
       * makes a difference unattributable. Unblocked once the ingest side
       * effects are golden-green. */
      'src/modules/webhook/webhook.service.ts',
    ],
    rules: {
      'max-lines': 'off',
    },
  },
);
