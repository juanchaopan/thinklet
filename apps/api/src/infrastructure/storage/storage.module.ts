import { S3Client } from '@aws-sdk/client-s3';
import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { S3_CLIENT, StorageService } from './storage.service.js';

/**
 * S3 client built only from the S3_* variables, so any S3-compatible service
 * works by configuration. S3_FORCE_PATH_STYLE selects path-style addressing
 * for services that do not resolve bucket subdomains, such as SeaweedFS.
 */
@Module({
  providers: [
    {
      provide: S3_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) =>
        new S3Client({
          endpoint: config.get('S3_ENDPOINT', { infer: true }),
          region: config.get('S3_REGION', { infer: true }),
          forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
          credentials: {
            accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
            secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
          },
        }),
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule implements OnApplicationShutdown {
  constructor(@Inject(S3_CLIENT) private readonly client: S3Client) {}

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
