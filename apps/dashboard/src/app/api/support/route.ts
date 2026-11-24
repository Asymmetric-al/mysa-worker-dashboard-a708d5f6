import { reads } from "@/modules/data-service";
import { readJudgement, readRoute } from "../read";
import { supportQueryFromSearch } from "./query";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const readSupportOverview = readRoute(readJudgement(supportQueryFromSearch), (query) => reads.support.readSupportOverview(query));
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readSupportOverview });
