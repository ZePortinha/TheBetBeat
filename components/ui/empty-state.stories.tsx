import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ListMusic, SearchX, WifiOff } from "lucide-react";
import { Button } from "./button";
import { EmptyState } from "./empty-state";

/**
 * Quiet centered empty states. Each one says what happened and what to do
 * next (B10.8) — the strings here are fictional pt-PT story copy.
 */
const meta = {
  title: "UI/EmptyState",
  component: EmptyState,
  parameters: { layout: "centered" },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoRequests: Story = {
  name: "No requests yet",
  args: {
    icon: ListMusic,
    title: "Ainda não pediste nenhuma música",
    hint: "Quando pedires, acompanhas tudo aqui.",
    action: <Button variant="primary">Pedir música</Button>,
  },
};

export const NoResults: Story = {
  name: "No search results",
  args: {
    icon: SearchX,
    title: "Nenhuma música encontrada",
    hint: "Tenta outro nome ou outro artista.",
  },
};

export const ConnectionError: Story = {
  name: "Error (offline)",
  args: {
    icon: WifiOff,
    title: "Sem ligação",
    hint: "Verifica a tua internet e tenta outra vez.",
    action: <Button variant="secondary">Tentar novamente</Button>,
  },
};
