import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SHARE_CARD_SIZES, ShareCard, type ShareCardFormat } from "./share-card";

const COVER =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='560' height='560'>" +
      "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
      "<stop offset='0' stop-color='#b50e24'/><stop offset='1' stop-color='#2c2c2e'/>" +
      "</linearGradient></defs><rect width='560' height='560' fill='url(#g)'/></svg>",
  );

/** Scales the fixed 1080px composition down to fit the Storybook canvas. */
function Scaled({ format, children }: { format: ShareCardFormat; children: React.ReactNode }) {
  const { width, height } = SHARE_CARD_SIZES[format];
  const scale = format === "story" ? 0.32 : 0.42;
  return (
    <div style={{ width: width * scale, height: height * scale, overflow: "hidden" }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}

const meta = {
  title: "UI/ShareCard",
  component: ShareCard,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ShareCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseArgs = {
  headline: "A minha música tocou",
  trackTitle: "Velvet Drift",
  trackArtist: "Linha Oito, Kova Ray",
  coverUrl: COVER,
  venueName: "Club Noir · Lisboa",
  dateTimeLabel: "Sáb · 21 Set · 01:24",
};

/** 1080×1920 — Instagram/TikTok story format. */
export const Story1080x1920: Story = {
  args: { ...baseArgs, format: "story" },
  render: (args) => (
    <Scaled format="story">
      <ShareCard {...args} />
    </Scaled>
  ),
};

/** 1080×1080 — square feed format. */
export const Square1080x1080: Story = {
  args: { ...baseArgs, format: "square" },
  render: (args) => (
    <Scaled format="square">
      <ShareCard {...args} />
    </Scaled>
  ),
};

/** No cover art — gold initials on the placeholder gradient. */
export const StoryNoCover: Story = {
  args: { ...baseArgs, format: "story", coverUrl: null },
  render: (args) => (
    <Scaled format="story">
      <ShareCard {...args} />
    </Scaled>
  ),
};

/** Long title wraps — display type stays inside the safe area. */
export const SquareLongTitle: Story = {
  args: {
    ...baseArgs,
    format: "square",
    trackTitle: "Hidden Signal (Festival Rework)",
    trackArtist: "Electric Pulse, Maré Alta",
  },
  render: (args) => (
    <Scaled format="square">
      <ShareCard {...args} />
    </Scaled>
  ),
};
