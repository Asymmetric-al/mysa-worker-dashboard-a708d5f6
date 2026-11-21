/**
 * The application's single rendering boundary for the content module's rendered HTML: the one place
 * where the string `modules/content/render.ts` produces becomes DOM.
 *
 * Every reading surface — the notice a recipient receives, the inbox message reader, the
 * draft-versus-release comparison and the exact Page preview — receives that HTML as one
 * already-rendered string from a read envelope and inserts it here, so the trust decision behind raw
 * markup is taken once and stated once instead of being restated at four independent call sites that
 * could drift apart (AAP 0.3.4: every shared concern has exactly one implementation).
 *
 * Where the guarantee comes from, and where it does not. The markup is trusted because exactly one
 * renderer produced it: `modules/content/render.ts` escapes every text value (`escapeHtml`), isolates
 * every value of unknown direction (`isolateValue`), and renders only the nodes and marks the content
 * profile admits — so no `class`, `style`, `id`, `on*` handler, script, embed, frame or arbitrary
 * attribute can be produced from stored content, and a link's `href` has already passed the profile's
 * allowlist in `modules/content/document.ts`, which refuses a protocol-relative address and every
 * scheme other than a single-slash path or an http(s) URL with a host. This component therefore does
 * not parse, sanitise, re-escape or inspect the string. A second parser or sanitiser here would be a
 * second answer to "what does this content say", which the release forbids (Rule 1 clause 2; AAP
 * 0.3.4), and it would quietly rewrite markup the server had already produced — turning the one
 * renderer's output into something no other surface shows.
 *
 * Why the rendered HTML is not framed in a sandboxed `<iframe srcdoc>`, the pattern
 * `components/review-panel.tsx` uses for a candidate no reviewer has approved. A frame paints its
 * document with the browser's own default stylesheet, and this renderer deliberately emits no class,
 * style or id, so every surface here styles the semantic markup through its own token descendant
 * utilities — the classes a caller passes below — placed on this wrapper. A frame would therefore
 * render the content in the browser's defaults, losing the design tokens the whole application is
 * constrained to (AAP 0.4.3), the exact fidelity the Page preview owes its pinned release (AAP
 * 0.8.6), and the natural-height presentation a notice body is recorded in. The review panel's frame
 * answers a different question — showing a not-yet-approved revision that must not be able to act on
 * the reviewer's page — and it remains the one owner of that answer.
 *
 * What this component adds is only the block's own attributes: its writing direction (`dir`, because
 * direction is content and never a CSS base direction), the language its text is written in, the
 * caller's `data-slot` hook, and the caller's token utilities. It adds no colour, size or spacing
 * class of its own, holds no state, reads no clock, fetches nothing and carries no `use client`
 * boundary, so it renders identically inside a Server Component and inside a client parent.
 *
 * Scope: AAP 0.3.4 (one implementation per shared concern), 0.4.3 (tokens and logical direction),
 * 0.8.6 (an exact, inert preview), 0.15.1 (kebab-case file, default-exported PascalCase component);
 * Rule 1 clause 2 (reuse the specified pattern rather than duplicating it).
 */

import type { ReactElement } from "react";

import { cn } from "@/lib/cn";

/**
 * The two writing directions a rendered document can state.
 *
 * Declared here rather than imported: this component sits in the shared layer and takes the
 * direction as data, so it needs the whole vocabulary a document can carry and nothing else. A
 * caller holding the content locale's own direction passes it through unchanged.
 */
export type RenderedContentDirection = "ltr" | "rtl";

/** Props of {@link RenderedContent}. */
export interface RenderedContentProps {
  /**
   * The HTML the single static renderer produced from a stored, validated document. Never
   * assembled, concatenated, escaped or repaired here, and never a fragment this component builds
   * from other data.
   */
  readonly html: string;
  /**
   * The direction the content is written in, applied to the block that holds the markup so lists,
   * quotes, images and the reading order follow the document rather than the interface.
   */
  readonly direction: RenderedContentDirection;
  /**
   * The BCP-47 tag of the language the content is written in, applied as `lang` so assistive
   * technology shapes and speaks the markup as itself. Omitted when the caller holds no tag, because
   * a guessed language is worse than none.
   */
  readonly lang?: string;
  /**
   * The hook the consuming surface uses to find this block in its own layout, applied as `data-slot`
   * (for example `comparison-content`). Data rather than a class, so no surface has to style the
   * boundary itself.
   */
  readonly slot?: string;
  /**
   * The caller's own token utilities for the markup inside this block — its prose styles. This
   * component contributes no class of its own, so every size, spacing and colour comes from the one
   * token layer through the caller.
   */
  readonly className?: string;
}

/**
 * Renders the content module's HTML inside the block that carries its direction and language.
 *
 * Renders nothing for a string that holds only whitespace, so a read that produced no body leaves no
 * empty frame behind and no caller needs an emptiness guard of its own. Every other guarantee — what
 * the markup may contain and why it is trusted — belongs to the module note above, which is the one
 * statement of it in the application.
 */
export function RenderedContent({
  html,
  direction,
  lang,
  slot,
  className,
}: RenderedContentProps): ReactElement | null {
  if (html.trim().length === 0) {
    return null;
  }

  return (
    <div
      // The application's one raw-markup insertion, and the reason this component exists: see the
      // contract at the top of this file for what makes the string safe to insert.
      dangerouslySetInnerHTML={{ __html: html }}
      dir={direction}
      lang={lang}
      data-slot={slot}
      // A caller that states no utilities gets no `class` attribute rather than an empty one.
      className={className === undefined ? undefined : cn(className)}
    />
  );
}

export default RenderedContent;
