import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Every build gets its own id, compiled into the app and published as /version.json. A
// running page compares the two to notice that another version has been deployed and asks
// for a reload (src/features/update). firebase.next.json serves `/` and /version.json
// uncached, so that check and the reload always reach the current deployment.
const BUILD_ID = new Date().toISOString();

function versionFile(): Plugin {
  const body = `${JSON.stringify({ version: BUILD_ID })}\n`;
  return {
    name: 'bioeng-version-file',
    // `vite` (dev and the end-to-end tests) answers with the id of the running server.
    configureServer(server) {
      server.middlewares.use('/version.json', (_request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(body);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: body });
    }
  };
}

export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
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
