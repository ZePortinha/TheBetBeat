import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Pressable } from "./pressable";

/**
 * The base interaction primitive. Unstyled by design — stories dress it with
 * token utilities. Press it, drag away mid-press (cancels), tap twice fast
 * (the second tap inside 400ms is swallowed, the first never waits).
 */
const meta = {
  title: "UI/Pressable",
  component: Pressable,
  parameters: { layout: "centered" },
  args: {
    className:
      "rounded-button bg-surface-2 px-5 py-3 text-base font-semibold text-text-primary",
  },
} satisfies Meta<typeof Pressable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {
  args: { children: "Pedir música" },
};

export const PressedHint: Story = {
  name: "Pressed (hint)",
  args: { children: "Pedir música", forcePressed: true },
};

export const Disabled: Story = {
  args: { children: "Pedir música", disabled: true, className: "rounded-button bg-surface-2 px-5 py-3 text-base font-semibold text-text-primary opacity-40" },
};

export const Loading: Story = {
  args: { children: "A enviar…", loading: true },
};

/** Counts confirms — shows the 400ms double-tap guard and drag-away cancel. */
export const DoubleTapGuard: Story = {
  render: (args) => <DoubleTapDemo {...args} />,
  args: { children: "Pedir música" },
};

function DoubleTapDemo(args: React.ComponentProps<typeof Pressable>) {
  const [count, setCount] = React.useState(0);
  return (
    <div className="flex flex-col items-center gap-4">
      <Pressable
        {...args}
        onPress={() => setCount((value) => value + 1)}
      >
        {args.children}
      </Pressable>
      <p className="text-sm text-text-secondary tnum">Confirmações: {count}</p>
      <p className="max-w-60 text-center text-xs text-text-tertiary">
        Toca duas vezes depressa: só a primeira conta. Arrasta para fora antes
        de largar: cancela.
      </p>
    </div>
  );
}
