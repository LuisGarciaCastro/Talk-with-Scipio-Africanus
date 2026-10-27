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

// Clave del enlace compartido: https://.../?clave=xxxx
const accessCode = new URLSearchParams(location.search).get('clave');

const STATUS_TEXT: Record<CallStatus, string> = {
  idle: 'Pulsa para hablar con Escipión',
  connecting: 'Mandando un mensajero a Liternum…',
  listening: 'Escipión te escucha',
  speaking: 'Escipión habla',
  ended: 'Llamada terminada',
  error: 'Algo ha fallado',
};

let call: EscipionCall | null = null;
let live: { speaker: Speaker; el: HTMLParagraphElement } | null = null;
let raf = 0;
const cards: Card[] = [];

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
  if (!live || live.speaker !== speaker) {
    const el = document.createElement('p');
    el.className = `line ${speaker}`;
    transcript.append(el);
    live = { speaker, el };
  }
  live.el.textContent = text.trim();
  transcript.scrollTop = transcript.scrollHeight;
  if (final) live = null;
}

// ── Fichas visuales ─────────────────────────────────────────────────────
async function onShowImage(args: ShowImageArgs): Promise<void> {
  renderLoading(args);
  const card = await buildCard(args);
  cards.push(card);
  renderCard(card);
  renderGallery(cards.length - 1);
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
    a.rel = 'noopener';
    a.className = 'card-link';
    a.textContent = 'Leer más en Wikipedia ↗';
    body.append(a);
  }
  cardEl.replaceChildren(media, body);
}

function renderGallery(activeIndex: number): void {
  gallery.replaceChildren(
    ...cards.map((card, i) => {
      const b = document.createElement('button');
      b.className = `thumb${i === activeIndex ? ' active' : ''}`;
      b.title = card.title;
      b.setAttribute('aria-label', `Ver ${card.title}`);
      if (card.image) b.style.backgroundImage = `url("${card.image}")`;
      else b.textContent = card.title.slice(0, 2);
      b.addEventListener('click', () => {
        renderCard(card);
        renderGallery(i);
      });
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
  if (call) {
    await call.hangUp();
    return;
  }
  transcript.replaceChildren();
  live = null;
  call = new EscipionCall({ onStatus: setStatus, onTranscript, onShowImage: (a) => void onShowImage(a) });
  raf = requestAnimationFrame(animate);
  await call.start({ accessCode });
});

// Modo demo para ver la tablilla sin llamar: http://localhost:5173/?demo
if (new URLSearchParams(location.search).has('demo')) {
  void onShowImage({ tipo: 'personaje', busqueda: 'Escipión el Africano', explicacion: 'Este soy yo: el general que venció a Aníbal.' })
    .then(() => onShowImage({ tipo: 'batalla', busqueda: 'Batalla de Zama', explicacion: 'Aquí terminó la segunda guerra púnica, en el 202 a.C.' }))
    .then(() => onShowImage({ tipo: 'mapa', busqueda: 'Segunda guerra púnica', explicacion: 'El Mediterráneo en guerra: Roma contra Cartago.' }));
}
