import { SetMetadata } from '@nestjs/common';

/** Metadata key the global login check reads to leave a route to the child's login check. */
export const IS_CHILD_ROUTE = 'thinklet:child-route';

/**
 * Marks a controller or a route as one for a signed-in child
 * (`/api/child/*`, `.docs/design/interfaces.md`, "通用约定"). The global
 * login check does not ask for a parent there; the route's own guard runs
 * the child's login check instead, which accepts only a `child` JWT in the
 * child's cookie.
 */
export const ChildRoute = (): ClassDecorator & MethodDecorator => SetMetadata(IS_CHILD_ROUTE, true);
