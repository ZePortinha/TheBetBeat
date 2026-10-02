import { redirect } from "next/navigation";
import { requireConsole } from "./_lib/context";

/** /console lands on Sessões — the venue's daily entry point (B9). */
export default async function ConsoleIndexPage() {
  await requireConsole("/console");
  redirect("/console/sessoes");
}
