import type { Preview } from "@storybook/nextjs-vite";
import "../app/globals.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "bg-base",
      values: [
        { name: "bg-base", value: "#000000" },
        { name: "surface-1", value: "#1c1c1e" },
      ],
    },
    layout: "centered",
  },
};

export default preview;
