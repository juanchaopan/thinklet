import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';

export const S3_CLIENT = Symbol('S3_CLIENT');

/** What is known of a stored object without reading it. */
export interface StoredObjectHead {
  contentType: string | undefined;
  /** The user metadata written with the object, by lowercase name. */
  metadata: Record<string, string>;
}

/** A stored object read whole, with what its head says. */
export interface StoredObject extends StoredObjectHead {
  body: Uint8Array;
}

/** An object to write: its bytes, media type and user metadata. */
export interface NewObject {
  body: Uint8Array;
  contentType: string;
  metadata?: Record<string, string>;
}

/**
 * Whether the S3 call failed because the object does not exist. HeadObject
 * answers a missing key with a bare 404 (no body, so no NoSuchKey code),
 * which the SDK reports as NotFound; GetObject reports NoSuchKey. The HTTP
 * status covers both, whatever name an S3-compatible service gives it.
 */
function isMissingObject(error: unknown): boolean {
  const { $metadata } = error as { $metadata?: { httpStatusCode?: unknown } };
  return $metadata?.httpStatusCode === 404;
}

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

  /** The object's media type and metadata, or undefined when there is no object at the key. */
  async headObject(key: string): Promise<StoredObjectHead | undefined> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { contentType: head.ContentType, metadata: head.Metadata ?? {} };
    } catch (error) {
      if (isMissingObject(error)) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * The object's bytes, media type and metadata, or undefined when there is
   * no object at the key. The bytes and the metadata come from one read, so
   * they always belong to the same version of the object. The whole body is
   * read into memory, so this is for small objects such as covers.
   */
  async getObject(key: string): Promise<StoredObject | undefined> {
    try {
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = object.Body ? await object.Body.transformToByteArray() : new Uint8Array();
      return { contentType: object.ContentType, metadata: object.Metadata ?? {}, body };
    } catch (error) {
      if (isMissingObject(error)) {
        return undefined;
      }
      throw error;
    }
  }

  /** Writes the object at the key, replacing any object already there. */
  async putObject(key: string, object: NewObject): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: object.body,
        ContentType: object.contentType,
        Metadata: object.metadata,
      }),
    );
  }
}
