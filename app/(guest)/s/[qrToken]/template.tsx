import { PageTransition } from "@/components/guest/page-transition";

/** Remounts on every navigation inside the party: each screen fades in. */
export default function PartyTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
