/**
 * The address of a withdrawn edition: one fixed sentence in a neutral frame, and nothing besides it.
 *
 * A release can be withdrawn while the address it was published at keeps answering, so that answer
 * has to say the edition is gone without saying anything about what stood there (AAP 0.8.6 reach
 * rule; the tombstone carried by the withdrawal record in AAP 0.6.2). This component is that answer.
 * It renders one constant sentence and holds nothing else, and it accepts no value that could carry
 * anything else: no title, excerpt, image, video, poster, media reference, author, contributor,
 * audience, locale, withdrawal instant, withdrawal reason, status word, edition identifier or
 * language tag can reach the output, because the only thing a caller may pass is a class list. The
 * sentence itself comes from `TOMBSTONE_COPY` in `features/audience/copy/receiving` — the same words
 * the reach module fixes for a withdrawal's answer — so an address and a reading view cannot tell two
 * stories about one withdrawal, and a second copy of the sentence cannot drift from the first.
 *
 * It offers no way onward. There is nothing here to retry and nothing legitimate to open: a route to
 * the draft, the editor, the review step, the administration surface or the discovery index would be
 * exactly the disclosure this surface exists to prevent, so it contains no hyperlink, no activation
 * control and no form, and it asks the reader for nothing.
 *
 * It is not the shared notice component. Empty, unavailable, unknown, denied, partial-coverage and
 * *Language unavailable* are that component's six states, each with a heading, an explanation and
 * often a way to recover; a withdrawn edition is a different fact — a deliberate, permanent wall — so
 * none of those states is reused here, no icon is added to imply a cause, and no status chip appears,
 * because a chip's single word would hint at when the withdrawal happened or at who ended the
 * release. The card frame supplies neutral surface, boundary and padding and asserts nothing more.
 *
 * It claims no effect. Withdrawal ends access from now on and recalls no copy already received, saved
 * or shared; the sentence asserts neither, and the disclosure that labels a simulated effect belongs
 * to the surface composing this one, which already carries it, so adding one here would state the same
 * disclaimer twice.
 *
 * It is a pure function of its props: no client directive, no hook, no state, no effect, no network
 * read, no clock read and no framework-specific import, so the same call renders identically inside a
 * Server Component and inside a client parent, and the output is byte-stable for every withdrawal.
 * Direction is inherited from the block around it, because a writing direction belongs to the document
 * rather than to this component: the same sentence reads correctly inside a right-to-left edition with
 * no direction attribute and no CSS base direction set here, and nothing needs isolating or reordering
 * because the surface holds no mixed-direction value.
 *
 * Accessibility: the sentence is the only content, it is real text in the reading region, and it is
 * announced in reading order — no live region, no alert role, no heading and no meaning carried by
 * colour alone.
 *
 * Scope: AAP 0.10.1 families 10 and 11, the 0.8.6 reach rule, and success criterion 12.
 */

import type { ReactElement } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { TOMBSTONE_COPY } from "@/features/audience/copy/receiving";
import { cn } from "@/lib/cn";

/**
 * How the tombstone fits into the layout of the surface that renders it.
 *
 * The single optional prop adjusts spacing where a caller needs to, and is merged through `cn` so the
 * caller's utility wins over the frame's own. The prop set is deliberately not the frame element's
 * attribute set: an identifier, a data attribute or an accessible-name override could each carry a
 * title, a language tag or a date, which is the one thing this surface must never be able to say.
 */
export interface EditionTombstoneProps {
  /** Layout classes for the frame, merged with the component's own. */
  readonly className?: string;
}

/**
 * What a withdrawn edition's address answers with: the one fixed sentence, no identifier and no way
 * onward.
 */
export function EditionTombstone({ className }: EditionTombstoneProps): ReactElement {
  return (
    <Card data-slot="edition-tombstone" className={cn("min-w-0", className)}>
      <CardContent>
        <p>{TOMBSTONE_COPY}</p>
      </CardContent>
    </Card>
  );
}

export default EditionTombstone;
