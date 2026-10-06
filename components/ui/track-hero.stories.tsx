import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Play } from "lucide-react";
import { TrackHero } from "./track-hero";

const COVER =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='192' height='192'>" +
      "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
      "<stop offset='0' stop-color='#b50e24'/><stop offset='1' stop-color='#2c2c2e'/>" +
      "</linearGradient></defs><rect width='192' height='192' fill='url(#g)'/></svg>",
  );

const meta = {
  title: "UI/TrackHero",
  component: TrackHero,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div style={{ width: 420 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TrackHero>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Demo-only preview button for the 30s preview slot. */
function PreviewButton() {
  return (
    <button
      type="button"
      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-button bg-surface-3 px-4 text-sm font-semibold text-text-primary active:bg-surface-2"
    >
      <Play size={16} strokeWidth={1.75} aria-hidden />
      Ouvir 30 s
    </button>
  );
}

export const Default: Story = {
  args: {
    title: "Gata Only",
    artist: "FloyyMenor, Cris MJ",
    coverUrl: COVER,
    genre: "Reggaeton",
    bpm: 98,
    camelotKey: "8A",
  },
};

export const WithPreviewSlot: Story = {
  args: {
    ...Default.args,
    children: <PreviewButton />,
  },
};

export const PlaceholderCover: Story = {
  args: {
    title: "Vida Louca",
    artist: "Mc Kevin o Chris",
    genre: "Funk",
    bpm: 130,
    camelotKey: "4A",
  },
};

export const MinimalMeta: Story = {
  args: {
    title: "Unreleased Edit",
    artist: "ID",
    coverUrl: COVER,
  },
};

export const LongTitle: Story = {
  args: {
    title: "I'm Good (Blue) — Extended Festival Rework 2024 Edition",
    artist: "David Guetta, Bebe Rexha",
    coverUrl: COVER,
    genre: "Dance",
    bpm: 128,
    camelotKey: "9B",
    children: <PreviewButton />,
  },
};
