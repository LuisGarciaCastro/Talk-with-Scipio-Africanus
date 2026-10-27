import { createHash, timingSafeEqual } from 'node:crypto';
import { createLiveToken } from './token.js';

export interface ServerEnv {
  GEMINI_API_KEY?: string;
  GEMINI_LIVE_MODEL?: string;
  /** Voz fija de Escipión. Por defecto Algenib (masculina y rasposa: un viejo general). */
  GEMINI_VOICE?: string;
  /** Si está definida, la app pide esta clave al entrar. */
  ACCESS_CODE?: string;
  /** Lo pone Vercel: en producción la clave es obligatoria. */
  VERCEL?: string;
}

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

/** Cabecera en la que el navegador manda la clave (no va en la URL para no quedar en los logs). */
export const ACCESS_HEADER = 'x-access-code';

/** Compara en tiempo constante (hash de ambos lados, así también da igual la longitud). */
function sameCode(given: string, expected: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Lógica de GET /api/token, independiente de dónde corra
 * (dev server de Vite en local o función serverless en Vercel).
 */
export async function handleTokenRequest(url: URL, env: ServerEnv, accessCode: string | null): Promise<HandlerResult> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'pega_aqui_tu_key') {
    return { status: 500, body: { error: 'Falta GEMINI_API_KEY en el servidor' } };
  }

  const expected = env.ACCESS_CODE?.trim();
  if (!expected && env.VERCEL) {
    // Sin clave en producción cualquiera podría gastar tu cuota: mejor no dar tokens
    return { status: 500, body: { error: 'Falta ACCESS_CODE en el servidor' } };
  }
  if (expected && !sameCode(accessCode?.trim() ?? '', expected)) {
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
    // El detalle va al log del servidor; al alumno, un mensaje entendible
    console.error('Error creando el token de Gemini:', err);
    const quota = /429|quota|exhausted/i.test(String(err));
    return {
      status: 502,
      body: { error: quota ? 'Se ha agotado la cuota de Gemini. Espera un minuto y vuelve a llamar.' : 'No se pudo abrir la conversación con Gemini. Inténtalo de nuevo.' },
    };
  }
}
