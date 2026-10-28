/**
 * [FEAT-20261014-TICKETCATS] The site's ticket categories for a page, or null.
 * null until answered and whenever the provider declares none — the caller then runs its
 * pre-existing code path unchanged (shop-api).
 */
import { useEffect, useState } from 'react';

import { fetchProviderTicketCategories } from '../../services/chat/providerTicketCategories';

export function useProviderTicketCategories(): string[] | null {
  const [cats, setCats] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchProviderTicketCategories().then((v) => { if (alive) setCats(v); });
    return () => { alive = false; };
  }, []);
  return cats;
}
