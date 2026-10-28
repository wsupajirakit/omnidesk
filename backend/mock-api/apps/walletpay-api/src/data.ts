/**
 * Pay-in seed data. `scenario` decides how an upload against that pay-in is answered, so every
 * outcome the backend distinguishes can be produced on demand (see README → walletpay-api).
 */
import { fileURLToPath } from 'node:url';

import { JsonStore } from '@zcrm/core';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

export const Scenario = Type.Union([
  Type.Literal('confirmed'),
  Type.Literal('pending'),
  Type.Literal('no_match'),
  Type.Literal('invalid_destination'),
]);
export const Payin = Type.Object({
  refId: Type.String({ format: 'uuid' }),
  amount: Type.Number({ minimum: 0 }),
  member_user_id: Type.String(),
  status: Type.Union([Type.Literal('waiting-deposit'), Type.Literal('confirmed'), Type.Literal('pending')]),
  scenario: Scenario,
  bankExpectId: Type.Integer(),
  transactionId: Type.Integer(),
  extRefId: Type.String(),
  created_at: Type.String(),
});
export const PayinSeed = Type.Object({
  counters: Type.Object({ imageId: Type.Integer(), evidenceId: Type.Integer() }),
  payins: Type.Array(Payin),
  uploads: Type.Array(Type.Object({ refId: Type.String(), imageId: Type.String(), evidenceId: Type.String(), result: Type.String(), at: Type.String() })),
});
export type PayinSeed = Static<typeof PayinSeed>;
export type Payin = Static<typeof Payin>;

export const DEFAULT_DATA_FILE = fileURLToPath(new URL('../data/payins.json', import.meta.url));

export function loadPayins(file = DEFAULT_DATA_FILE): JsonStore<PayinSeed> {
  return JsonStore.fromFile(file, (v): v is PayinSeed => Value.Check(PayinSeed, v));
}
