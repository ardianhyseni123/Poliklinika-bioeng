import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The old app in docs/ keeps being served until cutover; the new one builds to dist/.
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // Libraries in their own files: they rarely change, so browsers keep them cached
        // (assets are served as immutable) and a new app version only downloads the app.
        codeSplitting: {
          groups: [
            { name: 'firebase', test: /node_modules[\\/](@firebase|firebase)[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }
          ]
        }
      }
    },
    // The Firebase SDK alone is about 700 kB before compression.
    chunkSizeWarningLimit: 800
  },
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'node',
    testTimeout: 20000
  }
});
