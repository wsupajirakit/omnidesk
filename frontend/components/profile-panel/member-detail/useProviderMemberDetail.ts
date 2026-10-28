/**
 * [FEAT-20261015-MEMBERDETAIL] The site's rule for the hand-typed customer card, or null.
 * null until answered and whenever the provider declares none — the card then draws exactly
 * today's (shop-api) layout, so shop-api never waits on this.
 */
import { useEffect, useState } from 'react';

import {
  fetchProviderMemberDetail,
  type MemberDetailRule,
} from '../../../services/chat/providerMemberDetail';

export function useProviderMemberDetail(): MemberDetailRule | null {
  const [rule, setRule] = useState<MemberDetailRule | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchProviderMemberDetail().then((v) => { if (alive) setRule(v); });
    return () => { alive = false; };
  }, []);
  return rule;
}
