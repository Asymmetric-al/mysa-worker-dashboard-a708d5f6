import { z } from "zod";
import { mutationInputSchema, mutations } from "@/modules/data-service";
import { writeRoute } from "../../../handler";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type NoteRouteParams = { readonly partnerId: string };
const notePayloadSchema = z.strictObject({ body: z.string().min(1, "A private note needs the text it records; an empty note records nothing.") });
const saveNoteRequestSchema = mutationInputSchema(notePayloadSchema);
/** Records one worker-private note on the partner the path names, and answers with exactly one of the service's eight outcomes. */
async function savePrivateNote(request: Request, context: { params: Promise<NoteRouteParams> }): Promise<Response> {
  const { partnerId } = await context.params;
  return writeRoute(request, saveNoteRequestSchema, (input) => mutations.partnerPreparation.savePrivateNote({ ...input, payload: { partnerId, body: input.payload.body } }));
}
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ POST: savePrivateNote });
