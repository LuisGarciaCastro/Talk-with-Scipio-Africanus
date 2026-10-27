/** Captura del micrófono → PCM16 16 kHz en base64, listo para la Live API. */
export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;

  /** Crea el contexto de audio. Llamar SIN await previo dentro del click: Safari/iOS lo exige. */
  prepare(): void {
    this.ctx = new AudioContext();
    void this.ctx.resume();
  }

  /** Pide el micrófono (antes de abrir la sesión, para no gastar un token si lo deniegan). */
  async open(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  }

  /** Empieza a mandar trozos de audio. Requiere prepare() y open(). */
  async start(onChunk: (base64Pcm: string) => void): Promise<void> {
    if (!this.ctx || !this.stream) throw new Error('Micrófono no preparado');
    await this.ctx.audioWorklet.addModule('/mic-worklet.js');

    const source = this.ctx.createMediaStreamSource(this.stream);
    // Sin salidas: un nodo sin salidas se procesa siempre, aunque no esté conectado a nada
    this.node = new AudioWorkletNode(this.ctx, 'mic-processor', { numberOfInputs: 1, numberOfOutputs: 0 });
    this.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(arrayBufferToBase64(e.data));

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);
    source.connect(this.node);
  }

  /** Nivel de entrada 0..1, para animar la UI. */
  level(): number {
    return this.analyser ? rms(this.analyser) : 0;
  }

  async stop(): Promise<void> {
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    this.ctx = this.stream = this.node = this.analyser = null;
  }
}

/**
 * Reproduce el audio de Gemini (PCM16 24 kHz) encadenando los trozos sin huecos.
 * `interrupt()` corta todo al instante cuando el usuario habla por encima.
 */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private wet: GainNode | null = null;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();

  /**
   * Cadena: fuente → analyser ─┬─ dry ─────────────→ altavoz
   *                            └─ convolver → wet ─→ altavoz   (eco de atrio de mármol)
   * Llamar SIN await previo dentro del click: Safari/iOS solo deja sonar contextos creados ahí.
   */
  prepare(): void {
    this.ctx = new AudioContext({ sampleRate: 24000 });
    void this.ctx.resume(); // Safari arranca los contextos "suspended"
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;

    const dry = this.ctx.createGain();
    dry.gain.value = 0.9;
    const convolver = this.ctx.createConvolver();
    convolver.buffer = marbleHallImpulse(this.ctx);
    this.wet = this.ctx.createGain();

    this.analyser.connect(dry).connect(this.ctx.destination);
    this.analyser.connect(convolver).connect(this.wet).connect(this.ctx.destination);
    this.wet.gain.value = 0.22; // eco sutil: ambiente sin perder claridad
  }

  play(base64Pcm: string): void {
    if (!this.ctx || !this.analyser) return;
    const int16 = new Int16Array(base64ToArrayBuffer(base64Pcm));
    const buffer = this.ctx.createBuffer(1, int16.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < int16.length; i++) channel[i] = (int16[i] ?? 0) / 0x8000;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.analyser);
    this.nextTime = Math.max(this.nextTime, this.ctx.currentTime + 0.05);
    src.start(this.nextTime);
    this.nextTime += buffer.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  interrupt(): void {
    this.sources.forEach((s) => s.stop());
    this.sources.clear();
    this.nextTime = 0;
  }

  get isPlaying(): boolean {
    return this.sources.size > 0;
  }

  level(): number {
    return this.analyser ? rms(this.analyser) : 0;
  }

  async stop(): Promise<void> {
    this.interrupt();
    await this.ctx?.close();
    this.ctx = this.analyser = this.wet = null;
  }
}

/**
 * Respuesta al impulso sintética de una sala de piedra: ruido estéreo con
 * caída exponencial (~2,8 s) y un pequeño pre-delay. Sin archivos externos.
 */
function marbleHallImpulse(ctx: BaseAudioContext): AudioBuffer {
  const seconds = 2.8;
  const preDelay = Math.floor(0.03 * ctx.sampleRate);
  const length = Math.floor(seconds * ctx.sampleRate);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / (length - preDelay);
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.5);
    }
  }
  return impulse;
}

function rms(analyser: AnalyserNode): number {
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (const v of data) sum += ((v - 128) / 128) ** 2;
  return Math.min(1, Math.sqrt(sum / data.length) * 4);
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
