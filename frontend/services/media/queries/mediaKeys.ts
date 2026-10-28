/** [FEAT-20261027-TANSTACK] Query keys of the `media` service group (flex messages, object albums). */
import { QUERY_ROOT } from '../../query';

export const mediaKeys = {
  all: [QUERY_ROOT.media] as const,
  flexList: (params: Record<string, unknown>) => [QUERY_ROOT.media, 'flexList', params] as const,
  objectCategories: (params: Record<string, unknown>) => [QUERY_ROOT.media, 'objectCategories', params] as const,
  objectImages: (params: Record<string, unknown>) => [QUERY_ROOT.media, 'objectImages', params] as const,
};
