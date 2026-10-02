import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "./button";
import { ToastProvider, useToast } from "./toast";

/**
 * Bottom stack on the material surface. Hover or press a toast to pause its
 * countdown; the action ("Desfazer") dismisses it. Max 3 visible — firing a
 * fourth pushes the oldest out. Enters and exits along the same path.
 */
const meta = {
  title: "UI/Toast",
  component: ToastProvider,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
      </ToastProvider>
    ),
  ],
} satisfies Meta<typeof ToastProvider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { children: null },
  render: () => <ToastPlayground />,
};

export const WithUndo: Story = {
  name: "With action (Desfazer)",
  args: { children: null },
  render: () => <SingleToast kind="undo" label="Recusar pedido" />,
};

export const Error: Story = {
  args: { children: null },
  render: () => <SingleToast kind="error" label="Simular erro" />,
};

export const Success: Story = {
  args: { children: null },
  render: () => <SingleToast kind="success" label="Confirmar pagamento" />,
};

function SingleToast({ kind, label }: { kind: "undo" | "error" | "success"; label: string }) {
  const { toast } = useToast();
  const fire = () => {
    if (kind === "undo") {
      toast({
        title: "Pedido recusado",
        description: "O convidado vai ser reembolsado.",
        action: { label: "Desfazer", onAction: () => {} },
      });
    } else if (kind === "error") {
      toast({
        title: "O pagamento falhou",
        description: "Nada foi cobrado. Tenta outra vez.",
        variant: "error",
      });
    } else {
      toast({
        title: "Pagamento confirmado",
        description: "O teu pedido já está na fila do DJ.",
        variant: "success",
      });
    }
  };
  return (
    <Button variant="secondary" onPress={fire}>
      {label}
    </Button>
  );
}

function ToastPlayground() {
  const { toast } = useToast();
  const [counter, setCounter] = React.useState(0);
  return (
    <div className="flex flex-col items-center gap-3">
      <Button
        variant="primary"
        onPress={() => {
          const next = counter + 1;
          setCounter(next);
          toast({
            title: `Pedido ${next} enviado`,
            description: "O DJ já recebeu o teu pedido.",
            action: { label: "Desfazer", onAction: () => {} },
          });
        }}
      >
        Pedir música
      </Button>
      <Button
        variant="secondary"
        onPress={() => {
          toast({ title: "Pedido enviado" });
          toast({ title: "O DJ aceitou. Toca dentro de ~6 min" });
          toast({ title: "Devolvemos 12 €. Já vai a caminho." });
          toast({
            title: "Nível subido para Logo a seguir",
            variant: "success",
          });
        }}
      >
        Disparar 4 (máx. 3 visíveis)
      </Button>
      <p className="max-w-64 text-center text-xs text-text-tertiary">
        Passa o rato ou prime um toast para pausar a contagem.
      </p>
    </div>
  );
}
