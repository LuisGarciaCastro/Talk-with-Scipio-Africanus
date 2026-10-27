import { GoogleGenAI, type LiveServerMessage, type Session } from '@google/genai';
import { isShowImageArgs, SHOW_IMAGE_TOOL, type ShowImageArgs } from '../server/tools.js';
import { MicCapture, PcmPlayer } from './audio';

export type CallStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'ended' | 'error';
export type Speaker = 'tu' | 'escipion';

export interface CallEvents {
  onStatus: (status: CallStatus, detail?: string) => void;
  /** Texto transcrito en vivo. `final` = el turno ha terminado. */
  onTranscript: (speaker: Speaker, text: string, final: boolean) => void;
  /** Escipión quiere enseñar una imagen (personaje, mapa, cuadro...). */
  onShowImage: (args: ShowImageArgs) => void;
}

export interface CallOptions {
  /** Clave del enlace compartido (?clave=...), si el servidor la exige. */
  accessCode: string | null;
}

interface TokenResponse {
  token?: string;
  model?: string;
  error?: string;
}

/** Orquesta una llamada: token → sesión Live → micro ⇄ altavoz. */
export class EscipionCall {
  private session: Session | null = null;
  private mic = new MicCapture();
  private player = new PcmPlayer();
  private userText = '';
  private botText = '';

  constructor(private readonly events: CallEvents) {}

  async start(options: CallOptions): Promise<void> {
    this.events.onStatus('connecting');
    try {
      const { token, model } = await fetchToken(options);
      await this.player.start(); // dentro del click del usuario, por la política de autoplay

      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
      this.session = await ai.live.connect({
        model,
        callbacks: {
          onopen: () => this.events.onStatus('listening'),
          onmessage: (msg) => this.handleMessage(msg),
          onerror: (e) => this.fail(e.message || 'Error de conexión'),
          onclose: (e) => {
            if (this.session) this.events.onStatus('ended', e.reason || undefined);
            void this.cleanup();
          },
        },
      });

      await this.mic.start((data) => {
        this.session?.sendRealtimeInput({ audio: { data, mimeType: 'audio/pcm;rate=16000' } });
      });

      // Que sea Escipión quien salude primero
      this.session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: '(Un alumno acaba de llegar a tu villa para aprender sobre ti. Salúdale brevemente, preséntate, muéstrale tu retrato con la herramienta y pregúntale su nombre.)' }] }],
        turnComplete: true,
      });
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
    }
  }

  async hangUp(): Promise<void> {
    const s = this.session;
    this.session = null;
    s?.close();
    await this.cleanup();
    this.events.onStatus('ended');
  }

  /** Niveles 0..1 para la animación. */
  levels(): { mic: number; bot: number } {
    return { mic: this.mic.level(), bot: this.player.level() };
  }

  private handleMessage(msg: LiveServerMessage): void {
    if (msg.toolCall) this.handleToolCall(msg);
    const content = msg.serverContent;
    if (!content) return;

    if (content.interrupted) {
      this.player.interrupt(); // el usuario ha hablado por encima: callamos a Escipión
      this.flushBot();
    }

    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        this.player.play(part.inlineData.data);
        this.events.onStatus('speaking');
      }
    }

    if (content.inputTranscription?.text) {
      this.userText += content.inputTranscription.text;
      this.events.onTranscript('tu', this.userText, false);
    }
    if (content.outputTranscription?.text) {
      if (this.userText) this.flushUser(); // empieza a responder: cerramos lo que dijiste tú
      this.botText += content.outputTranscription.text;
      this.events.onTranscript('escipion', this.botText, false);
    }

    if (content.turnComplete) {
      this.flushUser();
      this.flushBot();
      this.waitUntilSilentThenListen();
    }
  }

  /**
   * Escipión pide mostrar una imagen. Respondemos AL INSTANTE para que no se
   * quede callado esperando, y la ficha se carga en paralelo en la UI.
   */
  private handleToolCall(msg: LiveServerMessage): void {
    const calls = msg.toolCall?.functionCalls ?? [];
    const functionResponses = calls.map((call) => {
      const args: unknown = call.args;
      const ok = call.name === SHOW_IMAGE_TOOL && isShowImageArgs(args);
      if (ok) this.events.onShowImage(args);
      return {
        id: call.id,
        name: call.name,
        response: ok ? { output: 'Imagen mostrada al alumno. Sigue hablando.' } : { error: 'Herramienta o argumentos no válidos' },
      };
    });
    if (functionResponses.length) this.session?.sendToolResponse({ functionResponses });
  }

  private flushUser(): void {
    if (this.userText) this.events.onTranscript('tu', this.userText, true);
    this.userText = '';
  }

  private flushBot(): void {
    if (this.botText) this.events.onTranscript('escipion', this.botText, true);
    this.botText = '';
  }

  private waitUntilSilentThenListen(): void {
    const tick = () => {
      if (!this.session) return;
      if (this.player.isPlaying) setTimeout(tick, 150);
      else this.events.onStatus('listening');
    };
    tick();
  }

  private fail(message: string): void {
    this.events.onStatus('error', message);
    const s = this.session;
    this.session = null;
    s?.close();
    void this.cleanup();
  }

  private async cleanup(): Promise<void> {
    await Promise.allSettled([this.mic.stop(), this.player.stop()]);
  }
}

async function fetchToken({ accessCode }: CallOptions): Promise<{ token: string; model: string }> {
  const params = new URLSearchParams();
  if (accessCode) params.set('clave', accessCode);
  const res = await fetch(`/api/token?${params}`);
  const body = (await res.json()) as TokenResponse;
  if (!res.ok || !body.token || !body.model) throw new Error(body.error ?? `Error ${res.status} pidiendo token`);
  return { token: body.token, model: body.model };
}
