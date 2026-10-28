/**
 * [FEAT-20260828-MENUTAG-S1] scenario `primary` — PLACEHOLDER.
 * Content/look TBD by the owner (plan Q6: "หน้าตา content เดี๋ยวบอกอีกที").
 * Enabled: the default menu of its level.
 * revert: delete this file + its import line in scenarios/index.ts.
 */
import type { MenuDefinition } from '../scenario.types';

const def: MenuDefinition = {
  key: 'primary',
  level: 'primary',
  variant: null,
  enabled: true,
  title: 'menu primary (placeholder)',
  items: [
    {
      id: 'item-1',
      label: 'Placeholder option 1',
      action: {
        type: 'result',
        result: { kind: 'text', text: 'PLACEHOLDER primary #1' },
      },
    },
    {
      id: 'open-sub',
      label: 'Placeholder sub-menu',
      action: { type: 'open', target: 'second-a' },
    },
  ],
};

export default def;
