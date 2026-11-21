/**
 * The one decision about the committed media-fixture directory: whether a request path resolves into it.
 *
 * The fixtures under `apps/dashboard/public/fixtures/media/` are inputs, never output. A reset
 * materialises each seeded rendition's bytes from them into the store's own `.data/media` custody, and
 * the upload path reads them as its fixture inputs; neither of those is a serving route. Everything the
 * framework finds under `public/` is served at a permanent, unauthenticated address, so the directory
 * must have no HTTP address at all: `GET /api/media/<assetId>/<rendition>`, which re-authorises every
 * playback, poster, caption, transcript and display request, stays the only way to a rendition's bytes.
 *
 * **Why the decision is made on the decoded path.** The framework percent-decodes a request path before
 * it resolves a `public/` file — the router's filesystem handler decodes the item path it is about to
 * look up — while a rule keyed on the literal path is compared against the spelling the request arrived
 * with. That gap is the whole bypass: `/fixtures/media/poster.jpg` is refused by a literal rule, but
 * `/fixtures/%6Dedia/poster.jpg`, `/fixtures/media%2Fposter.jpg` and `/%66ixtures/media/poster.jpg` all
 * decode to the same file and none of them matches the literal text. Decoding here, repeatedly, before
 * the comparison is what makes the answer independent of how the path was spelled, and it is why this
 * predicate, rather than a rewrite, route or header check, owns the rule.
 *
 * Dependency-free and runtime-neutral on purpose: it imports nothing, opens nothing, reads no clock and
 * keeps no state, so the request-level guard that calls it loads in whatever runtime serves the request
 * and two calls with the same path return equal results.
 *
 * Plan items that put this file in scope: AAP 0.2.2 (renderer-level scope enforcement for media, and the
 * anti-pattern "A media original served from a permanent public URL"), 0.3.2 (no permanent public URL for
 * a rendition or an original), 0.6.2 (a protected asset has no permanent public URL), 0.8.6 (every media
 * request rechecks scope) and 0.12.4 (the committed fixtures stay the seed's and the upload path's input).
 */

/**
 * Percent-decoding passes a path is unwrapped through before it is taken as it stands. Each pass either
 * changes the path or ends the loop, and five is already more nesting than the framework decodes into a
 * file name, so a deeper spelling names no file this application serves.
 */
const MAX_DECODE_PASSES = 5;

/** Decodes one path segment, keeping the segment as it stands when its escapes are malformed. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed escape (`%`, `%ZZ`, a truncated UTF-8 sequence) does not decode into a different file
    // name for the framework either, so the segment is judged in the form it arrived in.
    return segment;
  }
}

/**
 * The path with every layer of percent-encoding removed: `%252F` becomes `/` and `%256D` becomes `m`
 * over two passes, and a path that keeps changing is unwrapped until a pass leaves it unchanged.
 */
function unwrapEncodedPath(rawPath: string): string {
  let path = rawPath;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    // Decoding segment by segment keeps one malformed escape from hiding the well-formed escapes beside
    // it: only the segment that carries it stays as it stands.
    const decoded = path.split("/").map(decodeSegment).join("/");
    if (decoded === path) {
      return path;
    }
    path = decoded;
  }
  return path;
}

/**
 * The path's segments once the filesystem's own normalisation is applied: backslashes read as
 * separators, case folded, `.` dropped, `..` resolved against the segment before it and empty segments
 * ignored. `/fixtures/./media/`, `/fixtures/media/../media/` and `/fixtures/%2E/media/` therefore all
 * resolve to the same two segments, which is the directory the request will reach.
 */
function resolvedSegments(path: string): string[] {
  const segments: string[] = [];
  for (const segment of path.replaceAll("\\", "/").toLowerCase().split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments;
}

/**
 * Whether a request path resolves into the committed media-fixture directory, whatever spelling it
 * arrived in. Any `fixtures` segment immediately followed by a `media` segment is the directory itself
 * or something inside it, so the plain, percent-encoded, double-encoded, mixed-case, backslash-separated
 * and dot-segment forms are one answer; a sibling such as `/fixtures/contacts-example.csv` and every
 * other route are not.
 */
export function isCommittedMediaFixturePath(rawPath: string): boolean {
  const segments = resolvedSegments(unwrapEncodedPath(rawPath));
  return segments.some(
    (segment, index) => segment === "fixtures" && segments[index + 1] === "media",
  );
}
