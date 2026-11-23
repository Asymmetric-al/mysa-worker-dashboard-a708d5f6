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
const ENVIRONMENT_KEY: string = ["NODE", "ENV"].join("_"); // Composed at run time so the name is never a static property the bundler can substitute for.
/** The environment this bundle was compiled with: the only value a Client Component bundle can observe, because the member expression below is the one form the bundler replaces at build time. */
function compiledEnvironment(): string | undefined {
  return process.env.NODE_ENV;
}
function readEnvironment(): string {
  // The environment record is taken once and indexed with a computed key. A static `process.env.NODE_ENV` member expression is replaced at build time with the build mode, which would make the validation below unreachable and silently accept a mistyped operator value.
  const environment: Record<string, string | undefined> | undefined = typeof process === "undefined" ? undefined : process.env;
  const declared: string | undefined = environment === undefined ? undefined : environment[ENVIRONMENT_KEY]; // Held as a plain string: the ambient type names only the three standard values, but the value arrives from the environment and can hold anything an operator typed.
  const value: string | undefined = declared === undefined || declared === "" ? compiledEnvironment() : declared; // An absent or empty declaration answers with the compiled build mode rather than straight with the default, so a bundle that carries no environment keeps the answer it was built with.
  if (value === undefined || value === "") return "development";
  if (!ADMITTED_ENVIRONMENTS.includes(value)) throw new Error(`"${value}" is not an environment this application recognises. NODE_ENV admits ` + `only ${ADMITTED_ENVIRONMENTS.join(", ")}; a mistyped value must not leave the ` + "development runtime and its seeded world enabled.");
  return value;
}
/** Reports whether the application is running outside a production build; the development-session gate for the `/api/dev` namespace. */
export function isDevelopment(): boolean {
  // `readEnvironment()` answers where `process` is absent, so a Client Component bundle keeps the environment it was compiled with without shipping the whole environment to the browser, and an unrecognised value is refused there exactly as it is on the server.
  return readEnvironment() !== "production";
}
/** Refuses a development control in production; throws `DevelopmentOnlyError` naming the feature when the control is not available. */
export function assertDevelopmentOnly(feature: string): void {
  if (!isDevelopment()) throw new DevelopmentOnlyError(feature);
}
/** Narrows an unknown parsed value to a plain object, excluding arrays and null. */
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Narrows an unknown value to a string that carries at least one character. */
export const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
