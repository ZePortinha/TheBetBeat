import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LiveBadge } from "./live-badge";

const meta = {
  title: "UI/LiveBadge",
  component: LiveBadge,
  args: { text: "Ao vivo", bpm: 120 },
} satisfies Meta<typeof LiveBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Beat Pulse at 120 BPM (period 0.5s). */
export const Default: Story = {};

/** Slow set — 90 BPM (period ~0.667s). */
export const Slow: Story = { args: { bpm: 90 } };

/** Drum & bass — 174 BPM (period ~0.345s). */
export const Fast: Story = { args: { bpm: 174 } };

/** Same badge, different label — pulsing with the playing track. */
export const ATocar: Story = { args: { text: "A tocar", bpm: 128 } };

export const Tempos: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-4">
      <LiveBadge text="Ao vivo" bpm={90} />
      <LiveBadge text="Ao vivo" bpm={120} />
      <LiveBadge text="Ao vivo" bpm={174} />
    </div>
  ),
};
