"use client";

/**
 * BottomSheet — Vaul's Drawer dressed in the BetBeat material (BRIEF B10.4/6).
 *
 * - Rounded-sheet top, translucent `.material` surface, grab handle.
 * - Scrim dims and (via `shouldScaleBackground`) pushes the page back —
 *   the app shell must carry `data-vaul-drawer-wrapper` for the push.
 * - Vaul provides the 1:1 drag, momentum release and rubber-banding.
 * - Snap points pass straight through.
 * - Reduced motion: the slide is collapsed to a 120ms near-cut (scoped CSS),
 *   keeping Vaul's transition lifecycle intact.
 */

import * as React from "react";
import { Drawer } from "vaul";
import { cx } from "@/components/ui/pressable";

/** Collapses the slide to a short fade-like cut under reduced motion. */
const REDUCED_MOTION_CSS = `
@media (prefers-reduced-motion: reduce) {
  [data-betbeat-sheet], [data-betbeat-scrim] {
    transition-duration: 120ms !important;
  }
}
`;

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible title (translated string). Visually hidden via `hideTitle`. */
  title: string;
  description?: string;
  hideTitle?: boolean;
  /** When false the sheet only closes programmatically (modal tasks). */
  dismissible?: boolean;
  /** Vaul snap points, e.g. [0.4, 0.95] or ["240px", 1]. */
  snapPoints?: (number | string)[];
  activeSnapPoint?: number | string | null;
  onActiveSnapPointChange?: (snapPoint: number | string | null) => void;
  /** Dim + push the page back. Needs data-vaul-drawer-wrapper on the shell. */
  scaleBackground?: boolean;
  /** Extra classes for the sheet panel. */
  className?: string;
  children?: React.ReactNode;
}

export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  hideTitle = false,
  dismissible = true,
  snapPoints,
  activeSnapPoint,
  onActiveSnapPointChange,
  scaleBackground = true,
  className,
  children,
}: BottomSheetProps) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      dismissible={dismissible}
      snapPoints={snapPoints}
      activeSnapPoint={activeSnapPoint}
      setActiveSnapPoint={onActiveSnapPointChange}
      shouldScaleBackground={scaleBackground}
      // Keep our own bg-base behind the pushed page, not Vaul's black.
      setBackgroundColorOnScale={false}
    >
      <Drawer.Portal>
        <style>{REDUCED_MOTION_CSS}</style>
        <Drawer.Overlay
          data-betbeat-scrim
          className="fixed inset-0 z-50 bg-bg-base/70"
        />
        <Drawer.Content
          data-betbeat-sheet
          className={cx(
            "material fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-sheet outline-none",
            snapPoints ? "h-full" : "",
            "max-h-[94dvh]",
            className,
          )}
        >
          {/* Grab handle — tap cycles snap points when they exist. */}
          <Drawer.Handle className="mx-auto! mt-3! block! h-1.5! w-10! rounded-full! bg-line-strong! opacity-100!" />
          <div className={cx("px-6 pt-3 pb-2", hideTitle && "sr-only")}>
            <Drawer.Title className="text-xl font-semibold tracking-[-0.01em] text-text-primary">
              {title}
            </Drawer.Title>
            {description && (
              <Drawer.Description className="mt-1 text-sm text-text-secondary">
                {description}
              </Drawer.Description>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-[max(env(safe-area-inset-bottom),24px)]">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
