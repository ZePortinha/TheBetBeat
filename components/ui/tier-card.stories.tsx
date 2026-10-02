import * as React from "react";
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { Tier } from "@/lib/domain/types";
import { TierCard } from "./tier-card";

const meta = {
  title: "UI/TierCard",
  component: TierCard,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TierCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    tier: "SOON",
    name: "Em Breve",
    promise: "Toca nos próximos 20 min",
    priceCents: 1800,
    etaLabel: "~14 min",
  },
};

export const Selected: Story = {
  args: {
    tier: "NEXT",
    name: "A Seguir",
    promise: "Toca nas próximas 2 músicas",
    priceCents: 3200,
    etaLabel: "~7 min",
    selected: true,
  },
};

export const Unavailable: Story = {
  args: {
    tier: "NEXT",
    name: "A Seguir",
    promise: "Toca nas próximas 2 músicas",
    priceCents: 3200,
    etaLabel: "—",
    available: false,
    unavailableReason: "Já há um pedido A Seguir — volta a tentar daqui a pouco",
  },
};

export const WithCents: Story = {
  args: {
    tier: "QUEUE",
    name: "Na Fila",
    promise: "Toca antes do fim do set",
    priceCents: 1250,
    etaLabel: "~35 min",
  },
};

/** Interactive picker — one glow per screen: only the selected card glows. */
function TierPicker() {
  const [selected, setSelected] = useState<Tier>("SOON");
  const tiers: Array<{
    tier: Tier;
    name: string;
    promise: string;
    priceCents: number;
    etaLabel: string;
    available: boolean;
    unavailableReason?: string;
  }> = [
    {
      tier: "QUEUE",
      name: "Na Fila",
      promise: "Toca antes do fim do set",
      priceCents: 1000,
      etaLabel: "~35 min",
      available: true,
    },
    {
      tier: "SOON",
      name: "Em Breve",
      promise: "Toca nos próximos 20 min",
      priceCents: 1800,
      etaLabel: "~14 min",
      available: true,
    },
    {
      tier: "NEXT",
      name: "A Seguir",
      promise: "Toca nas próximas 2 músicas",
      priceCents: 3200,
      etaLabel: "~7 min",
      available: false,
      unavailableReason: "Já há um pedido A Seguir",
    },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 360 }}>
      {tiers.map((t) => (
        <TierCard
          key={t.tier}
          {...t}
          selected={selected === t.tier}
          onSelect={() => setSelected(t.tier)}
        />
      ))}
    </div>
  );
}

export const Picker: Story = {
  args: Default.args,
  render: () => <TierPicker />,
};
