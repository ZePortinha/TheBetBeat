import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TrackRow } from "./track-row";

/** Offline-safe cover (data URI) so stories never depend on the network. */
const COVER =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>" +
      "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
      "<stop offset='0' stop-color='#b50e24'/><stop offset='1' stop-color='#2c2c2e'/>" +
      "</linearGradient></defs><rect width='96' height='96' fill='url(#g)'/></svg>",
  );

const meta = {
  title: "UI/TrackRow",
  component: TrackRow,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div style={{ width: 400 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TrackRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Velvet Drift",
    artist: "Linha Oito, Kova Ray",
    coverUrl: COVER,
    fit: "fits",
    fitText: "Encaixa",
    priceSlot: "desde 10 €",
  },
};

export const PlaceholderCover: Story = {
  args: {
    title: "Coastal Horizon",
    artist: "Rui Norte",
    fit: "possible",
    fitText: "Talvez",
    priceSlot: "desde 12 €",
  },
};

export const OffStyle: Story = {
  args: {
    title: "Iron Lantern",
    artist: "Basalto",
    coverUrl: COVER,
    fit: "off_style",
    fitText: "Fora do estilo",
    priceSlot: "desde 24 €",
  },
};

export const Unavailable: Story = {
  args: {
    title: "Midnight Circuit",
    artist: "Arco Verde",
    coverUrl: COVER,
    available: false,
    unavailableReason: "Tocou há 40 min",
  },
};

export const LongTitles: Story = {
  args: {
    title: "Hidden Signal (Extended Festival Rework, Late Night Edition)",
    artist: "Electric Pulse, Maré Alta & the Night Orchestra",
    coverUrl: COVER,
    fit: "fits",
    fitText: "Encaixa",
    priceSlot: "desde 15 €",
  },
};

export const ResultsList: Story = {
  args: Default.args,
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", width: 400 }}>
      <TrackRow
        title="Velvet Drift"
        artist="Linha Oito, Kova Ray"
        coverUrl={COVER}
        fit="fits"
        fitText="Encaixa"
        priceSlot="desde 10 €"
      />
      <TrackRow
        title="Coastal Horizon"
        artist="Rui Norte"
        fit="possible"
        fitText="Talvez"
        priceSlot="desde 12 €"
      />
      <TrackRow
        title="Midnight Circuit"
        artist="Arco Verde"
        coverUrl={COVER}
        available={false}
        unavailableReason="Tocou há 40 min"
      />
    </div>
  ),
};
