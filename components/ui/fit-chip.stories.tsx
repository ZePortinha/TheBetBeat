import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Library, Zap } from "lucide-react";
import { Chip, FitChip } from "./fit-chip";

const meta = {
  title: "UI/FitChip",
  component: FitChip,
  args: { label: "fits", text: "Encaixa" },
  argTypes: {
    label: { control: "radio", options: ["fits", "possible", "off_style"] },
  },
} satisfies Meta<typeof FitChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Fits: Story = { args: { label: "fits", text: "Encaixa" } };

export const Possible: Story = {
  args: { label: "possible", text: "Possível" },
};

export const OffStyle: Story = {
  args: { label: "off_style", text: "Fora do estilo" },
};

export const AllFitLabels: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <FitChip label="fits" text="Encaixa" />
      <FitChip label="possible" text="Possível" />
      <FitChip label="off_style" text="Fora do estilo" />
    </div>
  ),
};

/** The generic Chip also covers tier chips and library chips. */
export const GenericChips: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Chip tone="accent">A Seguir</Chip>
      <Chip tone="accent">Em Breve</Chip>
      <Chip tone="neutral">Na Fila</Chip>
      <Chip
        tone="neutral"
        icon={<Library size={14} strokeWidth={1.75} aria-hidden="true" />}
      >
        Na biblioteca
      </Chip>
      <Chip
        tone="ember"
        icon={<Zap size={14} strokeWidth={1.75} aria-hidden="true" />}
      >
        Procura alta
      </Chip>
    </div>
  ),
};
