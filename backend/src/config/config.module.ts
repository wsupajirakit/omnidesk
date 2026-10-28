import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { configNamespaces } from './app.config';
import { validateEnv } from './env.schema';

/**
 * Global configuration. Imported once by AppModule; every other module gets the
 * typed slices through DI without importing this again.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // `.env.local` wins over `.env` so a developer override never has to touch
      // the committed example file.
      envFilePath: ['.env.local', '.env'],
      load: configNamespaces,
      validate: validateEnv,
    }),
  ],
})
export class ConfigModule {}
