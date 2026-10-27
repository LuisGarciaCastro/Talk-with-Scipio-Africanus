# Habla con Escipión 🏛️

App educativa: el alumno conversa por voz con Escipión el Africano (Gemini Live API) y, mientras habla, Escipión le va mostrando retratos, mapas, batallas, cuadros y libros (fichas de Wikipedia).

Para ver la tablilla de imágenes sin llamar: `http://localhost:5173/?demo`

## Arrancar en local (macOS)

```bash
cd escipion-live
npm install
cp .env.example .env      # y pega tu GEMINI_API_KEY de https://aistudio.google.com/apikey
npm run dev               # abre http://localhost:5173
```

Usa Chrome o Safari, acepta el micrófono y **ponte cascos**.

## Publicarlo con un enlace (Vercel, gratis)

1. **Sube el proyecto a GitHub** (repo privado):
   ```bash
   git init && git add . && git commit -m "Escipión Live"
   gh repo create escipion-live --private --source=. --push
   ```
   (`.env` está en `.gitignore`: tu key no se sube.)
2. Entra en https://vercel.com con tu cuenta de GitHub → **Add New… → Project** → importa `escipion-live`. Vercel detecta Vite solo.
3. Antes de pulsar Deploy, en **Environment Variables** añade:
   - `GEMINI_API_KEY` = tu key
   - `ACCESS_CODE` = una palabra secreta, p. ej. `ave-scipio`
   - (opcional) `GEMINI_LIVE_MODEL` y `GEMINI_VOICE` (voz fija, por defecto `Charon`)
4. **Deploy**. Te dará una URL tipo `https://escipion-live.vercel.app`.
5. Pasa a tus alumnos el enlace **con la clave**:
   `https://escipion-live.vercel.app/?clave=ave-scipio`

Sin la clave, la app no da tokens: así nadie que encuentre la URL gasta tu cuota.
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
| `src/cards.ts` | Busca en Wikipedia (es, con imagen de en si falta) y construye la ficha. |
| `src/call.ts` | Orquesta la sesión Live: token → WebSocket → audio, interrupciones, transcripción. |
| `src/main.ts` | Interfaz. |

## Problemas típicos

- **"Falta GEMINI_API_KEY"**: falta `.env` (local) o la variable en Vercel.
- **"Clave incorrecta"**: el enlace no lleva `?clave=` o no coincide con `ACCESS_CODE`.
- **429 / quota**: has superado la capa gratuita; espera un minuto o activa facturación.
- **Se oye a sí mismo**: usa cascos.
