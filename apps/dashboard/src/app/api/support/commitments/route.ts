import { reads } from "@/modules/data-service";
import { readJudgement, readRoute } from "../../read";
import { supportPageFromSearch } from "../query";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const readCommitments = readRoute(readJudgement(supportPageFromSearch), (query) => reads.support.readCommitments(query));
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readCommitments });
