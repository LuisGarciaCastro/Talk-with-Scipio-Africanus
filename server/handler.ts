import { createLiveToken } from './token.js';

export interface ServerEnv {
  GEMINI_API_KEY?: string;
  GEMINI_LIVE_MODEL?: string;
  /** Voz fija de Escipión. Por defecto Algenib (masculina y rasposa: un viejo general). */
  GEMINI_VOICE?: string;
  /** Si está definida, la app pide esta clave al entrar. */
  ACCESS_CODE?: string;
}

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Lógica de GET /api/token, independiente de dónde corra
 * (dev server de Vite en local o función serverless en Vercel).
 */
export async function handleTokenRequest(url: URL, env: ServerEnv): Promise<HandlerResult> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'pega_aqui_tu_key') {
    return { status: 500, body: { error: 'Falta GEMINI_API_KEY en el servidor' } };
  }

  if (env.ACCESS_CODE && url.searchParams.get('clave') !== env.ACCESS_CODE) {
    return { status: 401, body: { error: 'Clave incorrecta. Pídesela a tu profesor.' } };
  }

  // ?comprobar: la pantalla de entrada valida la clave sin gastar un token
  if (url.searchParams.has('comprobar')) return { status: 200, body: { ok: true } };

  try {
    const result = await createLiveToken({
      apiKey,
      model: env.GEMINI_LIVE_MODEL || 'gemini-3.8-live',
      voice: env.GEMINI_VOICE || 'Algenib',
    });
    return { status: 200, body: { ...result } };
  } catch (err) {
    return { status: 502, body: { error: err instanceof Error ? err.message : String(err) } };
  }
}
