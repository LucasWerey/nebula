import type { Config } from "tailwindcss";
import { ledgerLivePreset } from "@ledgerhq/lumen-design-core";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  presets: [ledgerLivePreset],
} satisfies Config;
