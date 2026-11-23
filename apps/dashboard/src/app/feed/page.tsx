import { redirect } from "next/navigation";
/** The legacy alias: `/feed` sends the caller straight to `/communication`, the surface that replaced it. */
export default function FeedPage(): never {
  redirect("/communication");
}
