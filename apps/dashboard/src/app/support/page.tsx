/**
 * `/support` — the support overview (AAP 0.9.1, 0.6.4): received support cash first, the recurring outcomes that
 * are not cash beside it, the monthly history, then the committed measures and the goal it is read beside.
 *
 * **What this file is.** Composition, nothing else. It calls the overview read once and hands the one envelope
 * to the family's own overview surface, which owns every figure, bucket, chart, goal control and word on it.
 * No amount is formatted, derived or combined here, no percentage is computed here, and no client state lives
 * here.
 *
 * **Why this route states no view parameters.** The family's browser read of this same job asks
 * `GET /api/support` for the read's own default and accepts no period, currency or year, so a filter taken
 * from this address would be honoured by the server render and then silently replaced by the default on the
 * next browser read — leaving a filter in the address beside figures that no longer describe it. The filter
 * state that does exist belongs to the gifts ledger and the four reports, whose own routes map their URL.
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import { SupportOverview } from "@/features/support/components/support-overview";
import { assertNever } from "@/lib/result";
import { reads, type ReadEnvelope } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Shapes, taken from the service rather than restated
// ---------------------------------------------------------------------------------------------

/** What `readSupportOverview` answers with: the envelope, a denial, an outage behind the records, or a refused request. */
type SupportOverviewResult = Awaited<ReturnType<typeof reads.support.readSupportOverview>>;

/** The envelope arm, narrowed once so the surface below reads the scope and the data from the one shape. */
type SupportOverviewEnvelope = Extract<SupportOverviewResult, { readonly kind: "envelope" }>["envelope"];

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** Admission, the selected context, the scenario instant and the source's coverage are resolved per request, so nothing on this route may be cached across a context switch. */
export const dynamic = "force-dynamic";

/** The page's title, which the root layout's template extends with the application name. */
const PAGE_TITLE = "Support";

/** The document title: the surface, and nothing that would duplicate the template's suffix. */
export const metadata: Metadata = { title: PAGE_TITLE };

/** The interface locale the composed surface formats amounts and counts in. */
const INTERFACE_LOCALE = "en-GB";

/** This page's own address, which a retry re-requests: the read runs again for the same session and context. */
const SUPPORT_HREF = "/support";

/** The wording this route states when the read answers with something other than an envelope. */
const PAGE_COPY = {
  denied: {
    title: "Support is not available in this context",
    body: "This session may not read received support in the context it is working in, so no amount, count, period or coverage is stated here — a refusal is not an empty overview. Another context, if this session holds one, can be chosen from the shell.",
  },
  unavailable: { title: "The support overview could not be read", retry: "Try this read again" },
  refused: { title: "This overview's request was refused", body: "The overview states no filter of its own, so the request this page makes is the read's own default one; a request the read refuses is answered here rather than thrown, and the source behind it did not fail." },
} as const;

// ---------------------------------------------------------------------------------------------
// The surface the envelope arm renders
// ---------------------------------------------------------------------------------------------

/**
 * The envelope in the wire's own encoding. The report states its civil dates as `Temporal.PlainDate`
 * values, and a Client Component accepts only plain ones, so the bytes the browser handler would answer
 * with are what this route hands over: the figures the render already holds, carrying no object the
 * browser could not have received itself.
 */
function wireFormOf(envelope: SupportOverviewEnvelope): ReadEnvelope<unknown> {
  const wire: unknown = JSON.parse(JSON.stringify(envelope));
  return wire as ReadEnvelope<unknown>;
}

/** The page's one `h1`, then the family's overview seeded with the envelope this request already read, so the browser neither re-requests those figures nor waits for them. */
function OverviewSurface({ envelope }: { readonly envelope: SupportOverviewEnvelope }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      {/* The one h1 on this page: the composed overview opens its own sections at level two. */}
      <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{PAGE_TITLE}</h1>
      <SupportOverview scope={envelope.scope} locale={INTERFACE_LOCALE} initialEnvelope={wireFormOf(envelope)} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/** The Support overview: one read, one snapshot, and an honest notice in place of the figures when the read does not answer with an envelope. */
export default async function SupportOverviewPage(): Promise<ReactElement> {
  const result = await reads.support.readSupportOverview();
  switch (result.kind) {
    case "envelope":
      return <OverviewSurface envelope={result.envelope} />;
    case "denied":
      // No amount, count, period or coverage: the closed reason code is the whole answer, and it is the same
      // whether or not this context holds any support at all.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="denied" headingLevel={1} title={PAGE_COPY.denied.title} description={PAGE_COPY.denied.body} reasonCode={result.denied.reasonCode} />
        </div>
      );
    case "unavailable":
      // The source did not answer, so the overview is reported as unavailable and never as a zero or an empty
      // one: the notice states the source identity, the service's own guidance, and a retry of this same read.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="unavailable" headingLevel={1} title={PAGE_COPY.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} action={{ label: PAGE_COPY.unavailable.retry, href: SUPPORT_HREF }} />
        </div>
      );
    case "refused":
      // The query this page states is the read's own default, so a refusal is not expected today; the arm is
      // stated rather than thrown, so a request the read ever refuses answers in this page's own words instead
      // of a stack trace, and the notice says the request was refused rather than the source failing.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="refused" headingLevel={1} title={PAGE_COPY.refused.title} description={PAGE_COPY.refused.body} />
        </div>
      );
    default:
      return assertNever(result, "Unhandled support overview read result");
  }
}
