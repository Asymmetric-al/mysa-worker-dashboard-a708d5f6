"use client";
/**
 * Home's three sections — Attention, Information and Unfinished work — as the surface renders them.
 *
 * **What this file is.** The composition of Home's body, and the only consumer of `useHome`. It takes
 * the envelope the Server Component already read, keeps it in the scope-first cache, and renders one
 * `<section>` per section key in the order `HOME_SECTION_KEYS` states: a heading that names the
 * section and its row count, then either the rows the mapper worded or the section's own empty
 * result. It computes no reason, no sentence, no destination and no state — `homeSectionGroupsOf`
 * words the items, `SectionHeading`, `HomeItemRow` and `StateNotice` render them, and every word
 * comes from `copy.ts` rather than being restated here.
 *
 * **Why this is a client component at all.** The read is a Server Component's answer, but the shell
 * invalidates the cache on a context switch and asks the server to re-read. `useHome` is what keeps
 * the rendered sections inside that loop: the seeded envelope paints immediately, a scope-prefixed
 * invalidation reaches this surface like every other, and the refresh lands the server's new answer
 * in the same cache entry. Rendering the groups on the server instead would leave the page showing
 * one context's work after the session moved to another.
 *
 * **Every arm is honest, and the two it cannot reach are still stated.** `useHome` hands back the
 * read's closed three-arm answer. This component renders groups for `envelope`, and for anything
 * else it renders the shared notice rather than an empty Home — an unreadable Home and a quiet day
 * are different facts (AAP 0.7.1: an outage is never an empty list and never a zero). The other two
 * arms cannot change on a refresh alone: `router.refresh()` re-renders the Server Component, whose
 * own switch either answers a fresh envelope or renders the page-level refusal or outage notice in
 * place of this component, and an admitted session — the only kind that reaches this route at all —
 * is never refused a read of its own selected context. So the notice here is a guard for an arm
 * this surface has no way to reach, not a second treatment of a denial the page already owns; it
 * uses the unavailable wording because an unreadable Home is the only condition left that it could
 * be describing.
 *
 * **The count is the read's own rows.** The Home envelope states no per-section count, so the count
 * beside a heading is the number of rows rendered under it — a count of what is on this page, never
 * a total the surface inferred. `SectionHeading` already says nothing for zero, so an empty section
 * states its empty result instead of claiming "0".
 *
 * **Landmarks, headings and layout.** The page above renders the single `h1`; each section here is
 * labelled by its own `h2` (`id` shared with the list it names, so the group and its rows are
 * announced as one), and an empty result renders an `h3` under that heading. Spacing is logical, the
 * column starts at the reading edge, every class resolves to a token declared once in
 * `styles/globals.css`, and nothing scrolls horizontally, so the sections reflow to one column at
 * 320 CSS pixels.
 */
import type { ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import type { ReadEnvelope, ReadResult, Scope } from "@/modules/data-service";
import { NOTICE_COPY, SECTION_COPY } from "../copy";
import { homeSectionGroupsOf, type HomeData, type HomeSectionGroupView } from "../home-view";
import { useHome } from "../use-home";
import HomeItemRow from "./home-item-row";
import SectionHeading from "./section-heading";

/** What Home's body needs: the envelope the route already read, and the scope it was read under. */
export interface HomeSectionsProps {
  readonly initial: ReadResult<ReadEnvelope<HomeData>>;
  readonly scope: Scope;
}

/**
 * One section: its heading, the count of the rows beneath it, and then those rows or the section's
 * own empty result — the first action of which is a real route of this application.
 */
function HomeSection({ group }: { readonly group: HomeSectionGroupView }): ReactElement {
  const headingId = `home-${group.sectionKey}`;
  const copy = SECTION_COPY[group.sectionKey];
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <SectionHeading id={headingId} sectionKey={group.sectionKey} count={group.items.length} />
      {group.items.length === 0 ? (
        <StateNotice kind="empty" headingLevel={3} title={copy.emptyTitle} description={copy.emptyBody} action={{ label: copy.firstAction.label, href: copy.firstAction.href }} />
      ) : (
        <ul aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
          {group.items.map((item) => (
            <HomeItemRow key={item.id} item={item} variant={group.sectionKey} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Home's body: Attention, Information and Unfinished work, each stated in full whether it holds work
 * or holds none.
 */
export default function HomeSections(props: HomeSectionsProps): ReactElement {
  const { result } = useHome({ initial: props.initial, scope: props.scope });
  if (result.kind !== "envelope") {
    // Headed at level two, because the page's `h1` stands above this notice and nothing else in this
    // arm renders a section heading between them.
    return <StateNotice kind="unavailable" headingLevel={2} title={NOTICE_COPY.unavailable.title} description={NOTICE_COPY.unavailable.body} />;
  }
  const groups = homeSectionGroupsOf(result.envelope.data);
  return (
    <div className="flex min-w-0 flex-col gap-6 text-start">
      {groups.map((group) => (
        <HomeSection key={group.sectionKey} group={group} />
      ))}
    </div>
  );
}
