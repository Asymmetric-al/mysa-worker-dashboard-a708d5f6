/** The one decision about the committed media-fixture directory: whether a request path resolves into it. */
/** Percent-decoding passes a path is unwrapped through before it is taken as it stands. */
const MAX_DECODE_PASSES = 5;
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed escape (`%`, `%ZZ`, a truncated UTF-8 sequence) does not decode into a different file name for the framework either, so the segment is judged in the form it arrived in.
    return segment;
  }
}
function unwrapEncodedPath(rawPath: string): string {
  let path = rawPath;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    // Decoding segment by segment keeps one malformed escape from hiding the well-formed escapes beside it: only the segment that carries it stays as it stands.
    const decoded = path.split("/").map(decodeSegment).join("/");
    if (decoded === path) return path;
    path = decoded;
  }
  return path;
}
function resolvedSegments(path: string): string[] {
  const segments: string[] = [];
  for (const segment of path.replaceAll("\\", "/").toLowerCase().split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments;
}
/** Whether a request path resolves into the committed media-fixture directory, whatever spelling it arrived in. */
export function isCommittedMediaFixturePath(rawPath: string): boolean {
  const segments = resolvedSegments(unwrapEncodedPath(rawPath));
  return segments.some((segment, index) => segment === "fixtures" && segments[index + 1] === "media");
}
