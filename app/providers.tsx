"use client";

import { NativeBridge } from "@/components/native/native-bridge";
import { PressActivation } from "@/components/ui/press-activation";
import { ToastProvider } from "@/components/ui/toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <NativeBridge />
      <PressActivation />
      {children}
    </ToastProvider>
  );
}
