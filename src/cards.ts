import type { CardType, ShowImageArgs } from '../server/tools.js';

export interface Card {
  tipo: CardType;
  explicacion: string;
  title: string;
  extract: string;
  image: string | null;
  url: string | null;
}

interface WikiPage {
  title: string;
  extract?: string;
  fullurl?: string;
  thumbnail?: { source: string };
  langlinks?: { lang: string; '*': string }[];
}

interface WikiResponse {
  query?: { pages?: Record<string, WikiPage> };
}

/** Consulta la API de Wikipedia (sin API key, CORS abierto con origin=*). Si tarda o falla, null. */
async function queryWikipedia(lang: 'es' | 'en', params: Record<string, string>): Promise<WikiPage | null> {
  const query = new URLSearchParams({ action: 'query', format: 'json', origin: '*', ...params });
  try {
    // Con la wifi del cole atascada, mejor una ficha sin datos que una cargando para siempre
    const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${query}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = (await res.json()) as WikiResponse;
    return Object.values(data.query?.pages ?? {})[0] ?? null;
  } catch {
    return null;
  }
}

/** Mejor resultado de la búsqueda en inglés: título, resumen, imagen, enlace y título en español. */
function searchEnglish(search: string): Promise<WikiPage | null> {
  return queryWikipedia('en', {
    generator: 'search',
    gsrsearch: search,
    gsrlimit: '1',
    prop: 'pageimages|extracts|info|langlinks',
    piprop: 'thumbnail',
    pithumbsize: '900',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
    inprop: 'url',
    lllang: 'es',
  });
}

/** Imagen del artículo equivalente en español, buscado por su título exacto. */
async function spanishImage(page: WikiPage): Promise<string | null> {
  const title = page.langlinks?.[0]?.['*'];
  if (!title) return null;
  const es = await queryWikipedia('es', { titles: title, prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '900' });
  return es?.thumbnail?.source ?? null;
}

export async function buildCard(args: ShowImageArgs): Promise<Card> {
  // Escipión habla en inglés: la ficha sale de la Wikipedia en inglés
  const page = await searchEnglish(args.busqueda);
  // Si el artículo no tiene imagen (p. ej. "Battle of Zama"), la del mismo artículo en español
  const image = page ? (page.thumbnail?.source ?? (await spanishImage(page))) : null;

  return {
    tipo: args.tipo,
    explicacion: args.explicacion,
    title: page?.title ?? args.busqueda,
    extract: page?.extract ?? '',
    image,
    url: page?.fullurl ?? null,
  };
}

export const TYPE_LABEL: Record<CardType, string> = {
  personaje: 'Personaje',
  lugar: 'Lugar',
  mapa: 'Mapa',
  batalla: 'Batalla',
  cuadro: 'Obra de arte',
  libro: 'Fuente / libro',
  objeto: 'Objeto',
  concepto: 'Concepto',
};
