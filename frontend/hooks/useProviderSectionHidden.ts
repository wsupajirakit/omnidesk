/**
 * [FEAT-20261018-SCREENSECTIONS] Which dashboard sections does the site's customer provider hide?
 *
 * Empty / `false` until the back end answers, and whenever it answers nothing / fails — so a
 * screen never hides anything on shop-api, and never waits for this to draw. Only an id listed in
 * `hidden` counts. To hide a new section: add it to the BE table, then ask here.
 */
import { useEffect, useState } from 'react';

import { fetchProviderHiddenSections, type ScreenSection } from '../services/chat/providerFeatures';

/** The whole list — for a screen that filters several sections at once (close-case dialog). */
export function useProviderHiddenSections(): string[] {
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchProviderHiddenSections().then((list) => {
      if (alive) setHidden(Array.isArray(list) ? list : []);
    });
    return () => { alive = false; };
  }, []);
  return hidden;
}

/** One section — for a component that draws or skips itself. */
export function useProviderSectionHidden(section: ScreenSection): boolean {
  return useProviderHiddenSections().includes(section);
}
