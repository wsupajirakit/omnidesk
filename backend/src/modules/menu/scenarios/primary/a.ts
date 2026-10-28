/**
 * [FEAT-20260828-MENUTAG-S1] scenario `primary-a` — PLACEHOLDER.
 * Content/look TBD by the owner (plan Q6: "หน้าตา content เดี๋ยวบอกอีกที").
 * Born DISABLED on purpose: no placeholder may reach a customer; flip `enabled` when the real content lands (owner: เปิดปิดรายตัวได้).
 * revert: delete this file + its import line in scenarios/index.ts.
 */
import type { MenuDefinition } from '../scenario.types';

const def: MenuDefinition = {
  key: 'primary-a',
  level: 'primary',
  variant: 'a',
  enabled: false,
  title: 'menu primary-a (placeholder)',
  items: [
    {
      id: 'item-1',
      label: 'Placeholder option 1',
      action: {
        type: 'result',
        result: { kind: 'text', text: 'PLACEHOLDER primary-a #1' },
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
