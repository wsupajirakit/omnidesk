/** [FEAT-20261014-TICKETCATS] The category badge for a site whose provider declares its set. */
import React from 'react';

import { useI18n } from '../../i18n';

import {
  TICKET_CATEGORY_CATALOG,
  knownCategories,
  ticketCategoryOf,
} from './ticketCategoryCatalog';

export const TicketCategoryBadge: React.FC<{
  category: string | null | undefined;
  categories: readonly string[];
}> = ({ category, categories }) => {
  const { t } = useI18n();
  const key = ticketCategoryOf(category, knownCategories(categories));
  const entry = TICKET_CATEGORY_CATALOG[key];
  /* [FEAT-20261022-I18NTICKETEN] label by locale (en = the catalog's labelEN); Thai stays the fallback */
  return <span className={entry.badgeClass}>{t(`ticketcat.${key}`, entry.labelTH)}</span>;
};
