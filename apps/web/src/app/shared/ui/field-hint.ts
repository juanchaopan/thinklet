import { fieldErrorCodeSchema, type FieldErrorCode } from '@thinklet/contracts';

/** One reason a schema gave for turning a value down; the field schemas use field error codes. */
interface FieldIssue {
  readonly message: string;
}

/** A field's schema from `@thinklet/contracts`, whose issues carry field error codes as messages. */
export interface FieldSchema {
  safeParse(
    value: unknown,
  ):
    | { readonly success: true }
    | { readonly success: false; readonly error: { readonly issues: readonly FieldIssue[] } };
}

/** What to say under a field for each reason it can be turned down. */
export type FieldHints = Readonly<Record<FieldErrorCode, string>>;

/**
 * The hint for a value the field's schema turns down, picked by the reason,
 * or null when the value may be sent. It is the same check the api runs, so
 * the screen says what is wrong before anything is sent.
 */
export function fieldHint(schema: FieldSchema, hints: FieldHints, value: string): string | null {
  const result = schema.safeParse(value);
  if (result.success) {
    return null;
  }
  const code = fieldErrorCodeSchema.safeParse(result.error.issues[0]?.message);
  return hints[code.success ? code.data : 'invalid'];
}
