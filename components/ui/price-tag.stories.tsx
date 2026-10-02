import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { PriceTag } from "./price-tag";

const meta = {
  title: "UI/PriceTag",
  component: PriceTag,
  args: { cents: 1200, size: "md", tone: "gold" },
  argTypes: {
    size: { control: "radio", options: ["md", "lg", "display"] },
    tone: { control: "radio", options: ["gold", "inherit"] },
  },
} satisfies Meta<typeof PriceTag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Medium: Story = {};

export const MediumWithCents: Story = { args: { cents: 1250 } };

export const Large: Story = { args: { cents: 2500, size: "lg" } };

/** Display size uses the editorial serif (value ≥ 28px, B10.3). */
export const Display: Story = { args: { cents: 2500, size: "display" } };

export const DisplayWithCents: Story = {
  args: { cents: 1850, size: "display" },
};

export const InheritTone: Story = {
  args: { cents: 1200, tone: "inherit" },
  render: (args) => (
    <span className="text-text-secondary">
      Total: <PriceTag {...args} />
    </span>
  ),
};

function OdometerDemo() {
  const [cents, setCents] = useState(1200);
  const presets = [900, 1200, 1250, 1850, 2500, 12050];
  return (
    <div className="flex flex-col items-center gap-6">
      <PriceTag cents={cents} size="display" />
      <div className="flex flex-wrap justify-center gap-2">
        {presets.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setCents(value)}
            className="rounded-button border border-line-strong bg-surface-2 px-3 py-1.5 text-[length:var(--text-14)] text-text-primary active:scale-[0.97]"
          >
            {(value / 100).toFixed(2).replace(".", ",")} €
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCents((c) => c + 500)}
          className="rounded-button bg-gold-500 px-3 py-1.5 text-[length:var(--text-14)] font-semibold text-text-on-accent active:scale-[0.97]"
        >
          +5 €
        </button>
      </div>
    </div>
  );
}

/** Click through values to watch the digits roll (slow 480ms, standard). */
export const Odometer: Story = { render: () => <OdometerDemo /> };
