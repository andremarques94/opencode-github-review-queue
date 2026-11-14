import { fileURLToPath } from "node:url"
import { gui } from "@opencode/plugin/gui/vite"
import { defineConfig } from "vite"

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [gui({ entry: "src/ui/gui/index.tsx" })],
})
