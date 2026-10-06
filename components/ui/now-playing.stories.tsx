import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NowPlaying } from "./now-playing";

/** Frozen clock for deterministic progress renders. */
const NOW = 1_760_000_000_000;
const frozenNow = () => NOW;

const COVER =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'>" +
      "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
      "<stop offset='0' stop-color='#b50e24'/><stop offset='1' stop-color='#2c2c2e'/>" +
      "</linearGradient></defs><rect width='128' height='128' fill='url(#g)'/></svg>",
  );

const meta = {
  title: "UI/NowPlaying",
  component: NowPlaying,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div style={{ width: 420 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NowPlaying>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Live progress + Beat Pulse at 124 BPM (real clock). */
export const Live: Story = {
  args: {
    title: "Gata Only",
    artist: "FloyyMenor, Cris MJ",
    coverUrl: COVER,
    bpm: 124,
    startedAt: Date.now() - 65_000,
    durationSec: 212,
    amountCents: 3200,
    handle: "@rita",
  },
};

/** Deterministic mid-track render (frozen clock, ~31%). */
export const MidTrack: Story = {
  args: {
    title: "Pepas",
    artist: "Farruko",
    coverUrl: COVER,
    bpm: 130,
    startedAt: NOW - 65_000,
    durationSec: 212,
    getNow: frozenNow,
    amountCents: 1800,
    handle: "@miguel.s",
  },
};

/** Seconds from the end — bar nearly full. */
export const NearEnd: Story = {
  args: {
    ...MidTrack.args,
    startedAt: NOW - 205_000,
  },
};

/** Anonymous request, no amount shown (public-facing variant). */
export const Anonymous: Story = {
  args: {
    title: "Vida Louca",
    artist: "Mc Kevin o Chris",
    bpm: 130,
    startedAt: NOW - 30_000,
    durationSec: 180,
    getNow: frozenNow,
  },
};

/** No BPM known — Beat Pulse ring disabled. */
export const NoBeatPulse: Story = {
  args: {
    title: "Unreleased Edit",
    artist: "ID",
    coverUrl: COVER,
    startedAt: NOW - 100_000,
    durationSec: 240,
    getNow: frozenNow,
    amountCents: 2500,
  },
};
