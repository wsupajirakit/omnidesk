import { Global, Module } from '@nestjs/common';

import { CryptoService } from './crypto.service';
import { SecretSelfCheckService } from './secret-self-check.service';

/**
 * Global infrastructure module for encryption/decryption utilities and startup secret self-checks.
 */
@Global()
@Module({
  providers: [CryptoService, SecretSelfCheckService],
  exports: [CryptoService, SecretSelfCheckService],
})
export class CryptoModule {}
