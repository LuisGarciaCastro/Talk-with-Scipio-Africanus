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
}

interface WikiResponse {
  query?: { pages?: Record<string, WikiPage> };
}

/**
 * Busca en Wikipedia (sin API key, CORS abierto con origin=*) y devuelve
 * título, resumen corto, imagen principal y enlace del mejor resultado.
 */
async function searchWikipedia(lang: 'es' | 'en', query: string): Promise<WikiPage | null> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    redirects: '1',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '1',
    prop: 'pageimages|extracts|info',
    piprop: 'thumbnail',
    pithumbsize: '900',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
    inprop: 'url',
  });
  try {
    const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`);
    if (!res.ok) return null;
    const data = (await res.json()) as WikiResponse;
    const pages = Object.values(data.query?.pages ?? {});
    return pages[0] ?? null;
  } catch {
    return null;
  }
}

export async function buildCard(args: ShowImageArgs): Promise<Card> {
  // Escipión habla en inglés: la ficha sale de la Wikipedia en inglés
  const page = await searchWikipedia('en', args.busqueda);
  // Si el artículo en inglés no tiene imagen (p. ej. "Battle of Zama"), la pedimos a la Wikipedia en español
  const image = page?.thumbnail?.source ?? (await searchWikipedia('es', page?.title ?? args.busqueda))?.thumbnail?.source ?? null;

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
