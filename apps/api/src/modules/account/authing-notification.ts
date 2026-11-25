import { z } from 'zod';

/** The event Authing sends once users are deleted. */
const USER_DELETED_EVENT = 'user:deleted';

/**
 * A notification of Authing's webhook (`.docs/design/interfaces.md`,
 * "Authing 的通知"): the event's name and its data, whose form depends on
 * the event. Other fields Authing adds are ignored.
 */
export const authingNotificationSchema = z.object({
  eventName: z.string(),
  data: z.unknown(),
});

export type AuthingNotification = z.infer<typeof authingNotificationSchema>;

/**
 * A deleted user as `user:deleted` lists them. Authing's user objects name
 * the user's id `userId` in the current API and `id` in the older one; the
 * id is the `sub` the parent signed in with.
 */
const deletedUserSchema = z
  .object({ userId: z.string().min(1).optional(), id: z.string().min(1).optional() })
  .transform((user, context) => {
    const userId = user.userId ?? user.id;
    if (userId === undefined) {
      context.addIssue({ code: 'custom', message: 'A deleted user needs its id' });
      return z.NEVER;
    }
    return userId;
  });

/** The data of `user:deleted`: the users deleted. */
const userDeletedDataSchema = z.object({ users: z.array(deletedUserSchema) });

/**
 * The ids of the users a notification reports deleted: none for any event
 * other than `user:deleted`, and undefined for a `user:deleted` whose data
 * does not list its users.
 */
export function deletedUserIds(notification: AuthingNotification): string[] | undefined {
  if (notification.eventName !== USER_DELETED_EVENT) {
    return [];
  }
  const data = userDeletedDataSchema.safeParse(notification.data);
  return data.success ? data.data.users : undefined;
}
