import { describeError } from './describe-error.js';

describe('describeError', () => {
  it('keeps the name and message of an error', () => {
    expect(describeError(new TypeError('bad input'))).toEqual({
      name: 'TypeError',
      message: 'bad input',
    });
  });

  it('replaces URLs in the message', () => {
    const error = new Error(
      'cannot reach postgresql://user:secret@db.example.com:5432/app or https://s3.example.com/bucket',
    );

    const { message } = describeError(error);

    expect(message).toBe('cannot reach [url] or [url]');
    expect(message).not.toContain('secret');
  });

  it('keeps a string error code', () => {
    const error = Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' });

    expect(describeError(error)).toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('ignores a code that is not a string', () => {
    const error = Object.assign(new Error('failed'), { code: 42 });

    expect(describeError(error)).not.toHaveProperty('code');
  });

  it('keeps the HTTP status of an AWS SDK error', () => {
    const error = Object.assign(new Error('UnknownError'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });

    expect(describeError(error)).toEqual({
      name: 'NotFound',
      message: 'UnknownError',
      status: 404,
    });
  });

  it('leaves out the stack and the cause', () => {
    const error = new Error('outer', { cause: new Error('postgresql://user:secret@host/db') });

    expect(Object.keys(describeError(error)).sort()).toEqual(['message', 'name']);
  });

  it('describes a thrown value that is not an error without repeating it', () => {
    const description = describeError('postgresql://user:secret@host/db');

    expect(description.name).toBe('UnknownError');
    expect(JSON.stringify(description)).not.toContain('secret');
  });
});
