import { SetMetadata } from '@nestjs/common';

/** Metadata key the global login check reads to leave a route to a parent-or-child login check. */
export const IS_PARENT_OR_CHILD_ROUTE = 'thinklet:parent-or-child-route';

/**
 * Marks a controller or a route that a signed-in parent and a signed-in
 * child may both use, such as a book's cover (`.docs/design/interfaces.md`,
 * "通用约定"). The global login check does not ask for a parent there; the
 * route's own guard accepts a `parent` JWT in the parent's cookie or a
 * `child` JWT in the child's cookie, and nothing else.
 */
export const ParentOrChildRoute = (): ClassDecorator & MethodDecorator =>
  SetMetadata(IS_PARENT_OR_CHILD_ROUTE, true);
