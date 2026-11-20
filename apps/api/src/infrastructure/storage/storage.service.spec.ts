import { HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { StorageService } from './storage.service.js';

function createService(send: ReturnType<typeof vi.fn>) {
  const client = { send } as unknown as S3Client;
  const config = {
    get: (name: string) => (name === 'S3_BUCKET' ? 'configured-bucket' : undefined),
  } as unknown as ConfigService<Environment, true>;
  return new StorageService(client, config);
}

describe('StorageService', () => {
  it('sends HeadBucket for the configured bucket with the abort signal', async () => {
    const send = vi.fn().mockResolvedValue({});
    const signal = new AbortController().signal;

    await createService(send).checkBucket(signal);

    const [command, options] = send.mock.calls[0];
    expect(command).toBeInstanceOf(HeadBucketCommand);
    expect(command.input).toEqual({ Bucket: 'configured-bucket' });
    expect(options).toEqual({ abortSignal: signal });
  });

  it('rejects when the bucket cannot be reached', async () => {
    const send = vi.fn().mockRejectedValue(new Error('NotFound'));

    await expect(createService(send).checkBucket()).rejects.toThrow('NotFound');
  });
});
