"use client";

/**
 * Toast — bottom stack on the translucent material (BRIEF B10.5 / B10.6 #10).
 *
 * - `ToastProvider` owns the stack (max 3 visible) and renders it in a portal.
 * - `useToast()` returns `{ toast, dismiss }`; the module-level `toast()`
 *   plain function routes to the mounted provider (set via context effect).
 * - Enters and exits with `springDefault` along the SAME path (B10.6 #7).
 * - Optional action ("Desfazer") with a visible countdown (5s default) that
 *   pauses on hover/press and resumes on leave.
 *
 * All strings come in via props/options — UI copy lives in messages/*.json.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  type AnimationPlaybackControls,
} from "motion/react";
import { durations, easeStandard, springDefault } from "@/lib/motion";
import { cx, Pressable } from "@/components/ui/pressable";

export interface ToastAction {
  /** e.g. the translated "Desfazer". */
  label: string;
  onAction: () => void;
}

export type ToastVariant = "default" | "success" | "error";

export interface ToastOptions {
  title: string;
  description?: string;
  action?: ToastAction;
  /** Tone of the countdown line; never the only signal — the text carries it. */
  variant?: ToastVariant;
  /** How long the toast stays (ms). */
  durationMs?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

export interface ToastContextValue {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const MAX_VISIBLE = 3;
const DEFAULT_DURATION_MS = 5000;

const ToastContext = React.createContext<ToastContextValue | null>(null);

let globalToast: ToastContextValue["toast"] | null = null;

/** Plain function form — usable outside React trees once a provider mounts. */
export function toast(options: ToastOptions): number {
  if (globalToast) return globalToast(options);
  if (process.env.NODE_ENV !== "production") {
    console.warn("[betbeat/ui] toast() called without a mounted <ToastProvider>.");
  }
  return -1;
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside a <ToastProvider>.");
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const idRef = React.useRef(0);
  const [mounted, setMounted] = React.useState(false);

  const show = React.useCallback((options: ToastOptions): number => {
    const id = ++idRef.current;
    setItems((previous) =>
      // Newest at the bottom; beyond 3 the oldest leaves first.
      [...previous, { ...options, id }].slice(-MAX_VISIBLE),
    );
    return id;
  }, []);

  const dismiss = React.useCallback((id: number) => {
    setItems((previous) => previous.filter((item) => item.id !== id));
  }, []);

  const value = React.useMemo<ToastContextValue>(
    () => ({ toast: show, dismiss }),
    [show, dismiss],
  );

  React.useEffect(() => {
    globalToast = show;
    return () => {
      if (globalToast === show) globalToast = null;
    };
  }, [show]);

  React.useEffect(() => setMounted(true), []);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted &&
        createPortal(
          <ToastViewport items={items} dismiss={dismiss} />,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

function ToastViewport({
  items,
  dismiss,
}: {
  items: ToastItem[];
  dismiss: (id: number) => void;
}) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-[max(env(safe-area-inset-bottom),16px)]"
    >
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

const COUNTDOWN_COLOR: Record<ToastVariant, string> = {
  default: "bg-accent-500",
  success: "bg-green-500",
  error: "bg-ember-500",
};

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: () => void;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const remaining = useMotionValue(1);
  const countdownRef = React.useRef<AnimationPlaybackControls | null>(null);
  const onDismissRef = React.useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const durationMs = item.durationMs ?? DEFAULT_DURATION_MS;

  React.useEffect(() => {
    const controls = animate(remaining, 0, {
      duration: durationMs / 1000,
      ease: "linear",
      onComplete: () => onDismissRef.current(),
    });
    countdownRef.current = controls;
    return () => controls.stop();
  }, [durationMs, remaining]);

  const pause = React.useCallback(() => countdownRef.current?.pause(), []);
  const resume = React.useCallback(() => countdownRef.current?.play(), []);

  // Enter and exit along the SAME path; cross-fade under reduced motion.
  const hidden = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 16, scale: 0.96 };
  const visible = reducedMotion
    ? { opacity: 1 }
    : { opacity: 1, y: 0, scale: 1 };

  return (
    <motion.div
      layout
      role="status"
      initial={hidden}
      animate={visible}
      exit={hidden}
      transition={
        reducedMotion
          ? { duration: durations.fast, ease: easeStandard }
          : springDefault
      }
      className="material pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-card px-4 py-3"
      onPointerEnter={pause}
      onPointerDown={pause}
      onPointerLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">{item.title}</p>
          {item.description && (
            <p className="mt-0.5 text-sm text-text-secondary">
              {item.description}
            </p>
          )}
        </div>
        {item.action && (
          <Pressable
            onPress={() => {
              item.action?.onAction();
              onDismiss();
            }}
            className="min-h-9 shrink-0 rounded-chip bg-surface-3 px-3 py-1.5 text-sm font-semibold text-accent-400 data-pressed:bg-surface-2"
          >
            {item.action.label}
          </Pressable>
        )}
      </div>
      {/* Countdown — a thin line draining along the bottom edge. */}
      <motion.div
        aria-hidden
        className={cx(
          "absolute inset-x-0 bottom-0 h-0.5 origin-left",
          COUNTDOWN_COLOR[item.variant ?? "default"],
        )}
        style={{ scaleX: remaining }}
      />
    </motion.div>
  );
}
