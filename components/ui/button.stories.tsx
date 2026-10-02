import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button, HoldButton } from "./button";

const meta = {
  title: "UI/Button",
  component: Button,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { variant: "primary", children: "Pedir música" },
};

export const Secondary: Story = {
  args: { variant: "secondary", children: "Os meus pedidos" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "Cancelar" },
};

export const Destructive: Story = {
  args: { variant: "destructive", children: "Recusar pedido" },
};

export const LargeCockpit: Story = {
  name: "Large (cockpit, 56px)",
  args: { variant: "primary", size: "lg", children: "Aceitar" },
};

export const PressedHint: Story = {
  name: "Pressed (hint)",
  args: { variant: "primary", children: "Pedir música", forcePressed: true },
};

export const Loading: Story = {
  args: { variant: "primary", children: "Confirmar pagamento", loading: true },
};

export const Disabled: Story = {
  args: { variant: "primary", children: "Pedir música", disabled: true },
};

export const FullWidth: Story = {
  args: { variant: "primary", fullWidth: true, children: "Pagar 6 €" },
  parameters: { layout: "padded" },
  render: (args) => (
    <div className="w-80">
      <Button {...args} />
    </div>
  ),
};

export const AllVariants: Story = {
  name: "All variants",
  args: { children: "Pedir música" },
  render: () => (
    <div className="flex flex-col items-start gap-4">
      <Button variant="primary">Pedir música</Button>
      <Button variant="secondary">Os meus pedidos</Button>
      <Button variant="ghost">Cancelar</Button>
      <Button variant="destructive">Recusar pedido</Button>
    </div>
  ),
};

/* ── HoldButton ─────────────────────────────────────────────────── */

export const Hold: Story = {
  name: "HoldButton — Terminar set",
  args: { children: "" },
  render: () => <HoldDemo />,
};

export const HoldFillHint: Story = {
  name: "HoldButton — fill at 60% (hint)",
  args: { children: "" },
  render: () => (
    <HoldButton onConfirm={() => {}} forceProgress={0.6} fullWidth className="w-72">
      Terminar set
    </HoldButton>
  ),
};

export const HoldDisabled: Story = {
  name: "HoldButton — disabled",
  args: { children: "" },
  render: () => (
    <HoldButton onConfirm={() => {}} disabled className="w-72">
      Terminar set
    </HoldButton>
  ),
};

function HoldDemo() {
  const [confirmedAt, setConfirmedAt] = React.useState<number | null>(null);
  return (
    <div className="flex flex-col items-center gap-4">
      <HoldButton
        onConfirm={() => setConfirmedAt((value) => (value ?? 0) + 1)}
        className="w-72"
      >
        Terminar set
      </HoldButton>
      <p className="text-sm text-text-secondary tnum">
        {confirmedAt
          ? `Confirmado ${confirmedAt}×`
          : "Mantém premido 2 segundos para confirmar."}
      </p>
      <p className="max-w-64 text-center text-xs text-text-tertiary">
        Larga antes do fim: o preenchimento em brasa recua com spring.
      </p>
    </div>
  );
}
