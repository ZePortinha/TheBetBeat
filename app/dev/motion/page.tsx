import { notFound } from "next/navigation";
import { MotionLab } from "./motion-lab";

export const metadata = { title: "Motion", robots: { index: false, follow: false } };

/** Dev-only stage for the big moments (intro, last 30 s, gavel, winner). */
export default function MotionPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MotionLab />;
}
