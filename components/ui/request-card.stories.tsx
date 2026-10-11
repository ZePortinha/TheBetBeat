import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Check, Pin, Play, X } from "lucide-react";
import { RequestCard } from "./request-card";

/** Frozen clock so the countdown rings render deterministically. */
const NOW = 1_760_000_000_000;
const frozenNow = () => NOW;

const COVER =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='144' height='144'>" +
      "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
      "<stop offset='0' stop-color='#b50e24'/><stop offset='1' stop-color='#2c2c2e'/>" +
      "</linearGradient></defs><rect width='144' height='144' fill='url(#g)'/></svg>",
  );

/* Demo-only action buttons (the real Button sibling lives in ./button). */
function DemoAction({
  tone,
  icon,
  children,
}: {
  tone: "primary" | "secondary" | "destructive";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "primary"
      ? "bg-accent-500 text-text-on-accent active:bg-accent-700"
      : tone === "destructive"
        ? "bg-surface-3 text-ember-500 active:bg-surface-2"
        : "bg-surface-3 text-text-primary active:bg-surface-2";
  return (
    <button
      type="button"
      className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-button text-base font-bold ${toneClass}`}
    >
      {icon}
      {children}
    </button>
  );
}

const decideActions = (
  <>
    <DemoAction tone="primary" icon={<Check size={20} strokeWidth={1.75} aria-hidden />}>
      Aceitar
    </DemoAction>
    <DemoAction tone="destructive" icon={<X size={20} strokeWidth={1.75} aria-hidden />}>
      Recusar
    </DemoAction>
  </>
);

const queuedActions = (
  <>
    <DemoAction tone="secondary" icon={<Pin size={20} strokeWidth={1.75} aria-hidden />}>
      Fixar
    </DemoAction>
    <DemoAction tone="primary" icon={<Play size={20} strokeWidth={1.75} aria-hidden />}>
      A tocar
    </DemoAction>
    <DemoAction tone="destructive" icon={<X size={20} strokeWidth={1.75} aria-hidden />}>
      Cancelar
    </DemoAction>
  </>
);

const meta = {
  title: "UI/RequestCard",
  component: RequestCard,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div style={{ width: 560 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RequestCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseDecide = {
  mode: "decide" as const,
  title: "Velvet Drift",
  artist: "Linha Oito, Kova Ray",
  coverUrl: COVER,
  bpm: 98,
  camelotKey: "8A",
  genre: "Reggaeton",
  zoneName: "Zona VIP",
  tier: "NEXT" as const,
  tierLabel: "A Seguir",
  fit: "fits" as const,
  fitText: "Encaixa",
  inLibrary: true,
  libraryText: "Na biblioteca",
  amountCents: 3200,
  receiveLine: "Recebes 12,80 €",
  deadlineTotalMs: 3 * 60_000,
  getNow: frozenNow,
  deadlineLabel: "Prazo de decisão",
  hideMessageLabel: "Ocultar",
  actions: decideActions,
};

/** Decidir mode — decision ring (gold, 2:30 of 3:00 left), message visible. */
export const Decide: Story = {
  args: {
    ...baseDecide,
    deadlineAt: NOW + 150_000,
    message: "É o aniversário da minha irmã! 🎂",
  },
};

/** SLA-urgent ring — under 60 s to auto-refund (ember). */
export const DecideSlaUrgent: Story = {
  args: {
    ...baseDecide,
    deadlineAt: NOW + 45_000,
  },
};

/** Final seconds — ring at 9 s, soft pulse (opacity only, never a shake). */
export const DecideFinalSeconds: Story = {
  args: {
    ...baseDecide,
    deadlineAt: NOW + 9_000,
  },
};

/** Amber band — between 1 and 2 minutes remaining. */
export const DecideAmber: Story = {
  args: {
    ...baseDecide,
    deadlineAt: NOW + 90_000,
  },
};

/** Guest message present but hidden by the DJ. */
export const MessageHidden: Story = {
  args: {
    ...baseDecide,
    deadlineAt: NOW + 150_000,
    message: "É o aniversário da minha irmã! 🎂",
    defaultMessageHidden: true,
  },
};

/** Out of the DJ's library + off-style fit (worst-case chips). */
export const OutOfLibrary: Story = {
  args: {
    ...baseDecide,
    title: "Iron Lantern",
    artist: "Basalto",
    bpm: 212,
    camelotKey: "9A",
    genre: "Metal",
    fit: "off_style",
    fitText: "Fora do estilo",
    inLibrary: false,
    libraryText: "Fora da biblioteca",
    amountCents: 5000,
    receiveLine: "Recebes 20 €",
    deadlineAt: NOW + 150_000,
  },
};

const baseQueued = {
  mode: "queued" as const,
  title: "Midnight Circuit",
  artist: "Arco Verde",
  coverUrl: COVER,
  bpm: 130,
  camelotKey: "11B",
  genre: "Reggaeton",
  zoneName: "Bar",
  tier: "SOON" as const,
  tierLabel: "Em Breve",
  fit: "fits" as const,
  fitText: "Encaixa",
  inLibrary: true,
  libraryText: "Na biblioteca",
  amountCents: 1800,
  receiveLine: "Recebes 7,20 €",
  deadlineTotalMs: 20 * 60_000,
  getNow: frozenNow,
  deadlineLabel: "Prazo da promessa",
  actions: queuedActions,
};

/** Alinhados mode — promise ring (12 of 20 min left), pin/play/cancel slots. */
export const Queued: Story = {
  args: {
    ...baseQueued,
    deadlineAt: NOW + 12 * 60_000,
  },
};

/** Pinned as next — gold "Próxima" chip. */
export const QueuedPinned: Story = {
  args: {
    ...baseQueued,
    tier: "NEXT",
    tierLabel: "A Seguir",
    pinned: true,
    pinnedText: "Próxima",
    deadlineAt: NOW + 6 * 60_000,
    deadlineTotalMs: 10 * 60_000,
  },
};

/** QUEUE tier — no promise deadline (promise = end of set), no ring. */
export const QueuedNoDeadline: Story = {
  args: {
    ...baseQueued,
    tier: "QUEUE",
    tierLabel: "Na Fila",
    amountCents: 1000,
    receiveLine: "Recebes 4 €",
    deadlineAt: null,
  },
};

/** Live ring — real clock, counts down from ~2:30 (reload to reset). */
export const LiveCountdown: Story = {
  args: {
    ...baseDecide,
    getNow: undefined,
    deadlineAt: Date.now() + 150_000,
    message: "Podes dar um shout-out à mesa 7?",
  },
};
