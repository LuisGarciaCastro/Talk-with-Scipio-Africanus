import type { ShowImageArgs } from '../server/tools.js';
import { EscipionCall, type CallStatus, type Speaker } from './call';
import { buildCard, TYPE_LABEL, type Card } from './cards';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta #${id}`);
  return el as T;
};

const btn = $<HTMLButtonElement>('callBtn');
const statusEl = $('status');
const ring = $('ring');
const transcript = $('transcript');
const cardEl = $('card');
const gallery = $('gallery');

const gate = $<HTMLFormElement>('gate');
const gateInput = $<HTMLInputElement>('gateInput');
const gateError = $('gateError');
const app = $('app');

// ── Clave de acceso: se pide al entrar y se recuerda en este navegador ──
const ACCESS_KEY = 'escipion-clave';
let accessCode: string | null = null;

function savedCode(): string | null {
  try {
    return localStorage.getItem(ACCESS_KEY);
  } catch {
    return null;
  }
}

function saveCode(code: string | null): void {
  try {
    if (code) localStorage.setItem(ACCESS_KEY, code);
    else localStorage.removeItem(ACCESS_KEY);
  } catch {
    // sin almacenamiento: se volverá a pedir la próxima vez
  }
}

interface CheckResult {
  ok: boolean;
  /** true solo si el servidor dice que la clave es incorrecta (401), no por un fallo de red. */
  wrongCode: boolean;
  error: string;
}

/** Valida la clave sin gastar un token. Va en una cabecera para que no quede en los logs. */
async function checkCode(code: string | null): Promise<CheckResult> {
  try {
    const res = await fetch('/api/token?comprobar', { headers: code ? { 'X-Access-Code': code } : {} });
    if (res.ok) return { ok: true, wrongCode: false, error: '' };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, wrongCode: res.status === 401, error: body.error ?? `Error ${res.status}` };
  } catch {
    return { ok: false, wrongCode: false, error: 'No se pudo contactar con el servidor. Vuelve a intentarlo.' };
  }
}

function unlock(code: string | null): void {
  accessCode = code;
  saveCode(code);
  gate.hidden = true;
  app.hidden = false;
}

/** Muestra la pantalla de la clave. Solo olvida la guardada si el servidor la ha rechazado. */
function lock(message = '', forget = true): void {
  if (forget) saveCode(null);
  app.hidden = true;
  gate.hidden = false;
  gateError.textContent = message;
  gateInput.focus();
}

gate.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = gateInput.value.trim();
  gateError.textContent = '';
  const result = await checkCode(code);
  if (result.ok) {
    unlock(code);
  } else {
    gateError.textContent = result.error;
    gateInput.select();
  }
});

// Al cargar: prueba la clave recordada (o la de un enlace antiguo con ?clave=)
async function initGate(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const candidate = params.get('clave') ?? savedCode();
  if (params.has('clave')) {
    params.delete('clave');
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  }
  const result = await checkCode(candidate);
  if (result.ok) return unlock(candidate);
  if (!result.wrongCode && candidate) gateInput.value = candidate; // fallo de red: basta con pulsar Entrar
  lock(candidate ? result.error : '', result.wrongCode);
}
void initGate();

const STATUS_TEXT: Record<CallStatus, string> = {
  idle: 'Pulsa para hablar con Escipión',
  connecting: 'Mandando un mensajero a Liternum…',
  listening: 'Escipión te escucha',
  speaking: 'Escipión habla',
  ended: 'Llamada terminada',
  error: 'Algo ha fallado',
};

let call: EscipionCall | null = null;
/** Burbuja abierta de cada uno: el texto del alumno puede seguir llegando mientras habla Escipión. */
const live: Record<Speaker, HTMLParagraphElement | null> = { tu: null, escipion: null };
let raf = 0;
const cards: Card[] = [];
let shown = -1; // índice de la ficha que se está viendo
let latestRequest = 0;

// ── Estado de la llamada ────────────────────────────────────────────────
function setStatus(status: CallStatus, detail?: string): void {
  statusEl.textContent = detail ? `${STATUS_TEXT[status]}: ${detail}` : STATUS_TEXT[status];
  document.body.dataset.status = status;
  const active = status === 'connecting' || status === 'listening' || status === 'speaking';
  btn.textContent = active ? 'Colgar' : 'Llamar';
  btn.classList.toggle('hangup', active);
  if (!active) {
    cancelAnimationFrame(raf);
    call = null;
  }
}

// ── Transcripción ───────────────────────────────────────────────────────
function onTranscript(speaker: Speaker, text: string, final: boolean): void {
  let line = live[speaker];
  if (!line) {
    line = document.createElement('p');
    line.className = `line ${speaker}`;
    transcript.append(line);
    live[speaker] = line;
  }
  line.textContent = text.trim();
  transcript.scrollTop = transcript.scrollHeight;
  if (final) live[speaker] = null;
}

// ── Fichas visuales ─────────────────────────────────────────────────────
/**
 * Reserva el hueco en la galería al pedir la ficha, para que el orden sea el
 * de Escipión aunque Wikipedia conteste desordenado, y solo enseña la ficha
 * si sigue siendo la última que ha pedido.
 */
async function onShowImage(args: ShowImageArgs): Promise<void> {
  const request = ++latestRequest;
  const index = cards.push({ tipo: args.tipo, explicacion: args.explicacion, title: args.busqueda, extract: '', image: null, url: null }) - 1;
  renderLoading(args);
  const card = await buildCard(args);
  cards[index] = card;
  if (request === latestRequest) show(index);
  else renderGallery();
}

function show(index: number): void {
  const card = cards[index];
  if (!card) return;
  shown = index;
  renderCard(card);
  renderGallery();
}

function renderLoading(args: ShowImageArgs): void {
  cardEl.replaceChildren(
    el('div', 'card-media loading'),
    el('div', 'card-body', [
      el('span', 'badge', TYPE_LABEL[args.tipo]),
      el('h2', 'card-title', args.busqueda),
      el('p', 'card-why', args.explicacion),
    ]),
  );
}

function renderCard(card: Card): void {
  const media = el('div', 'card-media');
  if (card.image) {
    const img = document.createElement('img');
    img.src = card.image;
    img.alt = card.title;
    img.loading = 'eager';
    media.append(img);
  } else {
    media.append(el('span', 'no-image', 'SPQR'));
  }

  const body = el('div', 'card-body', [
    el('span', 'badge', TYPE_LABEL[card.tipo]),
    el('h2', 'card-title', card.title),
    el('p', 'card-why', card.explicacion),
  ]);
  if (card.extract) body.append(el('p', 'card-extract', card.extract));
  if (card.url) {
    const a = document.createElement('a');
    a.href = card.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'card-link';
    a.textContent = 'Leer más en Wikipedia ↗';
    body.append(a);
  }
  cardEl.replaceChildren(media, body);
}

function renderGallery(): void {
  gallery.replaceChildren(
    ...cards.map((card, i) => {
      const b = document.createElement('button');
      b.className = `thumb${i === shown ? ' active' : ''}`;
      b.title = card.title;
      b.setAttribute('aria-label', `Ver ${card.title}`);
      if (card.image) b.style.backgroundImage = `url(${JSON.stringify(card.image)})`; // URL entre comillas escapadas
      else b.textContent = card.title.slice(0, 2);
      b.addEventListener('click', () => show(i));
      return b;
    }),
  );
  gallery.scrollTo({ left: gallery.scrollWidth, behavior: 'smooth' }); // sin mover la página
}

function el(tag: string, className: string, content?: string | Node[]): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (typeof content === 'string') node.textContent = content;
  else if (content) node.append(...content);
  return node;
}

// ── Animación del medallón ──────────────────────────────────────────────
function animate(): void {
  if (!call) return;
  const { mic, bot } = call.levels();
  const level = Math.max(mic, bot);
  ring.style.transform = `scale(${1 + level * 0.35})`;
  ring.style.opacity = String(0.35 + level * 0.65);
  raf = requestAnimationFrame(animate);
}

btn.addEventListener('click', async () => {
  if (call) return call.hangUp(); // también vale mientras conecta
  transcript.replaceChildren();
  live.tu = live.escipion = null;
  // Los eventos de una llamada que ya no es la actual (p. ej. un error tardío) se ignoran
  const current: EscipionCall = new EscipionCall({
    onStatus: (s, d) => call === current && setStatus(s, d),
    onTranscript: (s, t, f) => call === current && onTranscript(s, t, f),
    onShowImage: (a) => call === current && void onShowImage(a),
    onAccessDenied: (message) => lock(message), // la clave ha cambiado
  });
  call = current;
  raf = requestAnimationFrame(animate);
  await current.start({ accessCode }); // sin await antes: el audio se prepara dentro del click
});

// Modo demo para ver la tablilla sin llamar: http://localhost:5173/?demo
if (new URLSearchParams(location.search).has('demo')) {
  void onShowImage({ tipo: 'personaje', busqueda: 'Scipio Africanus', explicacion: 'This is me: the general who defeated Hannibal.' })
    .then(() => onShowImage({ tipo: 'batalla', busqueda: 'Battle of Zama', explicacion: 'Here the Second Punic War ended, in 202 BC.' }))
    .then(() => onShowImage({ tipo: 'mapa', busqueda: 'Second Punic War', explicacion: 'The Mediterranean at war: Rome against Carthage.' }));
}
