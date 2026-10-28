import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { mongoConfig } from '@/config/app.config';

/**
 * MongoDB connection.
 *
 * Every option below was tuned against a production incident in the legacy
 * service — they are not defaults and must not be "cleaned up" without new
 * measurements:
 *
 * socketTimeoutMS 45s   Without it the driver waits indefinitely on a socket
 *                       that died mid-query; one such query hung for 986s and
 *                       customers went unanswered for 16 minutes. 45s (not 30s)
 *                       because several aggregate() queries legitimately run
 *                       long on production data.
 * maxIdleTimeMS 30s     A deploy kills the old container without closing its
 *                       sockets, so Mongo keeps counting them as live. Without
 *                       an idle cap the first request after a deploy could pick
 *                       a dead socket and wait the full 45s — measured at
 *                       exactly 45.103s, with every later request at 0.09s. 30s
 *                       covers the "deploy done -> first request" window.
 * minPoolSize 5         Keep connections warm so a restart does not make the
 *                       first caller build one.
 * maxPoolSize 40        Below the driver default of 100 on purpose: when the DB
 *                       is already struggling, a 100-slot pool opens sockets in
 *                       bursts and makes it worse. ~0.09s per query means 40
 *                       sustains roughly 440 queries/second.
 *                       Raise it only if waitQueueTimeout shows up in the logs.
 * retryReads/Writes     Lets the driver retry once instead of stalling.
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [mongoConfig.KEY],
      useFactory: (config: ConfigType<typeof mongoConfig>) => ({
        uri: config.uri,
        socketTimeoutMS: 45_000,
        serverSelectionTimeoutMS: 10_000,
        heartbeatFrequencyMS: 10_000,
        maxIdleTimeMS: 30_000,
        minPoolSize: 5,
        maxPoolSize: 40,
        retryReads: true,
        retryWrites: true,
      }),
    }),
  ],
})
export class MongoModule {}
