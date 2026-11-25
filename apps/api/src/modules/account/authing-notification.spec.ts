import { authingNotificationSchema, deletedUserIds } from './authing-notification.js';

const notification = (body: unknown) => authingNotificationSchema.parse(body);

describe('deletedUserIds', () => {
  it('lists the users of user:deleted by their id, in either of the names Authing gives it', () => {
    expect(
      deletedUserIds(
        notification({
          eventName: 'user:deleted',
          data: { users: [{ userId: 'user-1', email: 'a@example.com' }, { id: 'user-2' }] },
        }),
      ),
    ).toEqual(['user-1', 'user-2']);
  });

  it('prefers userId when a user has both', () => {
    expect(
      deletedUserIds(
        notification({ eventName: 'user:deleted', data: { users: [{ userId: 'a', id: 'b' }] } }),
      ),
    ).toEqual(['a']);
  });

  it('lists no one for any other event, whatever its data', () => {
    expect(
      deletedUserIds(notification({ eventName: 'login', data: { user: { id: 'u' } } })),
    ).toEqual([]);
    expect(deletedUserIds(notification({ eventName: 'user:updated', data: null }))).toEqual([]);
  });

  it.each([
    ['no data', undefined],
    ['no users', {}],
    ['users that are not a list', { users: 'user-1' }],
    ['a user without an id', { users: [{ email: 'a@example.com' }] }],
    ['a user with an empty id', { users: [{ userId: '' }] }],
  ])('cannot read a user:deleted with %s', (_case, data) => {
    expect(deletedUserIds(notification({ eventName: 'user:deleted', data }))).toBeUndefined();
  });

  it('needs the event name of a notification', () => {
    expect(authingNotificationSchema.safeParse({ data: {} }).success).toBe(false);
  });
});
