import { redirect } from "next/navigation";

/**
 * Fallback when user types `/read/<novelId>` (forgetting the `/chapter` segment).
 *
 * Without an explicit `url` query we cannot infer which chapter to open — just
 * send the user back to the home page where they can pick a novel again.
 */
export default function ReaderFallbackPage() {
  redirect("/");
}
