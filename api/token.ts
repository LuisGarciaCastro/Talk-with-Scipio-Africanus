// Función serverless de Vercel: GET /api/token
// Variables de entorno en Vercel: GEMINI_API_KEY, ACCESS_CODE y (opcional) GEMINI_LIVE_MODEL.
import { handleTokenRequest } from '../server/handler.js';

export async function GET(request: Request): Promise<Response> {
  const { status, body } = await handleTokenRequest(new URL(request.url), process.env);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
