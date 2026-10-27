# Habla con Escipión 🏛️

App educativa: el alumno conversa por voz con Escipión el Africano (Gemini Live API). El alumno le habla en español y Escipión contesta en inglés sencillo mientras le va mostrando retratos, mapas, batallas, cuadros y libros (fichas de la Wikipedia en inglés).

Para ver la tablilla de imágenes sin llamar: `http://localhost:5173/?demo`

## Arrancar en local (macOS)

```bash
cd "escipion-live 2"
npm install
cp .env.example .env      # y pega tu GEMINI_API_KEY de https://aistudio.google.com/apikey
npm run dev               # abre http://localhost:5173
```

Usa Chrome o Safari, acepta el micrófono y **ponte cascos**.

## Publicarlo con un enlace (Vercel, gratis)

1. El código ya está en GitHub: `LuisGarciaCastro/Talk-with-Scipio-Africanus` (`.env` está en `.gitignore`: tu key no se sube).
2. Entra en https://vercel.com con tu cuenta de GitHub → **Add New… → Project** → importa `Talk-with-Scipio-Africanus`. Vercel detecta Vite solo.
3. Antes de pulsar Deploy, en **Environment Variables** añade:
   - `GEMINI_API_KEY` = tu key
   - `ACCESS_CODE` = una clave secreta. **Obligatoria**: sin ella la app no da tokens en Vercel. Mejor larga que corta (p. ej. `ave-scipio-zama-202`).
   - (opcional) `GEMINI_LIVE_MODEL` y `GEMINI_VOICE` (voz fija, por defecto `Algenib`)
4. **Deploy**. Te dará una URL tipo `https://escipion-live.vercel.app`.
5. Pasa a tus alumnos el enlace y, aparte, la clave. Al entrar, la app pide la clave y la recuerda en ese navegador.

Sin la clave, la app no da tokens: así nadie que encuentre la URL gasta tu cuota. La clave viaja en una cabecera (no en la URL) y el servidor la compara en tiempo constante.
Para frenar a quien intente adivinarla, añade en Vercel → **Firewall** una regla de límite de peticiones para `/api/token` (p. ej. 10 por minuto por IP).
(Los enlaces antiguos con `?clave=` siguen funcionando: la clave se guarda y desaparece de la barra de direcciones.)
Si cambias variables en Vercel, haz **Redeploy** para que se apliquen.

## Estructura

| Archivo | Qué hace |
|---|---|
| `server/persona.ts` | Personalidad y forma de hablar de Escipión (system prompt). |
| `server/tools.ts` | Herramienta `mostrar_imagen` que Escipión llama para enseñar fichas. |
| `server/token.ts` | Crea un token efímero de 1 uso con modelo, voz y prompt bloqueados. |
| `server/handler.ts` | Lógica de `GET /api/token` (clave de acceso, voz, errores). |
| `api/token.ts` | Envoltorio serverless para Vercel. |
| `vite.config.ts` | Envoltorio para el dev server local. |
| `public/mic-worklet.js` | Micro → PCM 16-bit a 16 kHz. |
| `src/audio.ts` | Captura, reproducción a 24 kHz y eco de mármol (reverb por convolución). |
| `src/cards.ts` | Busca en la Wikipedia en inglés y construye la ficha. |
| `src/call.ts` | Orquesta la sesión Live: micro → token → WebSocket → audio, interrupciones, transcripción. |
| `src/main.ts` | Interfaz. |

## Problemas típicos

- **"Falta GEMINI_API_KEY"** o **"Falta ACCESS_CODE"**: falta `.env` (local) o la variable en Vercel.
- **"Permite el micrófono"**: el navegador tiene bloqueado el micro para esta web; actívalo en el candado de la barra de direcciones.
- **"Clave incorrecta"**: la clave escrita al entrar no coincide con `ACCESS_CODE`.
- **429 / quota**: has superado la capa gratuita; espera un minuto o activa facturación.
- **Se oye a sí mismo**: usa cascos.
