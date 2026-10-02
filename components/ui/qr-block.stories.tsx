import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QRBlock } from "./qr-block";

const meta = {
  title: "UI/QRBlock",
  component: QRBlock,
  args: {
    url: "https://betbeat.app/s/demo-qr-token",
    size: 200,
    alt: "QR para pedir uma música",
  },
} satisfies Meta<typeof QRBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

/** White card, dark modules, quiet zone ≥ 4 modules. Never animated. */
export const Default: Story = {};

export const Small: Story = { args: { size: 120 } };

/** House display variant (B8): big QR + caption inviting the guest. */
export const WithCaption: Story = {
  args: {
    size: 280,
    caption: "Aponta a câmara e pede a tua música",
  },
};

export const LongUrl: Story = {
  args: {
    url: "https://betbeat.app/s/3f9c2a7d-1b64-4a8e-9f21-7c5d8e0a4b6c?utm_source=display&table=12",
    size: 240,
  },
};
