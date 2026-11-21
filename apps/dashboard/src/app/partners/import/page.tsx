/**
 * `/partners/import` — the contact-import journey: one chosen CSV file, its mapping, a decision about
 * every row, the acceptance of the rows decided, and the result of that acceptance.
 *
 * **What this file is.** Admission and composition, nothing else. It asks the service whether this
 * session is admitted — the one read the shell's own entry also makes — and hands the admitted context
 * to `features/import/components/import-journey`, which owns the five steps, the transport and the
 * identity of every attempt. Nothing here reads a record, decides a permission, derives a verdict, a
 * suggestion or a window, or posts anything: a second authority on any of those would be a second answer
 * the surface could disagree with.
 *
 * **Read in process, never over HTTP.** A Server Component must not reach the application's own route
 * handler, so the admission is read through `reads` directly. Scope is derived by the service from this
 * session, so nothing in the address can widen what the caller may import into.
 *
 * **Every arm is honest.** `readAdmissionState` answers with the closed three-arm read: a refusal renders
 * the shared notice with its closed reason code and names no record, an outage renders the shared notice
 * with the source that could not be reached — never an empty journey — and the admitted arm composes the
 * journey. Each arm states exactly one `h1`, and the shell owns the single `main` landmark and the
 * persistent Development data label, so neither is repeated here.
 *
 * **The address may name an operation.** A journey whose acknowledgement was lost can be reopened by its
 * own operation identity, which is what lets the result be read back instead of the import being
 * repeated. The first value of `operation` is taken when it is a non-empty string and nothing is passed
 * otherwise, so a malformed parameter states no operation rather than an invented one.
 *
 * **Freshness.** `dynamic = "force-dynamic"`: admission resolves the session, the context and the
 * scenario instant per request, so a cached render would serve one context's admission to another.
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { FormErrorSummary, fieldErrorsFromInvalid } from "@/components/form-field";
import { IMPORT_OPERATION_PARAM, JOURNEY_COPY } from "@/features/import/copy";
import ImportJourney from "@/features/import/components/import-journey";
import { reads } from "@/modules/data-service";
/** The read resolves the session, the context and the scenario instant per request, so nothing here may be cached. */
export const dynamic = "force-dynamic";
/** The document title: the surface, and nothing that would duplicate the root layout's suffix. */
export const metadata: Metadata = { title: JOURNEY_COPY.heading };
/** The URL's own parameter record, as Next 16 hands a route its search parameters. */
type SearchParams = Record<string, string | string[] | undefined>;
/** Props of {@link ImportPage}. */
export interface ImportPageProps {
  readonly searchParams: Promise<SearchParams>;
}
/**
 * The operation this address names, if it names one: the first value only, and only when it is a non-empty
 * string. The identity is an opaque value and is never trimmed, parsed or compared here.
 */
function operationIdOf(params: SearchParams): string | undefined {
  const stated = params[IMPORT_OPERATION_PARAM];
  const first = Array.isArray(stated) ? stated[0] : stated;
  return typeof first === "string" && first.length > 0 ? first : undefined;
}
/** The contact-import journey's destination: admission, the page's one heading and lead, and the journey itself. */
export default async function ImportPage({ searchParams }: ImportPageProps): Promise<ReactElement> {
  const admission = await reads.context.readAdmissionState();
  const initialOperationId = operationIdOf(await searchParams);
  switch (admission.kind) {
    case "denied":
      // A refusal shows no part of a journey. The notice carries the page's only heading, and the closed
      // reason code is the whole answer: no record, count or size travels with it.
      return (
        <div className="flex min-w-0 flex-col gap-4 text-start">
          <StateNotice kind="denied" headingLevel={1} title={JOURNEY_COPY.heading} reasonCode={admission.denied.reasonCode} />
        </div>
      );
    case "refused":
      // Admission takes no input of its own, so a refused request is the service declining the request rather
      // than the session: the page states its heading and the service's own field messages, and shows no step.
      return (
        <div className="flex min-w-0 flex-col gap-4 text-start">
          <h1 className="text-2xl font-semibold text-balance">{JOURNEY_COPY.heading}</h1>
          <FormErrorSummary errors={fieldErrorsFromInvalid(admission.refused)} title={JOURNEY_COPY.readRefused.title} description={JOURNEY_COPY.readRefused.lead} />
        </div>
      );
    case "unavailable":
      // The source behind admission did not answer, so the journey is reported as unavailable rather than
      // shown empty, and the reason is the service's own guidance.
      return (
        <div className="flex min-w-0 flex-col gap-4 text-start">
          <StateNotice kind="unavailable" headingLevel={1} title={JOURNEY_COPY.heading} source={admission.unavailable.source} description={admission.unavailable.guidance} />
        </div>
      );
    case "envelope":
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <header className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl font-semibold text-balance">{JOURNEY_COPY.heading}</h1>
            <p className="text-pretty text-muted-foreground">{JOURNEY_COPY.lead}</p>
          </header>
          <ImportJourney scope={admission.envelope.scope} expectedRevision={admission.envelope.revision} {...(initialOperationId === undefined ? {} : { initialOperationId })} />
        </div>
      );
  }
}
