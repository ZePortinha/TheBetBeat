import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Skeleton, SkeletonText } from "./skeleton";

/**
 * Loading placeholders with the shared 1.4s shimmer (static under reduced
 * motion). Never full-screen spinners — skeletons mirror the layout that is
 * about to appear.
 */
const meta = {
  title: "UI/Skeleton",
  component: Skeleton,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Line: Story = {
  args: { width: 240, height: 16 },
};

export const Block: Story = {
  args: { width: 240, height: 96, rounded: "card" },
};

export const Circle: Story = {
  args: { width: 48, height: 48, rounded: "full" },
};

export const Text: Story = {
  render: () => (
    <div className="w-72">
      <SkeletonText lines={3} />
    </div>
  ),
};

/** The shape of a TrackRow while the catalog loads. */
export const TrackRowLoading: Story = {
  name: "Track row (composition)",
  render: () => (
    <div className="flex w-80 flex-col gap-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-card border border-line-subtle bg-surface-1 p-3"
        >
          <Skeleton width={56} height={56} rounded="button" className="shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton height={14} className="w-4/5" />
            <Skeleton height={12} className="w-3/5" />
          </div>
          <Skeleton width={48} height={24} rounded="full" className="shrink-0" />
        </div>
      ))}
    </div>
  ),
};
