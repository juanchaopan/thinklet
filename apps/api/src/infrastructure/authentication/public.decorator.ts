import { SetMetadata } from '@nestjs/common';

/** Metadata key the login check reads to let a route through without a login. */
export const IS_PUBLIC = 'thinklet:public';

/**
 * Marks a controller or a route as open without a login. Only the health
 * check, the login routes and Authing's webhook, which proves itself with
 * its own secret, are (`.docs/design/interfaces.md`, "通用约定"); a child
 * route needs a signed-in child (see ChildRoute), and every other route a
 * signed-in parent.
 */
export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(IS_PUBLIC, true);
