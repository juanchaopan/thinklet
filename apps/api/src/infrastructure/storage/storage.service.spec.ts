import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
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

/** An S3 failure with the given HTTP status, as the SDK reports one. */
function s3Failure(name: string, httpStatusCode: number): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });
}

describe('StorageService', () => {
  it('sends HeadBucket for the configured bucket with the abort signal', async () => {
    const send = vi.fn().mockResolvedValue({});
    const signal = new AbortController().signal;

    await createService(send).checkBucket(signal);

    const [command, options] = send.mock.calls[0] as [HeadBucketCommand, unknown];
    expect(command).toBeInstanceOf(HeadBucketCommand);
    expect(command.input).toEqual({ Bucket: 'configured-bucket' });
    expect(options).toEqual({ abortSignal: signal });
  });

  it('rejects when the bucket cannot be reached', async () => {
    const send = vi.fn().mockRejectedValue(new Error('NotFound'));

    await expect(createService(send).checkBucket()).rejects.toThrow('NotFound');
  });

  it('reads the media type and metadata of an object with HeadObject', async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ ContentType: 'image/png', Metadata: { sha256: 'abc' } });

    const head = await createService(send).headObject('books/a/cover.png');

    const [command] = send.mock.calls[0] as [HeadObjectCommand];
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect(command.input).toEqual({ Bucket: 'configured-bucket', Key: 'books/a/cover.png' });
    expect(head).toEqual({ contentType: 'image/png', metadata: { sha256: 'abc' } });
  });

  it('gives an object without metadata an empty metadata record', async () => {
    const send = vi.fn().mockResolvedValue({ ContentType: 'image/png' });

    expect(await createService(send).headObject('key')).toEqual({
      contentType: 'image/png',
      metadata: {},
    });
  });

  it('answers undefined for the head of a missing object', async () => {
    const send = vi.fn().mockRejectedValue(s3Failure('NotFound', 404));

    expect(await createService(send).headObject('key')).toBeUndefined();
  });

  it('rejects a head that fails for another reason', async () => {
    const send = vi.fn().mockRejectedValue(s3Failure('AccessDenied', 403));

    await expect(createService(send).headObject('key')).rejects.toThrow('AccessDenied');
  });

  it('reads the whole body and media type of an object with GetObject', async () => {
    const body = new Uint8Array([1, 2, 3]);
    const send = vi.fn().mockResolvedValue({
      ContentType: 'image/webp',
      Body: { transformToByteArray: () => Promise.resolve(body) },
    });

    const object = await createService(send).getObject('books/a/cover.webp');

    const [command] = send.mock.calls[0] as [GetObjectCommand];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({ Bucket: 'configured-bucket', Key: 'books/a/cover.webp' });
    expect(object).toEqual({ contentType: 'image/webp', body });
  });

  it('reads an object without a body as empty', async () => {
    const send = vi.fn().mockResolvedValue({ ContentType: 'image/png' });

    expect(await createService(send).getObject('key')).toEqual({
      contentType: 'image/png',
      body: new Uint8Array(),
    });
  });

  it('answers undefined for a missing object', async () => {
    const send = vi.fn().mockRejectedValue(s3Failure('NoSuchKey', 404));

    expect(await createService(send).getObject('key')).toBeUndefined();
  });

  it('rejects a read that fails for another reason', async () => {
    const send = vi.fn().mockRejectedValue(s3Failure('InternalError', 500));

    await expect(createService(send).getObject('key')).rejects.toThrow('InternalError');
  });

  it('writes an object with its media type and metadata', async () => {
    const send = vi.fn().mockResolvedValue({});
    const body = new Uint8Array([4, 5]);

    await createService(send).putObject('books/a/cover.png', {
      body,
      contentType: 'image/png',
      metadata: { sha256: 'abc' },
    });

    const [command] = send.mock.calls[0] as [PutObjectCommand];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'configured-bucket',
      Key: 'books/a/cover.png',
      Body: body,
      ContentType: 'image/png',
      Metadata: { sha256: 'abc' },
    });
  });
});
