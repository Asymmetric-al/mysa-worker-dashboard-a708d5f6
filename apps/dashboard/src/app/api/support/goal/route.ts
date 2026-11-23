import { z } from "zod";
import { mutationInputSchema, mutations, reads } from "@/modules/data-service";
import { writeRoute } from "../../handler";
import { readJudgement, readRoute } from "../../read";
import { supportQueryFromSearch } from "../query";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type GoalPayload = Parameters<typeof mutations.support.saveGoal>[0]["payload"];
const saveGoalRequestSchema = mutationInputSchema(z.custom<GoalPayload>());
/** Answers with the support goal, its progress, the capability that governs editing it and the period the percentage was measured over. */
const readSupportGoal = readRoute(readJudgement(supportQueryFromSearch), (query) => reads.support.readGoal(query));
/** Saves the goal the body states, and answers with exactly one of the service's eight outcomes. */
const saveSupportGoal = (request: Request): Promise<Response> => writeRoute(request, saveGoalRequestSchema, mutations.support.saveGoal);
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readSupportGoal, POST: saveSupportGoal });
