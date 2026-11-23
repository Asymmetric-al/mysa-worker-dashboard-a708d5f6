import { isRecord } from "@/lib/guards";
import { isReadResult, toResponse } from "@/modules/data-service";
import type { ReadResponder } from "../read";
const CSV_MEMBER = "csv";
const SLICE_LENGTH = 65536;
const OPENING = `{"data":{"csv":"`;
const DATA_OPENING_LENGTH = `{"data":{`.length;
const SURROGATE_MASK = 0xfc00;
const HIGH_SURROGATES = 0xd800;
const LOW_SURROGATES = 0xdc00;
// The JSON escapes of one piece of the file, without the quotes that delimit it: the response writes the delimiters itself, and an escape is only the JSON of the text it was made from.
const escapedSlice = (text: string): string => JSON.stringify(text).slice(1, -1);
// Where a slice starting at `start` ends: the next boundary, moved back one place where it would fall inside a surrogate pair, because escaping each half on its own would no longer be the JSON the envelope itself serialises to.
function sliceEnd(text: string, start: number): number {
  const boundary = Math.min(start + SLICE_LENGTH, text.length);
  const insidePair = boundary < text.length && boundary - 1 > start && (text.charCodeAt(boundary - 1) & SURROGATE_MASK) === HIGH_SURROGATES && (text.charCodeAt(boundary) & SURROGATE_MASK) === LOW_SURROGATES;
  return insidePair ? boundary - 1 : boundary;
}
// The body's pieces in the order the response writes them: the opening of the envelope, the CSV as escaped slices, and everything behind the value's closing quote.
function* bodyPieces(csv: string, tail: string): Generator<string> {
  yield OPENING;
  let start = 0;
  while (start < csv.length) {
    const end = sliceEnd(csv, start);
    yield escapedSlice(csv.slice(start, end));
    start = end;
  }
  yield `"${tail}`;
}
// The body as the stream a response writes from, one piece at a time, so a slice is encoded and sent before the next one is made.
function streamedBody(pieces: Generator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const piece = pieces.next();
      if (piece.done === true) controller.close();
      else controller.enqueue(encoder.encode(piece.value));
    },
  });
}
// Everything the envelope's own serialisation states after its CSV value: the members of `data` without the file, then the envelope's own members, in the order the envelope was built.
function tailAfterCsv(envelope: Readonly<Record<string, unknown>>, data: Readonly<Record<string, unknown>>): string {
  const restOfData: Record<string, unknown> = {};
  for (const [member, value] of Object.entries(data)) if (member !== CSV_MEMBER) restOfData[member] = value;
  const serialised = JSON.stringify({ ...envelope, data: restOfData });
  const membersAfterTheFile = Object.keys(restOfData).length === 0 ? "" : ","; // With nothing behind the file the `data` object closes straight after the value, so a comma there would be a trailing one.
  return `${membersAfterTheFile}${serialised.slice(DATA_OPENING_LENGTH)}`;
}
/** Answers an export read — its envelope, or the refusal the JSON responder answers — with the envelope written to the wire as it is made. A JSON body is serialised to one string and encoded to one buffer, so an envelope carrying a 20 MB file holds that file four times over: the text, the record strings joined into it, the serialised body and its encoded bytes, about twelve times the payload in resident memory. Slicing the file into the body as it is written leaves one copy of the text plus the slice in flight, and the bytes sent are exactly the envelope's own JSON, so the file, its provenance records and the client's guard are unchanged. */
export const exportResponse: ReadResponder = (result) => {
  if (!isReadResult(result) || result.kind !== "envelope" || !isRecord(result.envelope)) return toResponse(result);
  const { data } = result.envelope;
  if (!isRecord(data) || typeof data.csv !== "string") return toResponse(result);
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); // The two headers the JSON responder states for an envelope, restated here because this body is written by hand.
  return new Response(streamedBody(bodyPieces(data.csv, tailAfterCsv(result.envelope, data))), { status: 200, headers });
};
