import type { Metadata } from "next";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { FormErrorSummary, fieldErrorsFromInvalid } from "@/components/form-field";
import { IMPORT_OPERATION_PARAM, JOURNEY_COPY } from "@/features/import/copy";
import ImportJourney from "@/features/import/components/import-journey";
import { reads } from "@/modules/data-service";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: JOURNEY_COPY.heading };
type SearchParams = Record<string, string | string[] | undefined>;
const ADMISSION_COLUMN_CLASS = "flex min-w-0 flex-col gap-4 text-start";
function operationIdOf(params: SearchParams): string | undefined {
  const stated = params[IMPORT_OPERATION_PARAM];
  const first = Array.isArray(stated) ? stated[0] : stated;
  return typeof first === "string" && first.length > 0 ? first : undefined;
}
/** The contact-import journey's destination: admission, the page's one heading and lead, and the journey itself. */
export default async function ImportPage({ searchParams }: { readonly searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const admission = await reads.context.readAdmissionState();
  const initialOperationId = operationIdOf(await searchParams);
  switch (admission.kind) {
    case "denied":
      return <StateNotice kind="denied" headingLevel={1} title={JOURNEY_COPY.heading} reasonCode={admission.denied.reasonCode} className={ADMISSION_COLUMN_CLASS} />;
    case "refused":
      return (
        <div className={ADMISSION_COLUMN_CLASS}>
          <h1 className="type-page-title text-balance">{JOURNEY_COPY.heading}</h1>
          <FormErrorSummary errors={fieldErrorsFromInvalid(admission.refused)} title={JOURNEY_COPY.readRefused.title} description={JOURNEY_COPY.readRefused.lead} />
        </div>
      );
    case "unavailable":
      return <StateNotice kind="unavailable" headingLevel={1} title={JOURNEY_COPY.heading} source={admission.unavailable.source} description={admission.unavailable.guidance} className={ADMISSION_COLUMN_CLASS} />;
    case "envelope":
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <header className="flex min-w-0 flex-col gap-1">
            <h1 className="type-page-title text-balance">{JOURNEY_COPY.heading}</h1>
            <p className="type-supporting text-pretty">{JOURNEY_COPY.lead}</p>
          </header>
          <ImportJourney scope={admission.envelope.scope} expectedRevision={admission.envelope.revision} {...(initialOperationId === undefined ? {} : { initialOperationId })} />
        </div>
      );
  }
}
