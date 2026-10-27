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
  /** Clave de acceso introducida al entrar, si el servidor la exige. */
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
  private spokeThisTurn = false;
  private pendingCalls: { id?: string; name?: string }[] = [];

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
          onopen: () => this.events.onStatus('listening', 'salúdale para empezar'), // Escipión espera a que hable el alumno
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
      this.pendingCalls = []; // y no le damos pie a retomar la palabra
      this.flushBot();
    }

    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        this.spokeThisTurn = true;
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
      // Si enseñó una ficha y cerró el turno sin decir nada, la respuesta le da pie a hablar
      if (!this.spokeThisTurn && this.pendingCalls.length) this.answerPendingCalls();
      else this.pendingCalls = [];
      this.spokeThisTurn = false;
      this.waitUntilSilentThenListen();
    }
  }

  /**
   * Escipión pide mostrar una imagen. La herramienta es no bloqueante y en
   * principio NO respondemos: con gemini-3.8-live cualquier respuesta (incluso
   * en SILENT) provoca un turno extra en el que repite lo dicho o habla por
   * encima del alumno. Guardamos las llamadas por si el turno acaba sin que
   * haya dicho nada (ver handleMessage).
   */
  private handleToolCall(msg: LiveServerMessage): void {
    for (const call of msg.toolCall?.functionCalls ?? []) {
      const args: unknown = call.args;
      if (call.name === SHOW_IMAGE_TOOL && isShowImageArgs(args)) this.events.onShowImage(args);
      this.pendingCalls.push({ id: call.id, name: call.name });
    }
  }

  /** Respondemos a las fichas pendientes para que Escipión siga hablando. */
  private answerPendingCalls(): void {
    const functionResponses = this.pendingCalls.map((c) => ({ ...c, response: { output: 'Ficha mostrada. Continúa.' } }));
    this.pendingCalls = [];
    this.session?.sendToolResponse({ functionResponses });
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
