import { reads } from "@/modules/data-service";
import { readJudgement, readRoute } from "../../read";
import { giftsQueryFromSearch } from "../query";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const readGifts = readRoute(readJudgement(giftsQueryFromSearch), (query) => reads.support.readGifts(query));
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readGifts });
