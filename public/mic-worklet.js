// AudioWorklet: corre en el hilo de audio. Recibe el micro a la frecuencia
// nativa (44.1/48 kHz), lo remuestrea a 16 kHz, lo convierte a PCM 16-bit y
// envía bloques de ~100 ms al hilo principal.
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.ratio = sampleRate / this.targetRate; // sampleRate es global en el worklet
    this.pos = 0; // posición fraccional en la entrada
    this.prev = 0; // última muestra del bloque anterior (para interpolar)
    this.chunk = new Int16Array(1600); // 100 ms a 16 kHz
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;

    // Remuestreo por interpolación lineal
    while (this.pos < input.length) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = i === 0 ? this.prev : input[i - 1];
      const b = input[i];
      const s = Math.max(-1, Math.min(1, a + (b - a) * frac));
      this.chunk[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === this.chunk.length) {
        this.port.postMessage(this.chunk.buffer.slice(0));
        this.filled = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= input.length;
    this.prev = input[input.length - 1];
    return true;
  }
}

registerProcessor('mic-processor', MicProcessor);
