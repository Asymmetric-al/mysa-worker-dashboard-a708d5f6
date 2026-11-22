/** Home's own vocabulary, and the boundary validator that makes "a reason and a destination on every item" enforceable rather than assumed. */
import { z } from "zod";
import type { ContentLifecycleState } from "@/components/draft-status";
import type { SimulatedEffect } from "@/components/simulation-label";
import { destinationProblemOf, type DestinationProblem } from "@/lib/destination";
function requiredText(invalidMessage: string, emptyMessage: string): z.ZodString {
  return z.string({ error: invalidMessage }).refine((value) => value.trim().length > 0, { error: emptyMessage });
}
export const HOME_SECTION_KEYS = ["attention", "information", "unfinished-work"] as const;
export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number];
export const homeSectionKeySchema = z.enum(HOME_SECTION_KEYS, { error: "A Home section is Attention, Information or Unfinished work." });
export const HOME_REASON_CODES = [
  "overdue",
  "due-today",
  "plan-needs-review",
  "draft-saved",
  "awaiting-review",
  "notice-needs-attention",
  "response-recorded",
  "referral-incomplete-date",
  "import-needs-review",
  "target-needs-attention",
  "source-unavailable",
  "upcoming",
  "undated",
  "commitment-needs-attention",
  "support-received",
  "referral-window-active",
  "referral-window-expired",
] as const;
export type HomeReasonCode = (typeof HOME_REASON_CODES)[number];
export const homeReasonCodeSchema = z.enum(HOME_REASON_CODES, { error: "A Home reason code is one of the short labels this surface renders." });
const HOME_DESTINATION_PROBLEM_TEXT: Readonly<Record<DestinationProblem, string>> = {
  empty: "A destination needs the route it opens.",
  "not-relative": "A destination is a route in this application, so it begins with a slash.",
  "protocol-relative": "A destination carries one leading slash, because two of them name another site rather " + "than a route.",
  backslash: "A destination uses forward slashes only, because a backslash can name another site.",
  "control-character": "A destination carries no control characters, because a route is read as written.",
};
export const homeDestinationSchema = z.strictObject({
  href: requiredText("A destination is a route in this application, so it is text.", HOME_DESTINATION_PROBLEM_TEXT.empty).superRefine((href, context) => {
    const problem = destinationProblemOf(href);
    if (problem !== undefined) {
      context.addIssue({ code: "custom", message: HOME_DESTINATION_PROBLEM_TEXT[problem] });
    }
  }),
  label: requiredText("A destination label is the words the worker reads, so it is text.", "A destination needs a label, because a route with no words cannot be followed or read."),
});
export type HomeDestination = z.infer<typeof homeDestinationSchema>;
const HOME_LIFECYCLE_STATES = ["not-started", "draft", "candidate", "released", "partially-released", "withdrawn", "superseded-head", "stale-translation"] as const satisfies readonly ContentLifecycleState[];
const HOME_SIMULATED_EFFECTS = ["mail-submission", "publication-reach", "giving-destination", "importer-safety", "media-preparation"] as const satisfies readonly SimulatedEffect[];
/** The minimum an item may render — and the mechanism behind "a reason and a destination on every item". */
export const homeItemViewSchema = z.strictObject({
  id: requiredText("An item identity is the text the envelope gave it.", "An item needs the identity it arrived with, because a row without one cannot be opened."),
  title: requiredText("An item title is text, so read the item again.", "An item needs a title, because a row with no subject asks the worker to guess."),
  reason: requiredText("The reason an item is on Home is a sentence of text.", "An item must say why it is on Home, because an item that cannot say why is not actionable."),
  reasonCode: requiredText("A reason code is a short text value.", "An item needs a reason code beside its sentence, so a row can label it without inventing a label."),
  destination: homeDestinationSchema,
  statusWord: requiredText("A status word is one short text value.", "A status word needs a character, or leave it out so the row composes its own wording.").optional(),
  lifecycle: z.enum(HOME_LIFECYCLE_STATES, { error: "A lifecycle state is one of the states the shared draft indicator renders." }).optional(),
  simulatedEffect: z.enum(HOME_SIMULATED_EFFECTS, { error: "A simulated effect is one of the five effects the interface has a label for." }).optional(),
  detail: z.string({ error: "A detail line is text, so read the item again." }).optional(),
});
export type HomeItemView = z.infer<typeof homeItemViewSchema>;
/** What parsing one item answers: the validated view, or the fact that the item cannot be rendered plus whatever subject and reason text could still be read off it. */
export type HomeItemParseResult = { readonly ok: true; readonly item: HomeItemView } | { readonly ok: false; readonly title?: string; readonly reason?: string };
function readableText(candidate: unknown, key: "title" | "reason"): string | undefined {
  if (typeof candidate !== "object" || candidate === null) {
    return undefined;
  }
  const value: unknown = Reflect.get(candidate, key);
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
export function parseHomeItem(candidate: unknown): HomeItemParseResult {
  const parsed = homeItemViewSchema.safeParse(candidate);
  if (parsed.success) {
    return { ok: true, item: parsed.data };
  }
  const title = readableText(candidate, "title");
  const reason = readableText(candidate, "reason");
  return { ok: false, ...(title === undefined ? {} : { title }), ...(reason === undefined ? {} : { reason }) };
}
