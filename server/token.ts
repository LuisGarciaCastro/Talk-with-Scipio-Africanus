import { GoogleGenAI, Modality } from '@google/genai';
import { ESCIPION_SYSTEM_PROMPT } from './persona.js';
import { showImageDeclaration } from './tools.js';

export interface TokenResponse {
  token: string;
  model: string;
}

interface TokenOptions {
  apiKey: string;
  model: string;
  voice: string;
}

/**
 * Crea un token efímero de un solo uso para la Live API.
 * Modelo, voz, system prompt y herramientas quedan bloqueados en el token:
 * el navegador solo puede abrir ESA sesión, con ESE personaje.
 */
export async function createLiveToken({ apiKey, model, voice }: TokenOptions): Promise<TokenResponse> {
  const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } }); // tokens efímeros: solo v1alpha en el SDK
  const now = Date.now();

  const token = await client.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(now + 30 * 60 * 1000).toISOString(), // la llamada dura como mucho 30 min
      newSessionExpireTime: new Date(now + 60 * 1000).toISOString(), // hay 1 min para usarlo
      liveConnectConstraints: {
        model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: ESCIPION_SYSTEM_PROMPT,
          tools: [{ functionDeclarations: [showImageDeclaration] }],
          temperature: 0.8,
          // Sin languageCode: los modelos de audio nativo no lo admiten; el idioma va en el system prompt
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      },
    },
  });

  if (!token.name) throw new Error('La API no devolvió un token');
  return { token: token.name, model };
}
