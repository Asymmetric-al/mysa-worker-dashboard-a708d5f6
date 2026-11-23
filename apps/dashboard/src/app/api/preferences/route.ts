import { z } from "zod";
import { mutationInputSchema, mutations, reads } from "@/modules/data-service";
import { writeRoute } from "../handler";
import { readGrammar, readRoute } from "../read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MESSAGES = {
  unadmittedParameter: "A preference is the reading session's own, so this read takes no parameters: a reader, membership, address or persona is never selected by the request.",
  membershipRequired: "A preference change names the membership it records a choice against, so open the preferences this session reads and choose again.",
  membershipTooLong: "That reference is too long to be one membership, so reopen the preferences this session reads rather than pasting a value.",
  choiceClosed: "The choice is closed to off and immediate, the two decisions this purpose offers; a further value would be a separate consent this release does not keep.",
  languageInvalid: "Use a language tag such as en-GB or ar, of 35 characters or fewer.",
} as const;
type PreferencePayload = Parameters<typeof mutations.audience.setPreference>[0]["payload"];
type PreferenceChoice = PreferencePayload["choice"];
const LANGUAGE_TAG_SHAPE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u;
const CHOICE_MEMBERS = ["off", "immediate"] as const satisfies readonly PreferenceChoice[];
const preferencePayloadSchema = z.strictObject({
  membershipId: z.string({ error: MESSAGES.membershipRequired }).min(1, MESSAGES.membershipRequired).max(200, MESSAGES.membershipTooLong),
  choice: z.enum(CHOICE_MEMBERS, { error: MESSAGES.choiceClosed }),
  languagePreference: z.string({ error: MESSAGES.languageInvalid }).max(35, MESSAGES.languageInvalid).regex(LANGUAGE_TAG_SHAPE, MESSAGES.languageInvalid).optional(),
});
const preferenceBodySchema = mutationInputSchema(preferencePayloadSchema);
const preferenceQuerySchema = z.record(z.string(), z.string()).superRefine((claimed, ctx) => {
  for (const name of Object.keys(claimed)) ctx.addIssue({ code: "custom", message: MESSAGES.unadmittedParameter, path: [name] });
});
/** Answers with the reader's own Off or Immediate choice, reading language, membership state and proof state as four separate facts inside the one read envelope, and confirms nothing. */
export const GET = readRoute(
  readGrammar(preferenceQuerySchema, (search) => Object.fromEntries(search)),
  () => reads.audience.readPreferences(),
);
/** Records the caller's Off or Immediate choice, plus a reading language when the body states one, and answers with exactly one of the service's eight outcomes. */
export const POST = (request: Request): Promise<Response> => writeRoute(request, preferenceBodySchema, mutations.audience.setPreference);
