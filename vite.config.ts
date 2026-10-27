import { defineConfig, loadEnv, type Plugin } from 'vite';
import { ACCESS_HEADER, handleTokenRequest, type ServerEnv } from './server/handler.js';

/** En local, el dev server de Vite hace de backend para GET /api/token. */
function tokenEndpoint(env: ServerEnv): Plugin {
  return {
    name: 'gemini-token-endpoint',
    configureServer(server) {
      server.middlewares.use('/api/token', async (req, res) => {
        const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://localhost');
        const header = req.headers[ACCESS_HEADER];
        const { status, body } = await handleTokenRequest(url, env, typeof header === 'string' ? header : null);
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(body));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ''); // '' = carga también variables sin prefijo VITE_ (solo en servidor)
  return { plugins: [tokenEndpoint(env)] };
});
