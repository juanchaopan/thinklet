import { SetMetadata } from '@nestjs/common';

/** Metadata key the Origin check reads to let a route's changes through from anywhere. */
export const SKIPS_ORIGIN_CHECK = 'thinklet:skips-origin-check';

/**
 * Marks a controller or a route whose changes do not come from the site's
 * pages, so the Origin check does not apply. Only Authing's webhook is
 * (`.docs/design/interfaces.md`, "通用约定"): Authing's servers send it,
 * and its own secret proves where it comes from.
 */
export const SkipOriginCheck = (): ClassDecorator & MethodDecorator =>
  SetMetadata(SKIPS_ORIGIN_CHECK, true);
