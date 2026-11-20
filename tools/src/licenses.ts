/**
 * Whether a package's license, as license-checker reports it, is satisfied
 * by the allowed licenses. The license is an SPDX expression such as `MIT`,
 * `(MIT OR CC0-1.0)` or `Apache-2.0 AND MIT`: OR needs one side allowed,
 * AND both. `X WITH Y` is allowed only when the whole `X WITH Y` is listed.
 * A trailing `*` marks a license license-checker guessed from the license
 * text, and a trailing `+` means "or later"; both are read as the license
 * named. Anything that does not parse is not allowed.
 */
export function isAllowed(license: string, allowed: readonly string[]): boolean {
  const tokens = license.replace(/\*$/, '').match(/\(|\)|[^\s()]+/g) ?? [];
  const parser = new ExpressionParser(tokens, new Set(allowed));
  try {
    const result = parser.parseOr();
    return parser.done() && result;
  } catch {
    return false;
  }
}

class ExpressionParser {
  readonly #tokens: readonly string[];
  readonly #allowed: ReadonlySet<string>;
  #position = 0;

  constructor(tokens: readonly string[], allowed: ReadonlySet<string>) {
    this.#tokens = tokens;
    this.#allowed = allowed;
  }

  done(): boolean {
    return this.#position === this.#tokens.length;
  }

  /** Both sides are always parsed, so the whole expression is read. */
  parseOr(): boolean {
    let result = this.#parseAnd();
    while (this.#takeOperator('OR')) {
      result = this.#parseAnd() || result;
    }
    return result;
  }

  #parseAnd(): boolean {
    let result = this.#parseAtom();
    while (this.#takeOperator('AND')) {
      result = this.#parseAtom() && result;
    }
    return result;
  }

  #parseAtom(): boolean {
    const token = this.#next();
    if (token === '(') {
      const result = this.parseOr();
      if (this.#next() !== ')') {
        throw new Error('Unbalanced parentheses');
      }
      return result;
    }
    if (token === ')' || /^(AND|OR|WITH)$/i.test(token)) {
      throw new Error(`Unexpected ${token}`);
    }
    const id = token.replace(/\+$/, '');
    if (this.#takeOperator('WITH')) {
      return this.#allowed.has(`${id} WITH ${this.#next()}`);
    }
    return this.#allowed.has(id);
  }

  #takeOperator(operator: string): boolean {
    if (this.#tokens[this.#position]?.toUpperCase() === operator) {
      this.#position += 1;
      return true;
    }
    return false;
  }

  #next(): string {
    if (this.done()) {
      throw new Error('Unexpected end');
    }
    const token = this.#tokens[this.#position] ?? '';
    this.#position += 1;
    return token;
  }
}

/** One package as license-checker's JSON output lists it. */
export interface LicensedPackage {
  licenses?: string | string[];
}

/** The packages (`name@version`) whose license is not allowed, with that license. */
export function disallowedPackages(
  packages: Record<string, LicensedPackage>,
  allowed: readonly string[],
): string[] {
  return Object.entries(packages).flatMap(([name, { licenses }]) => {
    const list = Array.isArray(licenses) ? licenses : [licenses ?? 'UNKNOWN'];
    const refused = list.filter((license) => !isAllowed(license, allowed));
    return refused.length === 0 ? [] : [`${name}: ${refused.join(', ')}`];
  });
}
