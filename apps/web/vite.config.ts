import { networkInterfaces } from "node:os";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const PORT = 5173;

// When the display is opened on localhost, the QR code must still point phones at this
// machine's LAN address, so we pass it to the client at dev time.
function lanOrigin(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return `http://${a.address}:${PORT}`;
    }
  }
  return `http://localhost:${PORT}`;
}

export default defineConfig({
  plugins: [react()],
  define: { __LAN_ORIGIN__: JSON.stringify(lanOrigin()) },
  server: {
    host: true,
    port: PORT,
    strictPort: true,
    proxy: { "/api": { target: "http://localhost:8787", ws: true } },
  },
});
