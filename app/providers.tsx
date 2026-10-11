"use client";

import { PressActivation } from "@/components/ui/press-activation";
import { ToastProvider } from "@/components/ui/toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <PressActivation />
      {children}
    </ToastProvider>
  );
}
