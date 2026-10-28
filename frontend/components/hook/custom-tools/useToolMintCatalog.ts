/**
 * [FEAT-20261016-TOOLMINT] The site's mint catalog for the Custom Tools page — null until the BE
 * answers, and null for good on shop-api (no mint) or an older back end (404). Every piece on the
 * page (the mint bar, each "ผูก tag" button) reads this one cached answer — asked once per load.
 */
import { useEffect, useState } from 'react';

import { fetchToolMintCatalog, type ToolMintCatalog } from '../../../services/hook/toolMint';

export function useToolMintCatalog(): ToolMintCatalog | null {
  const [catalog, setCatalog] = useState<ToolMintCatalog | null>(null);
  useEffect(() => {
    let alive = true;
    fetchToolMintCatalog().then((c) => {
      if (alive) setCatalog(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return catalog;
}
