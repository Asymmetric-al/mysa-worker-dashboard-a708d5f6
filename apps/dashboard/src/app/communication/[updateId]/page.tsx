/**
 * `/communication/[updateId]` — the variant overview of one Update (AAP 0.9.1 tree, "Variant overview and
 * status"; AAP 0.11.1, "route composition: one file per listed route, each composing a feature with no business
 * logic").
 *
 * **What this route is.** An Update is one canonical document whose editions are one audience in one content
 * language, and every edition keeps its own saved draft, its own frozen candidate and its own published revision.
 * `VariantOverview` owns that matrix from the read's own facts: each edition's three pointers, its head release,
 * how its translation stands, the actions the read states, and the writes the record facts allow. This file hands
 * it the envelope and decides nothing about a lifecycle word, a revision, an audience, a language, an eligibility
 * count or a deadline.
 *
 * **The distinctions the page must not blur.** A saved draft is not a frozen candidate, a candidate is not a
 * release, a withdrawn release is not a release still served, and a prior-good head preserved beside a sibling's
 * failed release is neither a newly released translation nor a rollback. Publication is not notification,
 * notification is not delivery and delivery is not reading. Each of those is stated from the envelope, so this
 * file words none of them itself and composes no second copy of the vocabulary that owns them.
 *
 * **One read, one envelope.** `reads.updates.readVariantOverview` is the route's only read: the release heads are
 * folded into it, so there is no second read for them, no `fetch` of this application's own handler, and no path
 * to the synthetic store. The envelope is the answer, and it seeds the browser surface so no duplicate request is
 * issued for what this render already holds.
 */
import type { ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import { VariantOverview } from "@/features/updates/components/variant-overview";
import { assertNever } from "@/lib/result";
import { reads, type DenialReason } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// The read's own shapes, taken from the service surface rather than restated
// ---------------------------------------------------------------------------------------------

/** What `readVariantOverview` answers with: the envelope, a denial, an outage behind the records, or a refused request. */
type OverviewResult = Awaited<ReturnType<typeof reads.updates.readVariantOverview>>;

/** The envelope arm, narrowed once so the surface below reads the scope, the payload and the identity from one shape. */
type OverviewEnvelope = Extract<OverviewResult, { readonly kind: "envelope" }>["envelope"];

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The page's one `h1`. It names the record this route shows and no title of its own, because the document's title belongs to its editions and is stated there. */
const PAGE_TITLE = "Update";

/**
 * What the page states above the matrix, in the product's own terms: the three independent pointers an edition
 * keeps, and the fact that a release and a notice are two different outcomes. No lifecycle word is introduced
 * here that the matrix does not also state.
 */
const PAGE_LEDE =
  "Every edition of this Update, each with its own saved draft, its frozen candidate and its published revision. " +
  "A release is what a reader is served; a notice is a separate outcome again, and no edition is ever summarised " +
  "into one status for the whole Update.";

/** The level of the matrix's own heading: it nests under this page's single `h1` and opens its own sections below that. */
const SURFACE_HEADING_LEVEL = 2;

/** The level a notice occupies when it replaces the matrix, so every answer from this route still states one `h1`. */
const NOTICE_HEADING_LEVEL = 1;

/** A refusal: the condition and nothing about what may or may not exist here, because the answer is identical either way. */
const DENIED_TITLE = "These editions are not available in this session";
const DENIED_DESCRIPTION =
  "This session may not read this Update's editions in the context it is working in, so no edition, revision, " +
  "candidate, language or count is stated here. A refusal is not an Update with no editions.";

/** An outage: the source did not answer, which is neither an empty Update nor a hidden one. */
const UNAVAILABLE_TITLE = "The editions could not be read";
const UNAVAILABLE_FALLBACK =
  "The source holding this Update could not be read, so nothing is stated in place of its editions. Retry the same " +
  "read: an outage is never presented as an Update with no editions.";

/** A refused request: this route calls the read directly, so the arm is stated rather than thrown, and the source did not fail. */
const REFUSED_TITLE = "This overview's request was refused";
const REFUSED_DESCRIPTION =
  "The address this page asked the read to resolve is not one the read admits, so nothing was read and nothing is " +
  "shown in its place. Opening an Update from the Updates list states the address the read does admit.";

/**
 * A document of another family. The matrix states an Update's audience axis — public and approved-supporter
 * editions per content language — while a Page's editions are public locale editions with a give placement of
 * their own, so presenting one under this route's wording would state an axis the document does not have.
 */
const NOT_AN_UPDATE_TITLE = "This address does not name an Update";
const NOT_AN_UPDATE_DESCRIPTION =
  "The document this address names is a Page rather than an Update, so it is not shown here under Update wording. " +
  "A Page is composed, previewed and released from its own route, where its locale editions and its give " +
  "placement are stated.";

const ROOT_CLASS = "flex min-w-0 flex-col gap-6 text-start";

const HEADING_GROUP_CLASS = "flex min-w-0 flex-col gap-2";

const TITLE_CLASS = "text-2xl font-semibold text-pretty wrap-anywhere";

const LEDE_CLASS = "max-w-prose text-sm text-pretty text-muted-foreground";

// ---------------------------------------------------------------------------------------------
// The envelope in the encoding a Client Component may receive
// ---------------------------------------------------------------------------------------------

/**
 * The envelope as the browser handler would have answered with. The read states a release's instants as
 * `Temporal.Instant` values, and a Client Component accepts only plain ones, so this route hands over the exact
 * bytes the transport would: the same facts the render already holds, carrying no object the browser could not
 * have received itself. It re-encodes nothing — the payload that reaches `VariantOverview` is the read's own.
 */
function wireFormOf(envelope: OverviewEnvelope): OverviewEnvelope {
  const wire: unknown = JSON.parse(JSON.stringify(envelope));
  return wire as OverviewEnvelope;
}

// ---------------------------------------------------------------------------------------------
// The surface the envelope arm composes
// ---------------------------------------------------------------------------------------------

interface OverviewSurfaceProps {
  readonly envelope: OverviewEnvelope;
}

/** The page's one `h1`, its lede, then the family's own matrix seeded with the envelope this request already read. */
function OverviewSurface({ envelope }: OverviewSurfaceProps): ReactElement {
  return (
    <div className={ROOT_CLASS}>
      <div className={HEADING_GROUP_CLASS}>
        <h1 className={TITLE_CLASS}>{PAGE_TITLE}</h1>
        <p className={LEDE_CLASS}>{PAGE_LEDE}</p>
      </div>
      <VariantOverview
        scope={envelope.scope}
        documentId={envelope.data.document.documentId}
        initialResult={{ kind: "envelope", envelope: wireFormOf(envelope) }}
        headingLevel={SURFACE_HEADING_LEVEL}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The honest answers this route renders in place of the matrix
// ---------------------------------------------------------------------------------------------

function deniedNotice(reasonCode: DenialReason): ReactElement {
  return (
    <div className={ROOT_CLASS}>
      <StateNotice kind="denied" headingLevel={NOTICE_HEADING_LEVEL} title={DENIED_TITLE} description={DENIED_DESCRIPTION} reasonCode={reasonCode} />
    </div>
  );
}

function unavailableNotice(source: OverviewEnvelope["source"], guidance: string): ReactElement {
  const stated = guidance.trim();
  return (
    <div className={ROOT_CLASS}>
      <StateNotice kind="unavailable" headingLevel={NOTICE_HEADING_LEVEL} title={UNAVAILABLE_TITLE} description={stated === "" ? UNAVAILABLE_FALLBACK : stated} source={source} />
    </div>
  );
}

function refusedNotice(title: string, description: string): ReactElement {
  return (
    <div className={ROOT_CLASS}>
      <StateNotice kind="refused" headingLevel={NOTICE_HEADING_LEVEL} title={title} description={description} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/** What this route receives: the opaque segment naming the Update whose editions are shown, unresolved. */
export interface CommunicationUpdateOverviewPageProps {
  readonly params: Promise<{ updateId: string }>;
}

/** The variant overview and status of one Update: one read, one envelope, and an honest notice in place of the matrix when the read does not answer with one. */
export default async function CommunicationUpdateOverviewPage({ params }: CommunicationUpdateOverviewPageProps): Promise<ReactElement> {
  const { updateId } = await params;
  // The segment travels to the read as the opaque identity it is: it is never parsed, split, case-folded or
  // trimmed into parts, it is compared with nothing this file can see, and it is never logged. An identity the
  // service does not hold comes back as the read's own denial rather than as a page that says "not found", so
  // nothing here reveals whether a document exists.
  const result = await reads.updates.readVariantOverview({ documentId: updateId });
  switch (result.kind) {
    case "envelope":
      // An Update's matrix is this family's surface, so a document of another family is a request this route does
      // not serve rather than one it renders under Update wording. The comparison is a routing decision on a fact
      // the read states; it derives no lifecycle and carries no authority, which stays with the read.
      if (result.envelope.data.document.family !== "update") {
        return refusedNotice(NOT_AN_UPDATE_TITLE, NOT_AN_UPDATE_DESCRIPTION);
      }
      return <OverviewSurface envelope={result.envelope} />;
    case "denied":
      // The closed reason code is the whole answer: no title, no count, no size and no hint that anything exists here.
      return deniedNotice(result.denied.reasonCode);
    case "unavailable":
      // The source did not answer, so the editions are reported as unavailable and never as an empty matrix.
      return unavailableNotice(result.unavailable.source, result.unavailable.guidance);
    case "refused":
      // This route calls the read directly, so the request it would refuse is its own: the arm is stated rather
      // than thrown, and the notice names the request rather than blaming the source.
      return refusedNotice(REFUSED_TITLE, REFUSED_DESCRIPTION);
    default:
      return assertNever(result, "Unhandled variant overview read result");
  }
}
