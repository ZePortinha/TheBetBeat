import type { Preview } from "@storybook/nextjs-vite";
import "../app/globals.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "bg-base",
      values: [
        { name: "bg-base", value: "#0A0806" },
        { name: "surface-1", value: "#18140F" },
      ],
    },
    layout: "centered",
  },
};

export default preview;
