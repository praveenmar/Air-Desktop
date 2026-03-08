import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Main Process Configuration
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        // This is the specific line electron-vite looks for
        entry: resolve(__dirname, 'electron/main/index.ts')
      }
    },
    resolve: {
      alias: {
        '@core': resolve(__dirname, 'core'),
        '@electron': resolve(__dirname, 'electron')
      }
    }
  },

  // Preload Scripts Configuration
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          'ui.preload': resolve(__dirname, 'electron/preload/ui.preload.ts'),
          'interceptor.preload': resolve(__dirname, 'electron/preload/interceptor.preload.ts')
        }
      }
    }
  },

  // Renderer (React) Configuration
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        input: {
          // Vite uses the HTML file to discover your main.tsx
          index: resolve(__dirname, 'index.html')
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@src': resolve(__dirname, 'src'),
        '@core': resolve(__dirname, 'core')
      }
    }
  }
});
