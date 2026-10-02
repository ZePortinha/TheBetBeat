import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CountdownRing, formatCountdown } from "./countdown-ring";

/**
 * Frozen-clock variants: `getNow` pins 'now' so each phase is stable.
 * Gold → amber (< 2 min) → ember (< 60 s); pulse in the final 10 s.
 */
const T0 = 1_700_000_000_000;
const WINDOW_MS = 10 * 60_000;

function frozen(remainingMs: number) {
  return {
    deadlineAt: T0 + remainingMs,
    durationMs: WINDOW_MS,
    getNow: () => T0,
  };
}

const timeText = (remainingMs: number) => (
  <span className="text-[length:var(--text-14)] font-semibold text-text-primary">
    {formatCountdown(remainingMs)}
  </span>
);

const meta = {
  title: "UI/CountdownRing",
  component: CountdownRing,
  args: {
    ...frozen(6 * 60_000),
    size: 72,
    children: timeText,
    label: "Prazo",
  },
} satisfies Meta<typeof CountdownRing>;

export default meta;
type Story = StoryObj<typeof meta>;

/** > 2 min remaining — gold. */
export const Gold: Story = { args: { ...frozen(6 * 60_000) } };

/** < 2 min remaining — amber. */
export const Amber: Story = { args: { ...frozen(90_000) } };

/** < 60 s remaining — ember. */
export const Ember: Story = { args: { ...frozen(45_000) } };

/** Final 10 s — gentle scale pulse (never shakes). */
export const FinalPulse: Story = { args: { ...frozen(8_000) } };

/** Deadline passed — empty ring, no pulse. */
export const Expired: Story = { args: { ...frozen(0) } };

/** Real clock: smooth rAF sweep across all phases in 2m30s. */
export const Live: Story = {
  render: (args) => (
    <CountdownRing
      {...args}
      getNow={undefined}
      deadlineAt={Date.now() + 150_000}
      durationMs={150_000}
    >
      {timeText}
    </CountdownRing>
  ),
};

/** Large variant for the guest payment wait (B10.6 anim 3). */
export const LargeMbwayWait: Story = {
  args: {
    ...frozen(3 * 60_000 + 20_000),
    durationMs: 4 * 60_000,
    size: 128,
    strokeWidth: 6,
    children: (ms: number) => (
      <span className="text-[length:var(--text-24)] font-semibold text-text-primary">
        {formatCountdown(ms)}
      </span>
    ),
  },
};
