/**
 * Guards for the development boundary and for untrusted parsed input.
 *
 * This is the only module in `src/lib` that reads `process.env`, and it reads
 * only `NODE_ENV`. It imports nothing and carries no module directive, so the
 * shell (which renders the Development data label) and Route Handlers (which
 * gate the development controls) can both use it.
 *
 * The narrowing helpers here only narrow. Schema validation belongs to the data
 * service, so no second validation path may start in this module.
 */

/** Raised when a development-only control is reached outside a development build. */
export class DevelopmentOnlyError extends Error {
  /** The development control that was refused, named as the caller names it. */
  readonly feature: string;

  constructor(feature: string) {
    super(
      `The development control "${feature}" is unavailable in a production build; ` +
        "scenario, clock, failure-plan and reset controls exist only in the development runtime.",
    );
    this.name = "DevelopmentOnlyError";
    this.feature = feature;
    // Keep `instanceof` working when the class is downlevelled past ES2015 class
    // semantics, where extending a built-in loses the prototype link.
    Object.setPrototypeOf(this, DevelopmentOnlyError.prototype);
  }
}

/**
 * Reports whether the application is running outside a production build; the
 * development-session gate for the `/api/dev` namespace.
 */
export function isDevelopment(): boolean {
  // `typeof process` keeps this safe where `process` is absent. Next inlines
  // `process.env.NODE_ENV` at build time, so the check also holds in a Client
  // Component without shipping the whole environment to the browser.
  return typeof process !== "undefined" && process.env.NODE_ENV !== "production";
}

/**
 * Refuses a development control in production; throws `DevelopmentOnlyError`
 * naming the feature when the control is not available.
 */
export function assertDevelopmentOnly(feature: string): void {
  if (!isDevelopment()) {
    throw new DevelopmentOnlyError(feature);
  }
}

/**
 * Refuses to answer with seeded or fixture data in production; throws when the
 * caller reports fixture data outside a development build.
 */
export function assertNoFixtureFallback(context: string, isFixture: boolean): void {
  // The caller supplies the evidence that the answer is fixture-derived, so this
  // stays a real assertion about the answer rather than a second environment check.
  if (isFixture && !isDevelopment()) {
    throw new Error(
      `"${context}" would answer with fixture or seeded data in a production build. ` +
        "Production never falls back to fixtures: the honest answers are a refusal or `unavailable`.",
    );
  }
}

/** Narrows an unknown parsed value to a plain object, excluding arrays and null. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrows an unknown value to a string that carries at least one character. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
