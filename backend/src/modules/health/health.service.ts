import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ConnectionStates, type Connection } from 'mongoose';

import { RedisService } from '@/infra/redis/redis.service';

export interface DependencyStatus {
  status: 'up' | 'down';
  detail?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  dependencies: {
    mongo: DependencyStatus;
    redis: DependencyStatus;
  };
}

@Injectable()
export class HealthService {
  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    private readonly redis: RedisService,
  ) {}

  /**
   * Reports dependency health.
   *
   * Mongo down is fatal — nothing works without it, so readiness fails (503) and
   * the platform keeps traffic away. Redis down is reported but tolerated:
   * caching and rate limiting fail open, so the API still serves requests.
   */
  async check(): Promise<HealthReport> {
    const [mongo, redis] = await Promise.all([
      this.checkMongo(),
      this.checkRedis(),
    ]);
    const report: HealthReport = {
      status: mongo.status === 'up' ? 'ok' : 'degraded',
      dependencies: { mongo, redis },
    };

    if (mongo.status === 'down') {
      throw new ServiceUnavailableException(
        `mongo unavailable: ${mongo.detail ?? 'unknown'}`,
      );
    }

    return report;
  }

  private async checkMongo(): Promise<DependencyStatus> {
    try {
      // A ping on top of the state check: `connected` only means the driver
      // believes the socket is open, which stays true for a socket that died
      // silently — exactly the failure this probe exists to catch.
      const readyState: number = this.mongoConnection.readyState;
      if (readyState !== Number(ConnectionStates.connected)) {
        // Report the state by name ("disconnected") rather than its number.
        const stateName = ConnectionStates[readyState] ?? String(readyState);
        return { status: 'down', detail: `readyState=${stateName}` };
      }
      await this.mongoConnection.db?.admin().ping();
      return { status: 'up' };
    } catch (error) {
      return { status: 'down', detail: (error as Error).message };
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    try {
      // ioredis types ping() as returning the literal 'PONG', so an unexpected
      // reply is unrepresentable in the type. It is still worth checking: a
      // proxy in front of Redis can answer with something else entirely.
      const pong: string = await this.redis.getClient().ping();
      if (pong !== 'PONG') return { status: 'down', detail: `ping=${pong}` };
      return { status: 'up' };
    } catch (error) {
      return { status: 'down', detail: (error as Error).message };
    }
  }
}
