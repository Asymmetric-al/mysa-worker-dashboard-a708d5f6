/** `/` — Home, the post-admission landing route and the origin every reachability sweep starts from (AAP 0.9.2, 0.12.6). **Why this route exists.** AAP 0.9.1 lists `apps/dashboard/src/app/page.tsx` … */
import type { Metadata } from "next";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import HomeSections from "@/features/home/components/home-sections";
import { HOME_COPY } from "@/features/home/copy";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";
/** The read resolves the session, the context and the scenario instant per request, so nothing here may be cached. */
export const dynamic = "force-dynamic";
/** The document title: the surface, and nothing that would duplicate the root layout template's suffix. */
export const metadata: Metadata = { title: HOME_COPY.title };
/** The one sentence a refusal states. */
const HOME_DENIED_DESCRIPTION = "Home could not be read for this session, so no item, count or reason is stated here — a refusal is not a quiet day. " + "If this session admits another context, the shell is where that context is chosen.";
/** The Home screen: the worker's day in three sections, or the reason it could not be read. */
export default async function HomePage(): Promise<ReactElement> {
  const result = await reads.context.readHome();
  switch (result.kind) {
    case "envelope":
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <div className="flex min-w-0 flex-col gap-2">
            {/* The one h1 on this page: every section below opens at level two. */}
            <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{HOME_COPY.title}</h1>
            <p className="max-w-prose text-sm text-pretty text-muted-foreground">{HOME_COPY.lead}</p>
          </div>
          <HomeSections initial={result} scope={result.envelope.scope} />
        </div>
      );
    case "denied":
      // No item, no count, no empty list: the answer is the same whether or not work exists in the context this session may not read.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="denied" headingLevel={1} title={HOME_COPY.title} description={HOME_DENIED_DESCRIPTION} reasonCode={result.denied.reasonCode} />
        </div>
      );
    case "unavailable":
      // The service's own retry guidance and the source that did not answer, never an empty Home and never a zero.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="unavailable" headingLevel={1} title={HOME_COPY.title} description={result.unavailable.guidance} source={result.unavailable.source} />
        </div>
      );
    case "refused":
      // Home's own read answered and the request it made is what has to be corrected: nothing behind the sections failed, so this is neither a denial nor an outage.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="refused" headingLevel={1} title={HOME_COPY.title} />
        </div>
      );
    default:
      return assertNever(result, "Unhandled Home read result");
  }
}
