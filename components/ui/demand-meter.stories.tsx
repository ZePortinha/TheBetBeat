import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DemandMeter } from "./demand-meter";

const meta = {
  title: "UI/DemandMeter",
  component: DemandMeter,
  args: { level: "medium", label: "Procura normal" },
  argTypes: {
    level: {
      control: "radio",
      options: ["low", "medium", "high", "very_high"],
    },
  },
} satisfies Meta<typeof DemandMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Low: Story = { args: { level: "low", label: "Procura baixa" } };

export const Medium: Story = {
  args: { level: "medium", label: "Procura normal" },
};

export const High: Story = { args: { level: "high", label: "Procura alta" } };

/** very_high breathes subtly (ambient 1600ms); static under reduced motion. */
export const VeryHigh: Story = {
  args: { level: "very_high", label: "Procura máxima" },
};

export const AllLevels: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-4">
      <DemandMeter level="low" label="Procura baixa" />
      <DemandMeter level="medium" label="Procura normal" />
      <DemandMeter level="high" label="Procura alta" />
      <DemandMeter level="very_high" label="Procura máxima" />
    </div>
  ),
};
