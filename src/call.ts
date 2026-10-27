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
  /** El servidor ha rechazado la clave (p. ej. porque el profesor la ha cambiado). */
  onAccessDenied: (message: string) => void;
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

/** Cabecera de la clave; la misma que ACCESS_HEADER en server/handler.ts. */
const ACCESS_HEADER = 'X-Access-Code';

class AccessDeniedError extends Error {}

/** Orquesta una llamada: micro → token → sesión Live → micro ⇄ altavoz. */
export class EscipionCall {
  private session: Session | null = null;
  private mic = new MicCapture();
  private player = new PcmPlayer();
  /** true en cuanto la llamada termina por cualquier motivo: lo que llegue después se descarta. */
  private stopped = false;
  private userText = '';
  private botText = '';
  private spokeThisTurn = false;
  private pendingCalls: { id?: string; name?: string }[] = [];

  constructor(private readonly events: CallEvents) {}

  /** Llamar directamente desde el click (sin await antes): crea ahí los contextos de audio. */
  async start(options: CallOptions): Promise<void> {
    this.events.onStatus('connecting');
    this.player.prepare();
    this.mic.prepare();
    try {
      await this.mic.open();
      if (this.stopped) return void this.cleanup();

      const { token, model } = await fetchToken(options);
      if (this.stopped) return;

      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
      const session = await ai.live.connect({
        model,
        callbacks: {
          onmessage: (msg) => this.handleMessage(msg),
          onerror: (e) => this.finish('error', e.message || 'Error de conexión'),
          onclose: (e) => {
            // Antes de quedar lista es un fallo (cuota, token, modelo...); después, fin normal
            if (this.session) this.finish('ended', e.reason || undefined);
            else this.finish('error', e.reason || 'No se pudo conectar con Escipión');
          },
        },
      });
      if (this.stopped) return void session.close();
      this.session = session;

      await this.mic.start((data) => {
        this.session?.sendRealtimeInput({ audio: { data, mimeType: 'audio/pcm;rate=16000' } });
      });
      if (this.stopped) return void this.cleanup();
      this.events.onStatus('listening', 'salúdale para empezar'); // Escipión espera a que hable el alumno
    } catch (err) {
      if (err instanceof AccessDeniedError) this.events.onAccessDenied(err.message);
      this.finish('error', friendlyError(err));
    }
  }

  hangUp(): void {
    this.finish('ended');
  }

  /** Niveles 0..1 para la animación. */
  levels(): { mic: number; bot: number } {
    return { mic: this.mic.level(), bot: this.player.level() };
  }

  /** Único punto de salida: cierra la sesión, suelta micro y altavoz y avisa una sola vez. */
  private finish(status: 'ended' | 'error', detail?: string): void {
    if (this.stopped) return;
    this.stopped = true;
    const s = this.session;
    this.session = null;
    s?.close();
    void this.cleanup();
    this.events.onStatus(status, detail);
  }

  private handleMessage(msg: LiveServerMessage): void {
    if (this.stopped) return;
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

    // Cada uno en su burbuja: la transcripción del alumno puede llegar tarde, ya con Escipión hablando
    if (content.inputTranscription?.text) {
      this.userText += content.inputTranscription.text;
      this.events.onTranscript('tu', this.userText, false);
    }
    if (content.outputTranscription?.text) {
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
    const functionResponses = this.pendingCalls.map((c) => ({ ...c, response: { output: 'Card shown. Go on.' } }));
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
      if (this.stopped) return;
      if (this.player.isPlaying) setTimeout(tick, 150);
      else this.events.onStatus('listening');
    };
    tick();
  }

  private async cleanup(): Promise<void> {
    await Promise.allSettled([this.mic.stop(), this.player.stop()]);
  }
}

async function fetchToken({ accessCode }: CallOptions): Promise<{ token: string; model: string }> {
  const res = await fetch('/api/token', { headers: accessCode ? { [ACCESS_HEADER]: accessCode } : {} });
  // Si Vercel devuelve una página de error en HTML, que no salga "Unexpected token <"
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  const message = body.error ?? `Error ${res.status} pidiendo token`;
  if (res.status === 401) throw new AccessDeniedError(message);
  if (!res.ok || !body.token || !body.model) throw new Error(message);
  return { token: body.token, model: body.model };
}

/** Traduce los errores del navegador a algo que entienda un alumno. */
function friendlyError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'Permite el micrófono para hablar con Escipión';
    if (err.name === 'NotFoundError') return 'No se encuentra ningún micrófono';
  }
  return err instanceof Error ? err.message : String(err);
}
