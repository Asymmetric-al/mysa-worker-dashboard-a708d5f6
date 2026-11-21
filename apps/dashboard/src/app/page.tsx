/**
 * `/` — Home, the post-admission landing route and the origin every reachability sweep starts from
 * (AAP 0.9.2, 0.12.6).
 *
 * **Why this route exists.** AAP 0.9.1 lists `apps/dashboard/src/app/page.tsx` as "Home: Attention,
 * Information, Unfinished work" and 0.6.4 makes it the answer to the first question the interface
 * asks — who needs the worker's attention. Without it the root segment holds the shell, the error
 * boundary and the icon but no route, so the production build emits no `/` and every journey that
 * starts at the origin reaches a 404 before the shell's own navigation is available.
 *
 * **One read, in process.** Per AAP 0.2.1 and 0.3.2 a Server Component must not reach the
 * application's own endpoint, so this file awaits `reads.context.readHome()` directly. Scope,
 * revision, source, coverage and the scenario instant are derived by the service from the
 * development-session cookie; nothing here passes an identifier, widens a read or takes a scope from
 * the URL.
 *
 * **What each arm of the answer means.** `readHome` answers with the closed three-arm `ReadResult`.
 * `envelope` is the day's work: the one `h1`, the lead sentence, then `features/home/components/
 * home-sections`, which states Attention, Information and Unfinished work. `denied` is a session
 * that may not read Home in the context it is acting in, and it names no item, count, title,
 * existence flag or size — a refusal is not a quiet day. `unavailable` is the source behind the read
 * failing to answer, and it renders the service's own guidance and the source identity rather than an
 * empty list or a zero (AAP 0.7.1). The switch closes with `assertNever`, so a fourth arm fails
 * compilation instead of falling through to a blank page; nothing here raises a not-found response,
 * because that would render outside the shell and drop the persistent **Development data** label.
 *
 * **Why a mapper sits between the service record and the row.** A row validates the strict
 * `homeItemViewSchema` — an identity, a sentence saying why the item is there, a badge code and a
 * destination carrying its own words — while the envelope states `itemId`, a kebab-case reason key, a
 * bare route and a label that may be absent. `features/home/home-view` reconciles the two in one pure
 * function, so this route composes a surface instead of translating members, and a row never has to
 * invent a sentence or a label.
 *
 * **Landmarks, headings and layout.** The shell above this route owns the single `main` landmark, the
 * skip link, the navigation rail, the context indicator and the **Development data** label; this file
 * renders none of them. It states exactly one `h1` — the page's title when the read answered, the
 * notice's heading when it did not — and every section below opens at level two or deeper. Spacing is
 * logical, every class resolves to a token declared once in `styles/globals.css`, and nothing here
 * scrolls horizontally, so the page reflows to one column at 320 CSS pixels.
 *
 * **Layering.** `app` composes `features/home`, which composes `lib` and the shared `components`, which
 * compose `modules/data-service`; this file holds no business logic, computes no total, reads no clock
 * and decides no permission (AAP 0.9.1, 0.15.1).
 *
 * **Freshness.** `dynamic = "force-dynamic"`: the read resolves the session, the context and the
 * scenario instant per request, so a cached render would serve one context's work to another.
 */

import type { Metadata } from "next";
import type { ReactElement } from "react";

import StateNotice from "@/components/state-notice";
import HomeSections from "@/features/home/components/home-sections";
import { HOME_COPY } from "@/features/home/copy";
import { assertNever } from "@/lib/result";
import { reads } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The read resolves the session, the context and the scenario instant per request, so nothing here may be cached. */
export const dynamic = "force-dynamic";

/** The document title: the surface, and nothing that would duplicate the root layout template's suffix. */
export const metadata: Metadata = { title: HOME_COPY.title };

/**
 * The one sentence a refusal states.
 *
 * It says that Home could not be read for this session and claims nothing about what Home would have
 * held: no count, no title, no existence flag and no size, which is the only honest answer when the
 * read that would have named them was refused (AAP 0.7.1). The reason code the service supplied is
 * rendered beside it by `StateNotice`, so the condition stays distinguishable without the words here
 * guessing at it.
 */
const HOME_DENIED_DESCRIPTION =
  "Home could not be read for this session, so no item, count or reason is stated here — a refusal is not a quiet day. " +
  "If this session admits another context, the shell is where that context is chosen.";

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/**
 * The Home screen: the worker's day in three sections, or the reason it could not be read.
 */
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
      // No item, no count, no empty list: the answer is the same whether or not work exists in the
      // context this session may not read.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="denied" headingLevel={1} title={HOME_COPY.title} description={HOME_DENIED_DESCRIPTION} reasonCode={result.denied.reasonCode} />
        </div>
      );
    case "unavailable":
      // The service's own retry guidance and the source that did not answer, never an empty Home and
      // never a zero.
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <StateNotice kind="unavailable" headingLevel={1} title={HOME_COPY.title} description={result.unavailable.guidance} source={result.unavailable.source} />
        </div>
      );
    default:
      return assertNever(result, "Unhandled Home read result");
  }
}
