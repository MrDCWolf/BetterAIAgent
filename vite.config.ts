import { defineConfig } from "vite"
import { crx } from "@crxjs/vite-plugin"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import manifestConfig from './manifest.config.ts';

export default defineConfig({
  plugins: [
    crx({ manifest: manifestConfig }),
    svelte()
  ],
  build: {
    target: "es2022",
    outDir: "dist", // Explicitly set output directory
    emptyOutDir: true // Ensure clean builds
  },
  // Add server config to prevent potential CRXJS build errors
  server: { 
    port: 5173, 
    strictPort: true,
    hmr: {
      port: 5173,
    }
  },
  optimizeDeps: {
    include: ['svelte']
  },
  ssr: {
    noExternal: ['svelte']
  }
}) 