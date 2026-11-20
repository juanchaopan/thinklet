import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';

export const S3_CLIENT = Symbol('S3_CLIENT');

/** Access to the configured bucket through the S3 API. */
@Injectable()
export class StorageService {
  private readonly bucket: string;

  constructor(
    @Inject(S3_CLIENT) private readonly client: S3Client,
    config: ConfigService<Environment, true>,
  ) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
  }

  /** Resolves when the bucket exists and the credentials can reach it; rejects otherwise. */
  async checkBucket(signal?: AbortSignal): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
      abortSignal: signal,
    });
  }
}
