import { notFound } from "next/navigation";
import { MotionPreview } from "./preview";

export const metadata = { title: "Motion" };

/**
 * Dev-only motion review (A2.9): the real guest auction components on a
 * fixture state, so the last-30-s flash, leader swaps, the gavel banner,
 * the winner moment and the podium can be filmed without a database.
 * /dev/motion?s=auction|home|podium|win|closed&left=<seconds>
 */
export default async function MotionPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; left?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { s, left } = await searchParams;
  const scenario = (["auction", "home", "podium", "win", "closed"] as const).find((x) => x === s) ?? "auction";
  const leftSec = Number.isFinite(Number(left)) && left ? Number(left) : 192;
  return <MotionPreview scenario={scenario} leftSec={leftSec} />;
}
