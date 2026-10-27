import { Behavior, Type, type FunctionDeclaration } from '@google/genai';

/** Tipos de ficha que Escipión puede mostrar. Compartido con el cliente. */
export const CARD_TYPES = ['personaje', 'lugar', 'mapa', 'batalla', 'cuadro', 'libro', 'objeto', 'concepto'] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const SHOW_IMAGE_TOOL = 'mostrar_imagen';

export interface ShowImageArgs {
  tipo: CardType;
  busqueda: string;
  explicacion: string;
}

export const showImageDeclaration: FunctionDeclaration = {
  name: SHOW_IMAGE_TOOL,
  // No bloqueante: Escipión sigue hablando mientras se carga la ficha, sin pausar el turno
  behavior: Behavior.NON_BLOCKING,
  description:
    'Muestra en la pantalla del alumno una ficha con imagen y resumen sobre algo que estás mencionando: ' +
    'un personaje, lugar, mapa, batalla, cuadro, libro antiguo, objeto o concepto. Úsala a menudo.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      tipo: { type: Type.STRING, enum: [...CARD_TYPES], description: 'Qué clase de cosa es.' },
      busqueda: {
        type: Type.STRING,
        description: 'Title of the English Wikipedia article, e.g. "Battle of Zama".',
      },
      explicacion: {
        type: Type.STRING,
        description: 'One simple sentence in English for the student explaining why it matters.',
      },
    },
    required: ['tipo', 'busqueda', 'explicacion'],
  },
};

export function isShowImageArgs(v: unknown): v is ShowImageArgs {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.busqueda === 'string' &&
    typeof o.explicacion === 'string' &&
    typeof o.tipo === 'string' &&
    (CARD_TYPES as readonly string[]).includes(o.tipo)
  );
}
