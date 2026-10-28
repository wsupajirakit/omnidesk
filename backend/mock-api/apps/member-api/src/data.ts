/**
 * Member + site seed data (JSON, no database). Writes (link / edit / unlink / top-up) stay in
 * memory. `topup_scenario` picks the answer validate-slip gives for that member, so each
 * outcome the backend branches on can be produced on demand.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JsonStore } from '@zcrm/core';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

export const TopupScenario = Type.Union([
  Type.Literal('success'),
  Type.Literal('reject'),
  Type.Literal('member-not-match'),
  Type.Literal('fail'),
]);
export const Account = Type.Object({
  member_id: Type.String(),
  web_code: Type.String(),
  line_user_id: Type.Union([Type.String(), Type.Null()]),
  phone_number: Type.String(),
  first_name: Type.String(),
  account_number: Type.String(),
  topup_scenario: TopupScenario,
  profile: Type.Record(Type.String(), Type.Unknown()),
});
export const MembersSeed = Type.Object({ web_codes: Type.Array(Type.String()), accounts: Type.Array(Account), used_trans_refs: Type.Array(Type.String()) });
export const SiteSeed = Type.Object({ web_codes: Type.Array(Type.String()), shop: Type.Record(Type.String(), Type.Unknown()) });
export type Account = Static<typeof Account>;
export type MembersSeed = Static<typeof MembersSeed>;
export type SiteSeed = Static<typeof SiteSeed>;

const DEFAULT_DIR = fileURLToPath(new URL('../data', import.meta.url));

export function loadMemberData(dir = DEFAULT_DIR) {
  return {
    members: JsonStore.fromFile(join(dir, 'members.json'), (v): v is MembersSeed => Value.Check(MembersSeed, v)),
    site: JsonStore.fromFile(join(dir, 'site.json'), (v): v is SiteSeed => Value.Check(SiteSeed, v)),
  };
}
export type MemberData = ReturnType<typeof loadMemberData>;
