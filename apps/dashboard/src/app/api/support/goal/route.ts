import { z } from "zod";
import { mutationInputSchema, mutations, reads } from "@/modules/data-service";
import { writeRoute } from "../../handler";
import { readJudgement, readRoute } from "../../read";
import { supportQueryFromSearch } from "../query";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type GoalPayload = Parameters<typeof mutations.support.saveGoal>[0]["payload"];
const saveGoalRequestSchema = mutationInputSchema(z.custom<GoalPayload>());
/** Answers with the support goal, its progress, the capability that governs editing it and the period the percentage was measured over. */
export const GET = readRoute(readJudgement(supportQueryFromSearch), (query) => reads.support.readGoal(query));
/** Saves the goal the body states, and answers with exactly one of the service's eight outcomes. */
export const POST = (request: Request): Promise<Response> => writeRoute(request, saveGoalRequestSchema, mutations.support.saveGoal);
