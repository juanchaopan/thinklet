import { SetMetadata } from '@nestjs/common';

/** Metadata key the login check reads to let a route through without a login. */
export const IS_PUBLIC = 'thinklet:public';

/**
 * Marks a controller or a route as open without a login. Only the health
 * check and the login routes are (`.docs/design/interfaces.md`, "通用约定");
 * every other route needs a signed-in parent.
 */
export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(IS_PUBLIC, true);
