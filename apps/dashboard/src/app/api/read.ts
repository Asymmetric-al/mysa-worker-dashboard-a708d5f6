import type { z } from "zod";
import { outcomeFromError, refusedRead, toResponse, type MutationOutcome, type ReadResult } from "@/modules/data-service";
import type { FieldMessages } from "@/modules/data-service/outcome";
/** The marker a read that reached no mutation reports under: a read makes no operation identity of its own. */ export const READ_ATTEMPT = "read";
/** One URL judged by a read's own grammar: the value the read takes, or the per-field refusal the caller has to correct. */
export type ReadGrammar<Value> = (search: URLSearchParams) => { readonly value: Value } | { readonly refusal: z.ZodError | FieldMessages };
/** The grammar one Zod schema and its raw-parameter reader make: a request the schema refuses is answered with its own messages, keyed by field path. */
export function readGrammar<S extends z.ZodType>(schema: S, raw: (search: URLSearchParams) => unknown): ReadGrammar<z.output<S>> {
  return (search) => {
    const parsed = schema.safeParse(raw(search));
    return parsed.success ? { value: parsed.data } : { refusal: parsed.error };
  };
}
/** The grammar a reader that answers a parsed query or the error that refused it makes, so a shared search grammar needs no second wrapper at each transport. */
export function readJudgement<Value>(parse: (search: URLSearchParams) => { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: z.ZodError }): ReadGrammar<Value> {
  return (search) => {
    const parsed = parse(search);
    return parsed.ok ? { value: parsed.value } : { refusal: parsed.error };
  };
}
/** How one read transport writes an answer: the envelope, denial, refusal or outage as JSON, or that same body under the headers its own path states. */
export type ReadResponder = (result: MutationOutcome | ReadResult<unknown>) => Response;
const jsonResponse: ReadResponder = (result) => toResponse(result);
/** The responder a read uses where its answer must state that it may not be cached, so a still-open import proposal or check-in is never served from a copy. */
export const NO_STORE_RESPONSE: ReadResponder = (result) => toResponse(result, { headers: { "cache-control": "no-store" } });
/** Answers one read attempt: the service's own envelope or refusal, and against a throw the outcome that names a store fault or a lost acknowledgement rather than escaping the boundary. */
export async function readResponse(marker: string, read: () => Promise<ReadResult<unknown>>, respond: ReadResponder = jsonResponse): Promise<Response> {
  try {
    return respond(await read());
  } catch (error) {
    return respond(outcomeFromError(marker, error)); // A read makes no effect, so a throw is a store or medium fault, or a failure whose fate is not known, and its outcome carries the marker rather than an operation id.
  }
}
/** The `GET` one read path serves: its grammar judges the URL before any read runs, and the named read answers the value it parsed. */
export function readRoute<Value>(grammar: ReadGrammar<Value>, read: (value: Value, search: URLSearchParams) => Promise<ReadResult<unknown>>, marker: string = READ_ATTEMPT, respond: ReadResponder = jsonResponse): (request: Request) => Promise<Response> {
  return async (request) => {
    const search = new URL(request.url).searchParams;
    const judged = grammar(search);
    return "refusal" in judged ? respond(refusedRead(marker, judged.refusal)) : readResponse(marker, () => read(judged.value, search), respond);
  };
}
