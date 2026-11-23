import type { ReactElement } from "react";
import { lifecycleOf, variantRecordOf } from "@/components/draft-status";
import StateNotice from "@/components/state-notice";
import { EXCLUSION_REASON_COPY } from "@/features/audience/copy/membership";
import { PublishReview, type PublishAudienceCeiling, type PublishEditionView, type PublishExclusionRow, type PublishReleaseView } from "@/features/updates/components/publish-review";
import { VariantOverview } from "@/features/updates/components/variant-overview";
import { assertNever } from "@/lib/result";
import type { ExclusionReason } from "@/modules/audience/resolve";
import type { Release } from "@/modules/content/variant";
import { reads } from "@/modules/data-service";
import { wireFormOf } from "../../page-frame";
type OverviewEnvelope = Extract<Awaited<ReturnType<typeof reads.updates.readVariantOverview>>, { readonly kind: "envelope" }>["envelope"];
const PAGE_LEDE = "Every edition of this Update, each with its own saved draft, its frozen candidate and its published revision. " + "A release is what a reader is served; a notice is a separate outcome again, and no edition is ever summarised " + "into one status for the whole Update.";
const SURFACE_HEADING_LEVEL = 2;
/** The level the release review occupies: a second section under the same `h1`, beside the matrix rather than inside it, because releasing is not one of the matrix's per-edition writes and the review opens its own blocks below itself. */
const PUBLISH_HEADING_LEVEL = 2;
const NOTICE_HEADING_LEVEL = 1;
const DENIED_DESCRIPTION = "This session may not read this Update's editions in the context it is working in, so no edition, revision, " + "candidate, language or count is stated here. A refusal is not an Update with no editions.";
const UNAVAILABLE_FALLBACK = "The source holding this Update could not be read, so nothing is stated in place of its editions. Retry the same " + "read: an outage is never presented as an Update with no editions.";
const REFUSED_TITLE = "This overview's request was refused";
const REFUSED_DESCRIPTION = "The address this page asked the read to resolve is not one the read admits, so nothing was read and nothing is " + "shown in its place. Opening an Update from the Updates list states the address the read does admit.";
const NOT_AN_UPDATE_TITLE = "This address does not name an Update";
const NOT_AN_UPDATE_DESCRIPTION = "The document this address names is a Page rather than an Update, so it is not shown here under Update wording. " + "A Page is composed, previewed and released from its own route, where its locale editions and its give " + "placement are stated.";
const ROOT_CLASS = "flex min-w-0 flex-col gap-6 text-start";
type OverviewSurfaceProps = { readonly envelope: OverviewEnvelope; /** The recipient ceiling the audience read stated for this publisher, or why it stated none. */ readonly ceiling: PublishAudienceCeiling | undefined };
/** One edition of this Update as the matrix read states it, so the review's rows are the matrix's own facts. */
type EditionView = OverviewEnvelope["data"]["editions"][number];
/** What the audience read answers with: the recipient ceiling's own counts, its refusal, or the outage behind them. */
type AudienceResult = Awaited<ReturnType<typeof reads.audience.readAudience>>;
/** One release as the review's own plain view: the record's fields with its instants as the ISO text the wire form carries. `JSON.stringify` writes a `Temporal.Instant` as the very text `toString()` states, so this is the value the transport would have handed a browser — an instant object cannot cross to a Client Component, and none does. */
const releaseViewOf = (release: Release): PublishReleaseView => ({
  releaseId: release.releaseId,
  variantId: release.variantId,
  revisionId: release.revisionId,
  audience: release.audience,
  locale: release.locale,
  publishedAt: release.publishedAt.toString(),
  reach: release.reach,
  contentChecksum: release.contentChecksum,
  ...(release.withdrawnAt === undefined ? {} : { withdrawnAt: release.withdrawnAt.toString() }),
  ...(release.supersededBy === undefined ? {} : { supersededBy: release.supersededBy }),
});
/** One edition of the review: what it is, the lifecycle word its own records state through the one shared evaluator, the frozen candidate the read projected straight through, and the release standing at its head. Nothing else is derived — a count, a mode and a notice decision are the read's and the service's to state. */
const publishEditionOf = (documentId: string, edition: EditionView): PublishEditionView => ({
  variantId: edition.variantId,
  audience: edition.audience,
  locale: edition.locale,
  lifecycle: lifecycleOf(variantRecordOf(documentId, edition), edition.headRelease ?? undefined),
  candidate: edition.candidate,
  headRelease: edition.headRelease === null ? null : releaseViewOf(edition.headRelease),
});
/** One row per exclusion the audience read counted, in the order the audience copy states its reasons. A reason the read counted nobody under is not listed: a row stating zero beside every reason would read as an exclusion that exists. */
function exclusionRowsOf(counts: Readonly<Record<ExclusionReason, number>>): readonly PublishExclusionRow[] {
  const rows: PublishExclusionRow[] = [];
  for (const reason of Object.keys(EXCLUSION_REASON_COPY) as readonly ExclusionReason[]) {
    const count = counts[reason];
    if (count > 0) rows.push({ reason: EXCLUSION_REASON_COPY[reason], count });
  }
  return rows;
}
/** The recipient ceiling a notice would be acknowledged against, read here rather than fetched from this application's own handler: the audience envelope's counts for this publisher and the Update email purpose are the same facts the audience screen shows, and a refusal or an outage is stated as itself rather than as an audience of nobody. */
async function ceilingOf(): Promise<PublishAudienceCeiling | undefined> {
  const result: AudienceResult = await reads.audience.readAudience();
  switch (result.kind) {
    case "envelope": {
      const data = result.envelope.data;
      return { state: "stated", eligible: data.counts.eligible, excluded: data.counts.excluded, excludedByReason: exclusionRowsOf(data.excludedByReason) };
    }
    case "denied":
      return { state: "denied", reasonCode: result.denied.reasonCode };
    case "unavailable":
      return { state: "unavailable", source: result.unavailable.source, guidance: result.unavailable.guidance };
    case "refused":
      // This route states the audience read's own query — no publisher, no page and no page size — so there is no request here the read could refuse. The arm is stated rather than thrown because the union is closed, and the review states the ceiling's absence in its own words instead of inventing a count.
      return undefined;
    default:
      return assertNever(result, "Unhandled audience read result");
  }
}
/** The page's one `h1`, its lede, then the family's own matrix seeded with the envelope this request already read, and below it the release review that publishes the frozen revision of the editions a person selects. */
const OverviewSurface = ({ envelope, ceiling }: OverviewSurfaceProps): ReactElement => {
  const documentId = envelope.data.document.documentId;
  return (
    <div className={ROOT_CLASS}>
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{"Update"}</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{PAGE_LEDE}</p>
      </div>
      <VariantOverview scope={envelope.scope} documentId={documentId} initialResult={{ kind: "envelope", envelope: wireFormOf(envelope) }} headingLevel={SURFACE_HEADING_LEVEL} />
      <PublishReview scope={envelope.scope} documentId={documentId} expectedRevision={envelope.revision} editions={envelope.data.editions.map((edition) => publishEditionOf(documentId, edition))} {...(ceiling === undefined ? {} : { ceiling })} headingLevel={PUBLISH_HEADING_LEVEL} />
    </div>
  );
};
function unavailableNotice(source: OverviewEnvelope["source"], guidance: string): ReactElement {
  const stated = guidance.trim();
  return <StateNotice kind="unavailable" headingLevel={NOTICE_HEADING_LEVEL} title="The editions could not be read" description={stated === "" ? UNAVAILABLE_FALLBACK : stated} source={source} className={ROOT_CLASS} />;
}
const refusedNotice = (title: string, description: string): ReactElement => <StateNotice kind="refused" headingLevel={NOTICE_HEADING_LEVEL} title={title} description={description} className={ROOT_CLASS} />;
/** The variant overview and status of one Update: one read, one envelope, and an honest notice in place of the matrix when the read does not answer with one. */
export default async function CommunicationUpdateOverviewPage({ params }: { readonly params: Promise<{ updateId: string }> }): Promise<ReactElement> {
  const { updateId } = await params;
  const result = await reads.updates.readVariantOverview({ documentId: updateId });
  switch (result.kind) {
    case "envelope": {
      // An Update's matrix is this family's surface, so a document of another family is a request this route does not serve rather than one it renders under Update wording. The comparison is a routing decision on a fact the read states; it derives no lifecycle and carries no authority, which stays with the read.
      if (result.envelope.data.document.family !== "update") return refusedNotice(NOT_AN_UPDATE_TITLE, NOT_AN_UPDATE_DESCRIPTION);
      return <OverviewSurface envelope={result.envelope} ceiling={await ceilingOf()} />; // The ceiling is read only for an Update this route serves, and it is the service's own audience read rather than a request to this application's handler: the same counts the audience screen shows, under this scope.
    }
    case "denied":
      return <StateNotice kind="denied" headingLevel={NOTICE_HEADING_LEVEL} title="These editions are not available in this session" description={DENIED_DESCRIPTION} reasonCode={result.denied.reasonCode} className={ROOT_CLASS} />;
    case "unavailable":
      return unavailableNotice(result.unavailable.source, result.unavailable.guidance);
    case "refused":
      return refusedNotice(REFUSED_TITLE, REFUSED_DESCRIPTION);
    default:
      return assertNever(result, "Unhandled variant overview read result");
  }
}
