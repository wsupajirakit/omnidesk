/**
 * [FEAT-20260828-MENUTAG-S1] scenario `second` — PLACEHOLDER.
 * Content/look TBD by the owner (plan Q6: "หน้าตา content เดี๋ยวบอกอีกที").
 * Enabled: the default menu of its level.
 * revert: delete this file + its import line in scenarios/index.ts.
 */
import type { MenuDefinition } from '../scenario.types';

const def: MenuDefinition = {
  key: 'second',
  level: 'second',
  variant: null,
  enabled: true,
  title: 'menu second (placeholder)',
  items: [
    {
      id: 'item-1',
      label: 'Placeholder option 1',
      action: {
        type: 'result',
        result: { kind: 'text', text: 'PLACEHOLDER second #1' },
      },
    },
    {
      id: 'open-sub',
      label: 'Placeholder sub-menu',
      action: { type: 'open', target: 'primary' },
    },
  ],
};

export default def;
