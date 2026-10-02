import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { StatusStepper } from "./status-stepper";

const STEPS = ["Pago", "Aceite", "Na fila", "A tocar", "Tocou"];

const meta = {
  title: "UI/StatusStepper",
  component: StatusStepper,
  args: { steps: STEPS, activeIndex: 0 },
  decorators: [
    (Story) => (
      <div style={{ width: 420, maxWidth: "90vw" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StatusStepper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pago: Story = { args: { activeIndex: 0 } };

export const Aceite: Story = { args: { activeIndex: 1 } };

/** Position/ETA slot renders under the active step. */
export const NaFilaComEta: Story = {
  args: { activeIndex: 2, detail: "3.º · ~12 min" },
};

export const ATocar: Story = { args: { activeIndex: 3 } };

/** activeIndex = steps.length marks everything done (request played). */
export const Tocou: Story = { args: { activeIndex: STEPS.length } };

function SteppingDemo() {
  const [active, setActive] = useState(0);
  return (
    <div className="flex flex-col gap-6">
      <StatusStepper
        steps={STEPS}
        activeIndex={active}
        detail={active === 2 ? "3.º · ~12 min" : undefined}
      />
      <div className="flex justify-center gap-2">
        <button
          type="button"
          onClick={() => setActive((a) => Math.max(0, a - 1))}
          className="rounded-button border border-line-strong bg-surface-2 px-3 py-1.5 text-[length:var(--text-14)] text-text-primary active:scale-[0.97]"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={() => setActive((a) => Math.min(STEPS.length, a + 1))}
          className="rounded-button bg-gold-500 px-3 py-1.5 text-[length:var(--text-14)] font-semibold text-text-on-accent active:scale-[0.97]"
        >
          Avançar
        </button>
      </div>
    </div>
  );
}

/** Step through to watch the continuous gold fill and the check draw in. */
export const Interactive: Story = { render: () => <SteppingDemo /> };
