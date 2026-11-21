/**
 * The one draft-versus-release comparison for a Ministry Update edition: the working revision and the
 * edition's last release, side by side, with the differences the read reported.
 *
 * Plan items that put this file in scope:
 * - AAP 0.10.1 family 9 lists "compare with the last release" among the retained Ministry Updates
 *   capabilities, and AAP 0.9.1 places it in `features/updates/` beside the one editor.
 * - AAP 0.8.5 keeps one canonical content identity with draft, candidate and release distinct, so
 *   this surface is what makes "a later draft edit leaves the release unchanged" visible: the two
 *   revisions and their checksums are shown separately, and the release head is never re-read as
 *   though a draft save had moved it.
 * - AAP 0.7.1: publication, notification, acceptance, delivery and reading are separate outcomes, so
 *   a comparison states what the next release *would* contain and claims no release and no send.
 *
 * What this file does and refuses to do:
 *
 * - It arranges; it does not render. The HTML on each side is produced on the server by
 *   `modules/content/render.ts` inside the content reads and arrives on the read envelope with the
 *   revision it belongs to. That string is inserted once per side at
 *   {@link ComparisonPane} and nowhere else: no renderer is imported, no Tiptap JSON is turned into
 *   markup here, and the string is never sanitised, rewritten or annotated. `render.ts` emits no
 *   class, style, id or script, so there is nothing here to neutralise.
 * - It reports differences; it does not find them. A section or placement that changed is named from
 *   the change list the envelope supplies, by its catalogue element and heading path or by its
 *   placement identity and rendition purpose. Nothing diffs two HTML strings, and when the read
 *   supplies no list the surface says exactly that instead of inventing a difference.
 * - It displays identity and time; it computes neither. The revision identity, the checksum and the
 *   author are the revision's own members, and the instant is the envelope's `asOf`. No clock is
 *   read, no digest is computed, nothing is formatted from a `Temporal` value and no lifecycle word
 *   is chosen: `components/draft-status.tsx` derives and renders that, through
 *   {@link lifecycleOf}, from the variant and release it is handed.
 *
 * The four absences, each its own truth and none of them "no changes":
 *
 * 1. The draft has no acknowledged revision yet — nothing is saved and acknowledged, so there is no
 *    working side to compare. A save whose acknowledgement never arrived leaves nothing acknowledged.
 * 2. There is no prior release — nothing has been published for this audience and language, so there
 *    is no released revision to compare against. This is an absence of a release, never an empty
 *    diff and never the word "identical".
 * 3. The released revision is withheld — the read was refused, so the notice is the surface's
 *    refusal and carries no title, checksum, size or existence hint. `StateNotice`'s `denied`
 *    wording is identical whether or not a record exists, which is what keeps the refusal from
 *    becoming the disclosure.
 * 4. The source is unavailable — the read failed, so the source identity and a retry are reported
 *    and no revision is shown. An outage is never rendered as a revision with no content.
 *
 * Direction is content. Both panes carry `dir` from the variant's own content locale, so a
 * right-to-left edition reads right-to-left in the comparison exactly as it does in the editor, and
 * every caller- or envelope-supplied value of unknown direction — a revision id, a checksum, an
 * author, a heading path, a locale tag — is isolated in `<bdi>` so a Latin string inside an Arabic
 * pane cannot reorder the words around it. No bidi control character is written, no physical
 * left/right utility is used and nothing is mirrored.
 *
 * Layout is one composition at each width: a tab pair below the medium breakpoint, where two columns
 * cannot fit, and a genuine side-by-side grid above it. Both are built from the same pane, and each
 * composition mints its own heading ids, because the tab primitive renders one panel at a time and
 * marks the other inert — a single composition cannot honestly be both. Only a pane's own labelled
 * {@link ScrollRegion} may scroll sideways, so the page itself never does, and `scroll-padding` keeps
 * a focused element out from under the sticky shell (WCAG 2.2 2.4.11).
 *
 * Rule 1: the comparison job only, with no scheduler, provider, version-history store or other
 * deferred-owner surface; the shared surfaces are composed rather than duplicated — `StateNotice`,
 * `ScrollRegion`, `DraftStatus`, `StatusBadge`, the design system's `Tabs`, `Card` and `Alert`, and
 * the Updates copy module all keep their single owner; and the three truths above stay three, because
 * a released revision is never implied to have changed by a draft edit.
 */

import { useId, type ReactElement, type ReactNode } from "react";

import { DraftStatus, lifecycleOf } from "@/components/draft-status";
import { ScrollRegion } from "@/components/scroll-region";
import { StateNotice, type NoticeHeadingLevel, type NoticeRetry } from "@/components/state-notice";
import StatusBadge, { valueStateWord } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import {
  isReleaseUnchanged,
  type ContentRevision,
  type ContentVariant,
  type Release,
} from "@/modules/content/variant";
import type { ValueState } from "@/modules/data-service/envelope";

import { AUDIENCE_LABELS, DRAFT_VS_RELEASED, LOCALE_DISPLAY_NAMES } from "../copy/updates-copy";

// ---------------------------------------------------------------------------------------------
// The two sides, as the read envelopes supply them
// ---------------------------------------------------------------------------------------------

/**
 * One revision as its read envelope carries it: the record itself, the HTML the server rendered from
 * it, the envelope's `asOf` and the author's display name.
 *
 * `renderedHtml` is `renderToHtml`'s `html` member, already produced on the server and carried on the
 * read envelope. It is a string this file inserts and never inspects, so a side that could not be
 * rendered is reported as unavailable by the caller rather than shown as a revision with no content.
 */
export interface ComparisonRevisionSide {
  /** The exact revision, with the identity, checksum and author this surface displays. */
  readonly revision: ContentRevision;
  /** The server-rendered HTML of that revision, exactly as the envelope carried it. */
  readonly renderedHtml: string;
  /** The scenario instant the read evaluated at, taken from the envelope and never from a clock. */
  readonly asOf: string;
  /** The author's display name, resolved by the caller from the principal the revision records. */
  readonly author: string;
}

/**
 * One side of the comparison: a revision the caller may read, or one of the three absences that are
 * not a revision at all.
 *
 * The four members are four different facts, so no two share a rendering. In particular a refused
 * read (`withheld`) carries nothing about the revision it refused: a title, a checksum or a size
 * would each confirm that something exists.
 */
export type ComparisonSide<TRevision> =
  | ({ readonly status: "revision" } & ComparisonRevisionSide & TRevision)
  | { readonly status: "none" }
  | { readonly status: "withheld" }
  | {
      readonly status: "unavailable";
      /** The source that could not be read, as an opaque `{ system, reference }` pair. */
      readonly source?: SourceReference;
      /** Re-requests the same read. A retry reads; it never repeats a change. */
      readonly onRetry?: () => void | Promise<void>;
    };

/** The working side: the revision the editor is on, with nothing else attached. */
export type ComparisonDraftSide = ComparisonSide<Record<never, never>>;

/** The released side: the same facts plus the release record that publishes that revision. */
export type ComparisonReleaseSide = ComparisonSide<{ readonly release: Release }>;

// ---------------------------------------------------------------------------------------------
// The change list, as the read envelope describes it
// ---------------------------------------------------------------------------------------------

/** The two kinds of change the envelope can report, and the only two this surface names. */
export const COMPARISON_CHANGE_KINDS = ["section", "media"] as const;

/** One kind of reported change, derived from {@link COMPARISON_CHANGE_KINDS}. */
export type ComparisonChangeKind = (typeof COMPARISON_CHANGE_KINDS)[number];

/**
 * A composed section the draft changed, named the way the catalogue names it.
 *
 * `element` is the admitted catalogue element and `headingPath` the heading path the read reported
 * for it, so a reader can find the section in the editor without a paraphrase of its text.
 */
export interface ComparisonSectionChange {
  readonly kind: "section";
  /** The admitted catalogue element, for example `story` or `milestone`. */
  readonly element: string;
  /** The heading path the envelope reported, outermost first; empty when the section states none. */
  readonly headingPath: readonly string[];
  /** The envelope's state for the changed value, when it is not a plain `value`. */
  readonly state?: ValueState;
}

/**
 * A media placement the draft changed, named by the placement's identity and the rendition purpose
 * the envelope reported for it. No byte, filename, MIME type or playback is claimed here: playback
 * belongs to the preview and the player.
 */
export interface ComparisonMediaChange {
  readonly kind: "media";
  /** The identity the revision gives the placement. */
  readonly placementId: string;
  /** The rendition purpose the envelope named: `display`, `playback`, `poster` or `captions`. */
  readonly renditionPurpose: string;
  /** The envelope's state for the changed value, when it is not a plain `value`. */
  readonly state?: ValueState;
}

/** One reported change: a section, or a media placement. */
export type ComparisonChange = ComparisonSectionChange | ComparisonMediaChange;

// ---------------------------------------------------------------------------------------------
// The wording this surface owns
// ---------------------------------------------------------------------------------------------

/**
 * The heading of the whole comparison.
 *
 * The wording that explains what a comparison means comes from the Updates copy module; these are
 * the labels and notices of this one surface, which no copy module words, and each exists so that a
 * state is never carried by a colour or by the shape of a panel.
 */
const COMPARISON_HEADING = "Compare with the last release";

/** The title of the standing explanation of what the two sides are, and are not. */
const COMPARISON_MEANING_TITLE = "What this comparison shows";

/** The heading of the change list, which sits between the explanation and the two revisions. */
const CHANGES_HEADING = "What the read reported as changed";

/** The pane titles. They name the two sides of a comparison, not a lifecycle state. */
const DRAFT_PANE_TITLE = "Working draft";
const RELEASE_PANE_TITLE = "Last release";

/** The current tab, in the composition used below the side-by-side breakpoint. */
const TAB_LIST_LABEL = "Choose which revision to read";

/** The label of the control that re-requests a read that could not be completed. */
const RETRY_LABEL = "Try this read again";

/** The four metadata rows every readable side states, in this order. */
const METADATA_LABELS = {
  revision: "Revision",
  checksum: "Checksum",
  author: "Author",
  asOf: "Read at",
} as const;

/**
 * What an unreadable side is reported as, per absence.
 *
 * None of the four is the sentence "there are no changes": the two `none` members say which thing
 * does not exist yet, `withheld` states a refusal without a fact about the record, and `unavailable`
 * states an outage. The two `none` members differ because "nothing has been acknowledged" and
 * "nothing has been released" are different absences on the two sides of this comparison.
 */
const ABSENCE_COPY = {
  draftNone: {
    title: "No acknowledged revision yet",
    description:
      "Nothing has been saved and acknowledged for this edition, so there is no working revision to " +
      "compare with the last release. A save whose acknowledgement never arrived leaves nothing " +
      "acknowledged here.",
  },
  releaseNone: {
    title: "No prior release",
    description:
      "Nothing has been published for this audience and language yet, so there is no released " +
      "revision to compare the draft with. This is an absence of a release, not a draft with no " +
      "changes.",
  },
  withheld: {
    title: "This comparison cannot show the released revision",
    description:
      "The comparison shows the working draft on its own and states no fact about the released " +
      "revision — not its title, its checksum, its size or its content.",
  },
  unavailable: {
    title: "The content source could not be read",
    description:
      "The other side is shown as it was read, so the comparison stays usable while this side is " +
      "unreadable, and nothing on this pane stands in for what the source holds.",
  },
} as const;

/**
 * What the change list states when the read supplied no list.
 *
 * The alternative would be diffing the two rendered strings, which would present a text difference
 * as a content difference and could only ever disagree with the read that owns the answer.
 */
const NO_CHANGE_LIST_NOTE =
  "This comparison shows the two revisions, their checksums and their authors. The read supplied no " +
  "change list, so no difference is claimed here.";

/** What the change list states when the read reported no changed section or placement. */
const NO_CHANGES_NOTE = "No changes were reported between these revisions.";

/** What the change list states when the two checksums are identical, so nothing was re-authored. */
const SAME_CHECKSUM_NOTE =
  "The two checksums are identical, so the last release publishes exactly the revision shown as the " +
  "working draft.";

/**
 * What this surface says when the released revision is not the working one.
 *
 * It is the sentence criterion 9 turns on: editing a draft moves nothing a reader can open, and only
 * a release changes what an audience is served.
 */
const RELEASE_UNCHANGED_BY_DRAFT_NOTE =
  "The last release still publishes the revision shown beside it. A draft edit changes nothing a " +
  "reader can open until a new release is published.";

/** The kind word that opens each change-list item, so an item's kind is text and never a shape. */
const CHANGE_KIND_WORDS: Readonly<Record<ComparisonChangeKind, string>> = {
  section: "Section",
  media: "Media placement",
};

/** The visually hidden lead-in that keeps an orphaned state word from being ambiguous. */
const VALUE_STATE_PREFIX = "Value state";

/** The heading element for each level the caller may ask for. */
const HEADING_TAG: Readonly<Record<NoticeHeadingLevel, "h1" | "h2" | "h3" | "h4">> = {
  1: "h1",
  2: "h2",
  3: "h3",
  4: "h4",
};

/**
 * The heading level of a pane, a change list or a notice inside the comparison: one deeper than the
 * comparison's own heading, and never below the deepest level a page may use, because a level above
 * `h4` would skip a step in the outline.
 */
const NESTED_HEADING_LEVEL: Readonly<Record<NoticeHeadingLevel, 2 | 3 | 4>> = {
  1: 2,
  2: 3,
  3: 4,
  4: 4,
};

// ---------------------------------------------------------------------------------------------
// Reading one change, without diffing anything
// ---------------------------------------------------------------------------------------------

/**
 * The direction the edition is authored and read in, read off the variant's own content locale.
 *
 * It is taken as a projection of the record rather than restated as a union here, so the content
 * profile stays the only owner of the direction vocabulary and a locale that adds a direction fails
 * to compile where it is used.
 */
type ContentTextDirection = ContentVariant["locale"]["direction"];

/** One heading element at the level the surrounding outline needs. */
function Heading({
  level,
  id,
  className,
  children,
}: {
  readonly level: NoticeHeadingLevel;
  readonly id: string;
  readonly className: string;
  readonly children: ReactNode;
}): ReactElement {
  const Tag = HEADING_TAG[level];
  return (
    <Tag id={id} className={className}>
      {children}
    </Tag>
  );
}

/**
 * The word for a changed value's state, or `undefined` when the value is an ordinary one.
 *
 * The five words belong to `components/status-badge.tsx`, which is why this asks rather than writes
 * them: a state added to the envelope without a word is then a compile error in one place instead of
 * five hand-written copies that drift. A state other than `value` therefore always shows its word
 * beside the change, never a blank where a number or a text field would be.
 */
function changeStateWord(state: ValueState | undefined): string | undefined {
  return state === undefined ? undefined : valueStateWord(state)?.label;
}

/** The opaque identity a change is named by: the catalogue element, or the placement identity. */
function changeIdentifier(change: ComparisonChange): string {
  return change.kind === "section" ? change.element : change.placementId;
}

/** The heading path the read reported for a changed section, joined for display; empty when none. */
function headingPathText(change: ComparisonSectionChange): string {
  return change.headingPath
    .map((step) => step.trim())
    .filter((step) => step.length > 0)
    .join(" › ");
}

/**
 * The qualifying detail of one change: the heading path of a section, or the rendition purpose of a
 * placement. Both are the read's own values, rendered isolated, so a mixed-direction heading reads in
 * the right order inside either pane.
 */
function changeDetail(change: ComparisonChange): ReactNode {
  if (change.kind === "section") {
    const path = headingPathText(change);
    return path.length === 0 ? null : (
      <>
        {"under "}
        <bdi className="wrap-anywhere">{path}</bdi>
      </>
    );
  }
  return (
    <>
      <bdi>{change.renditionPurpose}</bdi>
      {" rendition"}
    </>
  );
}

/** One reported change as a list item: its kind, its identity, its detail and its value state. */
function ChangeItem({ change }: { readonly change: ComparisonChange }): ReactElement {
  const word = changeStateWord(change.state);
  const detail = changeDetail(change);

  return (
    <li
      data-comparison-change={change.kind}
      className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"
    >
      <span className="font-medium">{CHANGE_KIND_WORDS[change.kind]}</span>
      <bdi className="mono-identifier wrap-anywhere">{changeIdentifier(change)}</bdi>
      {detail === null ? null : <span className="text-muted-foreground">{detail}</span>}
      {word === undefined ? null : (
        <span className="text-muted-foreground">
          <span className="sr-only">{`${VALUE_STATE_PREFIX}: `}</span>
          <bdi>{word}</bdi>
        </span>
      )}
    </li>
  );
}

/** Props of {@link ChangeList}. */
interface ChangeListProps {
  /** The change list the read supplied, or `undefined` when it supplied none at all. */
  readonly changes: readonly ComparisonChange[] | undefined;
  /** Whether the two checksums are equal, which is what the closing sentence reports. */
  readonly unchanged: boolean;
  /** The heading level that fits this surface's outline. */
  readonly headingLevel: NoticeHeadingLevel;
  /** The identity of this section's heading, which names the region. */
  readonly headingId: string;
}

/**
 * The reported differences, and the one sentence that keeps the release and the draft apart.
 *
 * Three readings are three different statements: a list the read supplied, an empty list the read
 * supplied, and no list at all. The third becomes "no difference is claimed" rather than an empty
 * list, because an empty list would assert that the two revisions match when the read never said so.
 * The closing sentence reports what the comparison does not change: either the release publishes this
 * exact revision, or the release still publishes its own and a draft edit moves nothing a reader can
 * open.
 */
function ChangeList({
  changes,
  unchanged,
  headingLevel,
  headingId,
}: ChangeListProps): ReactElement {
  const body =
    changes === undefined ? (
      <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">{NO_CHANGE_LIST_NOTE}</p>
    ) : changes.length === 0 ? (
      <p className="text-sm text-pretty wrap-anywhere">{NO_CHANGES_NOTE}</p>
    ) : (
      <ul className="flex min-w-0 list-none flex-col gap-1 p-0">
        {changes.map((change, index) => (
          <ChangeItem key={`${change.kind}:${changeIdentifier(change)}:${index}`} change={change} />
        ))}
      </ul>
    );

  return (
    <section
      data-slot="comparison-changes"
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-2"
    >
      <Heading level={headingLevel} id={headingId} className="text-sm font-medium">
        {CHANGES_HEADING}
      </Heading>
      {body}
      <p className="text-sm text-muted-foreground text-pretty wrap-anywhere">
        {unchanged ? SAME_CHECKSUM_NOTE : RELEASE_UNCHANGED_BY_DRAFT_NOTE}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// One side: a revision, or one of the three absences
// ---------------------------------------------------------------------------------------------

/** Props of {@link SideNotice}. */
interface SideNoticeProps {
  /** Which side this notice stands in for, because the two `none` members differ in wording. */
  readonly side: "draft" | "release";
  /** The absence to report. A readable revision is not a notice and never reaches here. */
  readonly reading: Exclude<ComparisonDraftSide, { readonly status: "revision" }>;
  /** The heading level that fits this surface's outline. */
  readonly headingLevel: NoticeHeadingLevel;
}

/**
 * The honest rendering of a side that is not a revision.
 *
 * Each absence reaches the one shared notice surface with its own kind, so a refusal, an outage and
 * two different "nothing exists yet" facts cannot collapse into one blank panel: `empty` is a genuine
 * absence, `denied` is a refusal whose wording discloses nothing, and `unavailable` names the source
 * and offers a retry. None of them is an empty diff, an empty list or a zero.
 */
function SideNotice({ side, reading, headingLevel }: SideNoticeProps): ReactElement {
  if (reading.status === "none") {
    const copy = side === "draft" ? ABSENCE_COPY.draftNone : ABSENCE_COPY.releaseNone;
    return (
      <StateNotice
        kind="empty"
        title={copy.title}
        description={copy.description}
        headingLevel={headingLevel}
        className="min-w-0"
      />
    );
  }

  if (reading.status === "withheld") {
    return (
      <StateNotice
        kind="denied"
        title={ABSENCE_COPY.withheld.title}
        description={ABSENCE_COPY.withheld.description}
        headingLevel={headingLevel}
        className="min-w-0"
      />
    );
  }

  const retry: NoticeRetry | undefined =
    reading.onRetry === undefined
      ? undefined
      : { label: RETRY_LABEL, onClick: reading.onRetry };

  return (
    <StateNotice
      kind="unavailable"
      title={ABSENCE_COPY.unavailable.title}
      description={ABSENCE_COPY.unavailable.description}
      source={reading.source}
      retry={retry}
      headingLevel={headingLevel}
      className="min-w-0"
    />
  );
}

/** Props of {@link ComparisonPane}. */
interface ComparisonPaneProps {
  /** Which side this pane is, so the absence wording and the data attribute name it. */
  readonly side: "draft" | "release";
  /** The pane title: the side of the comparison, not a lifecycle state. */
  readonly title: string;
  /** The identity of this pane's heading, which names the section and the scroll region. */
  readonly headingId: string;
  /** The heading level that fits this surface's outline. */
  readonly headingLevel: NoticeHeadingLevel;
  /** The direction the edition is authored and read in, taken from its content locale. */
  readonly direction: ContentTextDirection;
  /** The accessible name of this pane's scroll region. */
  readonly scrollLabel: string;
  /**
   * What this side is showing. A released side, which additionally carries its release record, is
   * this shape too: the release record is not something a pane displays.
   */
  readonly reading: ComparisonDraftSide;
}

/**
 * One side of the comparison.
 *
 * A readable side is a `Card` named by its own heading, carrying the four facts that identify the
 * revision — identity, checksum, author and the envelope's read instant — above the server-rendered
 * content of that revision. Everything the revision states is displayed as the read supplied it: this
 * pane computes no digest, formats no instant and decides no state.
 *
 * The rendered HTML is inserted at exactly one place in this file, inside a `div` that carries no
 * markup of its own beyond layout classes on the wrapper. The string is `renderToHtml`'s `html`
 * member as the read envelope carried it; this component neither builds nor rewrites it, and the
 * renderer emits no class, style, id, script or event handler that could act on the page.
 *
 * An unreadable side is the shared notice instead of an empty card, because a card with a heading and
 * no content would read as a revision that holds nothing.
 */
function ComparisonPane({
  side,
  title,
  headingId,
  headingLevel,
  direction,
  scrollLabel,
  reading,
}: ComparisonPaneProps): ReactElement {
  if (reading.status !== "revision") {
    return <SideNotice side={side} reading={reading} headingLevel={headingLevel} />;
  }

  return (
    <Card
      data-comparison-pane={side}
      aria-labelledby={headingId}
      dir={direction}
      className="min-w-0"
    >
      <CardHeader>
        <CardTitle>
          <Heading level={headingLevel} id={headingId} className="text-base font-medium text-pretty">
            {title}
          </Heading>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">{METADATA_LABELS.revision}</dt>
          <dd className="min-w-0 wrap-anywhere">
            <bdi className="mono-identifier">{reading.revision.revisionId}</bdi>
          </dd>
          <dt className="text-muted-foreground">{METADATA_LABELS.checksum}</dt>
          <dd className="min-w-0 wrap-anywhere">
            <bdi className="mono-identifier">{reading.revision.contentChecksum}</bdi>
          </dd>
          <dt className="text-muted-foreground">{METADATA_LABELS.author}</dt>
          <dd className="min-w-0 wrap-anywhere">
            <bdi>{reading.author}</bdi>
          </dd>
          <dt className="text-muted-foreground">{METADATA_LABELS.asOf}</dt>
          <dd className="min-w-0 wrap-anywhere">
            <bdi>{reading.asOf}</bdi>
          </dd>
        </dl>
        <ScrollRegion label={scrollLabel} className="rounded-lg">
          {/*
            The only insertion point in this component: the server-rendered HTML of this revision, as
            the read envelope's rendered `html` member for it. Inserted verbatim and never inspected,
            rewritten or sanitised here, because `modules/content/render.ts` is the one renderer and
            this file is not a second one.
          */}
          <div
            data-slot="comparison-content"
            className="flex min-w-0 flex-col gap-3 text-sm text-pretty wrap-anywhere [&_img]:h-auto [&_img]:max-w-full [&_video]:max-w-full"
            dangerouslySetInnerHTML={{ __html: reading.renderedHtml }}
          />
        </ScrollRegion>
      </CardContent>
    </Card>
  );
}


// ---------------------------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------------------------

/** Props of {@link CompareWithRelease}. */
export interface CompareWithReleaseProps {
  /**
   * The variant both sides belong to: its content locale supplies the direction the panes read in,
   * its locale tag names the edition, its audience says who the release is for, and its release head
   * is what `lifecycleOf` reads to state the edition's own lifecycle word.
   */
  readonly variant: ContentVariant;

  /**
   * The working side, as the draft read envelope supplied it: the revision the editor is on, or the
   * absence that says why there is none.
   */
  readonly draft: ComparisonDraftSide;

  /**
   * The released side, as the release read envelope supplied it: the edition's last release and the
   * revision it publishes, or the absence that says why there is none.
   */
  readonly release: ComparisonReleaseSide;

  /**
   * The changed sections and placements the read reported, or `undefined` when it reported no list at
   * all. The three readings — a list, an empty list and no list — are three different statements, so
   * the caller passes what it received rather than defaulting the member to an empty array.
   */
  readonly changes?: readonly ComparisonChange[];

  /** The heading level that fits the page this comparison is mounted in. Defaults to 2. */
  readonly headingLevel?: NoticeHeadingLevel;

  /** Layout classes for the block this comparison occupies. Never a colour, radius or shadow. */
  readonly className?: string;
}

/**
 * The draft-versus-release comparison for one Update variant.
 *
 * Reads the two sides it is handed and nothing else: it holds no state, subscribes to nothing, wraps
 * no data source and mints no mutation, so the same tree renders on the server and in the browser.
 * The lifecycle word comes from `components/draft-status.tsx`, the absence renderings from
 * `components/state-notice.tsx`, the sideways scrolling from `components/scroll-region.tsx`, the
 * state words from `components/status-badge.tsx` and the explanatory sentences from the Updates copy
 * module, each keeping its single owner.
 *
 * Below the medium breakpoint the two revisions are a tab pair, because two columns cannot fit 320
 * CSS px without making the page scroll sideways; above it they are a genuine side-by-side grid. Each
 * composition mints its own heading ids, because the tab primitive renders one panel at a time and
 * marks the other inert, so the same markup cannot honestly serve both widths and no id is duplicated
 * in the document.
 */
export function CompareWithRelease({
  variant,
  draft,
  release,
  changes,
  headingLevel = 2,
  className,
}: CompareWithReleaseProps): ReactElement {
  // Identities for the headings this surface owns, so every labelled region and every pane has a
  // name of its own and the two compositions never collide on one.
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const changesId = `${baseId}-changes`;

  const nestedLevel = NESTED_HEADING_LEVEL[headingLevel];
  const direction = variant.locale.direction;
  const audienceLabel = AUDIENCE_LABELS[variant.audience].label;
  const localeName = LOCALE_DISPLAY_NAMES[variant.locale.tag] ?? variant.locale.tag;

  // The edition's own lifecycle, derived from the variant and its released head. A refused or
  // unreadable release side contributes no release, so the word comes from the variant alone rather
  // than from a record this surface could not read.
  const lifecycle = lifecycleOf(variant, release.status === "revision" ? release.release : undefined);

  // Whether the last release still publishes exactly the working revision. Asked of the variant
  // module, which owns that comparison, and only when both sides are readable: with a side missing
  // there is no pair to compare and no claim to make.
  let releaseStillCurrent: boolean | undefined;
  if (draft.status === "revision" && release.status === "revision") {
    releaseStillCurrent = isReleaseUnchanged(release.release, draft.revision);
  }

  const draftPane = (composition: "narrow" | "wide"): ReactElement => (
    <ComparisonPane
      side="draft"
      title={DRAFT_PANE_TITLE}
      headingId={`${baseId}-draft-${composition}`}
      headingLevel={nestedLevel}
      direction={direction}
      scrollLabel={`${DRAFT_PANE_TITLE} content, scrollable`}
      reading={draft}
    />
  );

  const releasePane = (composition: "narrow" | "wide"): ReactElement => (
    <ComparisonPane
      side="release"
      title={RELEASE_PANE_TITLE}
      headingId={`${baseId}-release-${composition}`}
      headingLevel={nestedLevel}
      direction={direction}
      scrollLabel={`${RELEASE_PANE_TITLE} content, scrollable`}
      reading={release}
    />
  );

  return (
    <section
      data-slot="compare-with-release"
      aria-labelledby={titleId}
      className={cn("flex min-w-0 flex-col gap-4", className)}
    >
      <header className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Heading level={headingLevel} id={titleId} className="text-base font-medium text-pretty">
            {COMPARISON_HEADING}
          </Heading>
          <StatusBadge label={audienceLabel} srPrefix="Audience" />
          <span className="text-sm text-muted-foreground">
            <bdi>{localeName}</bdi>
          </span>
        </div>
        <DraftStatus state={lifecycle} />
        {/*
          A static explanation, not an alarm: the two sentences state what a comparison can and cannot
          tell a worker, so the pass leaves the announcing region to the notices that report a change
          of condition.
        */}
        <Alert role={undefined}>
          <AlertTitle>{COMPARISON_MEANING_TITLE}</AlertTitle>
          <AlertDescription>
            <p>{DRAFT_VS_RELEASED.draftIsNotWhatReadersSee}</p>
            <p>{DRAFT_VS_RELEASED.releaseIsWhatRecipientsReceive}</p>
          </AlertDescription>
        </Alert>
      </header>

      {releaseStillCurrent === undefined ? null : (
        <ChangeList
          changes={changes}
          unchanged={releaseStillCurrent}
          headingLevel={nestedLevel}
          headingId={changesId}
        />
      )}

      <div className="md:hidden">
        <Tabs defaultValue="draft" className="gap-3">
          <TabsList aria-label={TAB_LIST_LABEL}>
            <TabsTrigger value="draft">{DRAFT_PANE_TITLE}</TabsTrigger>
            <TabsTrigger value="release">{RELEASE_PANE_TITLE}</TabsTrigger>
          </TabsList>
          {/*
            Each panel is named here as well as by its tab: the tab primitive links a panel to its
            tab in the browser, and this label keeps the panel identifiable before that link exists,
            so a reader is never placed in an unnamed region.
          */}
          <TabsContent value="draft" aria-label={DRAFT_PANE_TITLE}>
            {draftPane("narrow")}
          </TabsContent>
          <TabsContent value="release" aria-label={RELEASE_PANE_TITLE}>
            {releasePane("narrow")}
          </TabsContent>
        </Tabs>
      </div>

      <div className="hidden min-w-0 gap-4 md:grid md:grid-cols-2 md:items-start">
        {draftPane("wide")}
        {releasePane("wide")}
      </div>
    </section>
  );
}

export default CompareWithRelease;

