import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BottomSheet } from "./bottom-sheet";
import { Button } from "./button";

/**
 * Vaul drawer in BetBeat material. Drag it down to close (momentum +
 * rubber-banding come from Vaul); the scrim dims the page. With snap
 * points, tapping the handle cycles between them.
 */
const meta = {
  title: "UI/BottomSheet",
  component: BottomSheet,
  parameters: { layout: "centered" },
} satisfies Meta<typeof BottomSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: false,
    onOpenChange: () => {},
    title: "Confirmar pedido",
  },
  render: () => (
    <SheetDemo
      title="Confirmar pedido"
      description="Revê o teu pedido antes de pagar."
      trigger="Pedir música"
    >
      <div className="flex flex-col gap-4 pt-2">
        <div className="rounded-card border border-line-subtle bg-surface-1 p-4">
          <p className="text-base font-semibold text-text-primary">
            Noite Estrelada — Os Vagalumes
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            Logo a seguir · toca dentro de ~6 min
          </p>
        </div>
        <p className="text-sm text-text-secondary">
          Se não tocar, devolvemos tudo.
        </p>
        <Button variant="primary" fullWidth size="lg">
          Pagar 6 €
        </Button>
      </div>
    </SheetDemo>
  ),
};

export const SnapPoints: Story = {
  args: {
    open: false,
    onOpenChange: () => {},
    title: "Fila de pedidos",
  },
  render: () => (
    <SheetDemo
      title="Fila de pedidos"
      trigger="Ver fila"
      snapPoints={[0.35, 0.95]}
    >
      <ul className="flex flex-col gap-3 pt-2">
        {[
          "Meia-Noite em Alfama — Rua Augusta",
          "Brilho de Neon — Clube do Cais",
          "Último Comboio — As Marés",
          "Café às Três — Lua de Fevereiro",
          "Avenida Sem Fim — Os Faróis",
        ].map((track) => (
          <li
            key={track}
            className="rounded-card border border-line-subtle bg-surface-1 px-4 py-3 text-sm text-text-primary"
          >
            {track}
          </li>
        ))}
      </ul>
    </SheetDemo>
  ),
};

export const NonDismissible: Story = {
  name: "Non-dismissible (modal task)",
  args: {
    open: false,
    onOpenChange: () => {},
    title: "A confirmar no MB WAY",
  },
  render: () => <NonDismissibleDemo />,
};

function SheetDemo({
  title,
  description,
  trigger,
  snapPoints,
  children,
}: {
  title: string;
  description?: string;
  trigger: string;
  snapPoints?: (number | string)[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="primary" onPress={() => setOpen(true)}>
        {trigger}
      </Button>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        snapPoints={snapPoints}
      >
        {children}
      </BottomSheet>
    </>
  );
}

function NonDismissibleDemo() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="primary" onPress={() => setOpen(true)}>
        Pagar com MB WAY
      </Button>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="A confirmar no MB WAY"
        description="Confirma na app MB WAY. Esta folha fecha sozinha."
        dismissible={false}
      >
        <div className="flex flex-col gap-4 pt-2">
          <p className="text-sm text-text-secondary">
            Não feches esta página enquanto confirmas.
          </p>
          <Button variant="ghost" onPress={() => setOpen(false)}>
            Cancelar pagamento
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
