import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'omnidesk:isPublic';

/**
 * Opts a single route out of the globally applied authentication guard.
 *
 * The legacy backend worked the other way round: everything was open and a
 * hand-maintained skip-list decided what needed a token, so forgetting an entry
 * silently exposed an endpoint. Here the default is deny, and opening a route is
 * an explicit, greppable annotation that shows up in review.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
