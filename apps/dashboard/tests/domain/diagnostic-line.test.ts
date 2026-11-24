/** Proves the mutation diagnostic's own contract at the only place that writes it: one closed line per attempt, a field outside its bound stated as a fixed marker rather than the attempt disappearing from the stream, the marker an attempt that established no authority is reported under, and nothing written outside a development build. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UNSTATED_SCOPE, logger, type LogScope, type MutationLogEntry } from "@/lib/logger";
/** The four identifiers the seeded established worker's selected context carries, as a diagnostic states them. */
const SCOPE: LogScope = { organizationId: "org-harbour", ministryId: "min-harbour-youth", supportSubjectId: "sup-harbour-youth", principalId: "principal-established-worker" };
const OPERATION_ID = "4d1f9a6e-2f6b-4a1e-9a3e-5c7b8d9e0f12";
const DURATION_MS = 12.5;
/** Each field the line bounds, with a value one character past its own maximum: 64 for an operationId, 128 for a scope member, 40 for an outcome name. */
const OVER_LONG = [
  { field: "an operationId", member: "operationId", value: "a".repeat(65) },
  { field: "a scope member", member: "ministryId", value: "a".repeat(129) },
  { field: "an outcome name", member: "outcome", value: "o".repeat(41) },
] as const;
let written: string[] = [];
/** Every line one write put on the process stream, decoded as the JSON object each line is. */
function linesWhile(write: () => void): Record<string, unknown>[] {
  written = [];
  write();
  return written
    .flatMap((chunk) => chunk.split("\n"))
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
beforeEach(() => {
  // The logger's destination is the process's own stdout, so the stream is taken over for the length of one case and every call the case makes is read back as the lines it wrote.
  written = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    written.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs(); // A stubbed environment is that case's own fact: the build this suite runs in is the one every other case reads.
});
it("the mutation diagnostic line: writes exactly one line carrying exactly the five closed members and a four-member scope", () => {
  const lines = linesWhile(() => logger.mutation({ operationId: OPERATION_ID, scope: SCOPE, outcome: "accepted", elapsedMs: DURATION_MS }));
  // The line's key set is the contract a consumer reads, so no caller property can widen it and no member can go missing.
  expect(lines).toEqual([{ kind: "mutation", operationId: OPERATION_ID, scope: { organizationId: SCOPE.organizationId, ministryId: SCOPE.ministryId, supportSubjectId: SCOPE.supportSubjectId, principalId: SCOPE.principalId }, outcome: "accepted", elapsedMs: DURATION_MS }]);
});
it.each(OVER_LONG)("keeps the attempt attributable when $field is outside the bound the line states", ({ member, value }) => {
  const entry: MutationLogEntry = { operationId: member === "operationId" ? value : OPERATION_ID, scope: member === "ministryId" ? { ...SCOPE, ministryId: value } : SCOPE, outcome: member === "outcome" ? value : "denied", elapsedMs: DURATION_MS };
  const lines = linesWhile(() => logger.mutation(entry));
  // A diagnostic that vanished because of what it was asked to describe would leave the attempt invisible, so the field states a fixed marker and the rest of the line stands as it was.
  expect(lines).toHaveLength(1);
  const line = lines[0] ?? {};
  expect(member === "ministryId" ? (line.scope as Record<string, unknown>)["ministryId"] : line[member]).toBe("redacted");
});
it("the mutation diagnostic line: states the marker an attempt that established no authority is reported under, and that marker is fixed", () => {
  const lines = linesWhile(() => logger.mutation({ operationId: OPERATION_ID, scope: UNSTATED_SCOPE, outcome: "invalid", elapsedMs: DURATION_MS }));
  expect(lines).toEqual([{ kind: "mutation", operationId: OPERATION_ID, scope: UNSTATED_SCOPE, outcome: "invalid", elapsedMs: DURATION_MS }]);
  expect([...Object.values(UNSTATED_SCOPE), Object.isFrozen(UNSTATED_SCOPE)]).toEqual(["unstated", "unstated", "unstated", "unstated", true]);
});
it("the mutation diagnostic line: writes nothing at all in a production build", () => {
  // The stream is the development boundary's own: a production build reports no diagnostic at all, so no line may appear however the writer is called.
  vi.stubEnv("NODE_ENV", "production");
  expect(linesWhile(() => logger.mutation({ operationId: OPERATION_ID, scope: SCOPE, outcome: "accepted", elapsedMs: DURATION_MS }))).toEqual([]);
});
