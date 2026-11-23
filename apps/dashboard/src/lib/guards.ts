/** Guards for the development boundary and for untrusted parsed input. */
/** Raised when a development-only control is reached outside a development build. */
export class DevelopmentOnlyError extends Error {
  readonly feature: string;
  constructor(feature: string) {
    super(`The development control "${feature}" is unavailable in a production build; ` + "scenario, clock, failure-plan and reset controls exist only in the development runtime.");
    this.name = "DevelopmentOnlyError";
    this.feature = feature;
    Object.setPrototypeOf(this, DevelopmentOnlyError.prototype); // Keep `instanceof` working when the class is downlevelled past ES2015 class semantics, where extending a built-in loses the prototype link.
  }
}
const ADMITTED_ENVIRONMENTS: readonly string[] = ["development", "test", "production"];
function readEnvironment(): string {
  const environment: string | undefined = process.env.NODE_ENV; // Held as a plain string: the ambient type names only the three standard values, but the value arrives from the environment and can hold anything an operator typed.
  if (environment === undefined || environment === "") return "development";
  if (!ADMITTED_ENVIRONMENTS.includes(environment)) throw new Error(`"${environment}" is not an environment this application recognises. NODE_ENV admits ` + `only ${ADMITTED_ENVIRONMENTS.join(", ")}; a mistyped value must not leave the ` + "development runtime and its seeded world enabled.");
  return environment;
}
/** Reports whether the application is running outside a production build; the development-session gate for the `/api/dev` namespace. */
export function isDevelopment(): boolean {
  // `typeof process` keeps this safe where `process` is absent, so a browser bundle without it never takes the development branch. Next inlines `process.env.NODE_ENV` at build time, so the check also holds in a Client Component without shipping the whole environment to the browser.
  return typeof process !== "undefined" && readEnvironment() !== "production";
}
/** Refuses a development control in production; throws `DevelopmentOnlyError` naming the feature when the control is not available. */
export function assertDevelopmentOnly(feature: string): void {
  if (!isDevelopment()) throw new DevelopmentOnlyError(feature);
}
/** Narrows an unknown parsed value to a plain object, excluding arrays and null. */
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Narrows an unknown value to a string that carries at least one character. */
export const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
