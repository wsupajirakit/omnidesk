import type { FastifyReply } from 'fastify';

import { ApiError, envelope } from '../service.js';

/** Run a domain call; an ApiError becomes its documented status + `{success:false,error}` body. */
export function send(reply: FastifyReply, fn: () => unknown) {
  try {
    return reply.send(fn());
  } catch (e) {
    if (e instanceof ApiError) return reply.status(e.status).send(envelope(e));
    throw e;
  }
}
