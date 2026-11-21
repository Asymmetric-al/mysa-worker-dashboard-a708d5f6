/**
 * `/support/commitments/[commitmentId]` — one commitment as the source states it, read-only (AAP 0.9.1
 * "Commitment detail"; AAP 0.11.1 files this route among the ones that compose a feature and hold no
 * business logic of their own).
 *
 * **One read, and the envelope decides what may be stated.** The route calls the closed inventory's
 * commitments read, narrowed to the identifier the address names, and renders one of its three arms. A
 * refusal states nothing about the record — no title, count, size or existence flag — and is the same
 * answer for an identifier that does not exist and one this session may not read (AAP 0.7.1). An
 * unavailable source names the source that did not answer and never renders an empty commitment or a
 * zero (AAP 0.8.1).
 *
 * **The record itself belongs to the family's detail body.** `features/support/components/commitment-detail`
 * owns the kind, cadence, per-occurrence amount, the outcome bucket and its meaning, the dates, a fixed
 * total's four figures, the outcome partition, provenance and the snapshot — and owns the states an
 * identifier that this read does not report lands in. This file passes that body the scope the service
 * itself derived from the session and nothing else, so no authority is invented here and no second
 * implementation of the record's own states exists. The body reads the list state it returns to from the
 * address, so this route forwards the address onto its own notice links rather than parsing it twice.
 *
 * **Nothing here computes or offers a change.** No amount, date, count, average or monthly equivalent is
 * derived on this surface, and no control posts, retries, pauses, resumes, corrects or "marks received" a
 * payment: a commitment is not received cash, and this page states that rather than implying otherwise.
 * An unknown identifier is stated rather than answered with the framework's own not-found response, which
 * would render outside the shell and drop the persistent **Development data** label.
 */
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { CommitmentDetail } from "@/features/support/components/commitment-detail";
import { reads } from "@/modules/data-service";
// Fixed values: where this surface returns to, and the words it owns because the family copy does not
const LIST_HREF = "/support/commitments";

const RETURN_LABEL = "Back to the commitments list";

const RETRY_LABEL = "Read this commitment again";

const DENIED_TITLE = "This commitment is not shown in this context";

const DENIED_DESCRIPTION =
  "The commitments read was refused for the context this session is admitted to. Nothing here states whether a commitment carries that identifier, what such a commitment would be, or how large it is.";

const UNAVAILABLE_TITLE = "The commitment could not be read";
/**
 * The interface locale the detail body formats amounts and dates in. A viewer's own locale is a client
 * presentation preference the shell holds, which a Server Component cannot read, so this route states the
 * application's default rather than inventing a choice it cannot observe.
 */
const INTERFACE_LOCALE = "en-GB";
/** Props of the route: Next 16 hands both members over as promises. */
type CommitmentDetailRouteProps = {
  readonly params: Promise<{ commitmentId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};
/** A record belongs to one session's context, so no rendered page may be cached across a context switch, a restriction or a scenario change. */
export const dynamic = "force-dynamic";
/** The list's own search state, carried forward so a way back restores the page and facets it states. */
function searchSuffixOf(query: Readonly<Record<string, string | string[] | undefined>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") {
      params.set(key, value);
      continue;
    }
    if (value === undefined) {
      continue;
    }
    for (const entry of value) {
      params.append(key, entry);
    }
  }
  const search = params.toString();
  return search.length === 0 ? "" : `?${search}`;
}
/** One commitment: the envelope for it, or the read's own refusal stated as `denied` or `unavailable`. */
export default async function CommitmentDetailPage({ params, searchParams }: CommitmentDetailRouteProps): Promise<ReactElement> {
  const { commitmentId } = await params;
  // The address decides only where this page returns to; it never narrows, sorts or pages the record.
  const carried = searchSuffixOf(await searchParams);
  // The organisation, ministry, support subject and principal are derived by the service from this
  // session. The route supplies the record's opaque identifier and nothing that could invent authority.
  const result = await reads.support.readCommitments({ commitmentId });
  if (result.kind === "denied") {
    return (
      <div className="flex min-w-0 flex-col gap-4 text-start">
        <StateNotice
          kind="denied"
          headingLevel={1}
          title={DENIED_TITLE}
          description={DENIED_DESCRIPTION}
          reasonCode={result.denied.reasonCode}
          action={{ label: RETURN_LABEL, href: `${LIST_HREF}${carried}` }}
        />
      </div>
    );
  }
  if (result.kind === "unavailable") {
    return (
      <div className="flex min-w-0 flex-col gap-4 text-start">
        {/* The source did not answer, so the record is unavailable rather than empty. The retry is an
            address: requesting this route again re-runs the same read against the same session. */}
        <StateNotice
          kind="unavailable"
          headingLevel={1}
          title={UNAVAILABLE_TITLE}
          description={result.unavailable.guidance}
          source={result.unavailable.source}
          action={{ label: RETRY_LABEL, href: `${LIST_HREF}/${encodeURIComponent(commitmentId)}${carried}` }}
        />
      </div>
    );
  }
  return <CommitmentDetail scope={result.envelope.scope} commitmentId={commitmentId} locale={INTERFACE_LOCALE} />;
}
