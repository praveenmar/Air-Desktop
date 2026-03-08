// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "path";
import react from "@vitejs/plugin-react";
var __electron_vite_injected_dirname = "E:\\Air Desktop";
var electron_vite_config_default = defineConfig({
  // Main Process Configuration
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        // This is the specific line electron-vite looks for
        entry: resolve(__electron_vite_injected_dirname, "electron/main/index.ts")
      }
    },
    resolve: {
      alias: {
        "@core": resolve(__electron_vite_injected_dirname, "core"),
        "@electron": resolve(__electron_vite_injected_dirname, "electron")
      }
    }
  },
  // Preload Scripts Configuration
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          "ui.preload": resolve(__electron_vite_injected_dirname, "electron/preload/ui.preload.ts"),
          "interceptor.preload": resolve(__electron_vite_injected_dirname, "electron/preload/interceptor.preload.ts")
        }
      }
    }
  },
  // Renderer (React) Configuration
  renderer: {
    root: ".",
    build: {
      rollupOptions: {
        input: {
          // Vite uses the HTML file to discover your main.tsx
          index: resolve(__electron_vite_injected_dirname, "index.html")
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@src": resolve(__electron_vite_injected_dirname, "src"),
        "@core": resolve(__electron_vite_injected_dirname, "core")
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
