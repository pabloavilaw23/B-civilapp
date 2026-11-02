/**
 * plantillas.js
 * Catálogo de tipos de documento y generación determinista de
 * borradores a partir de plantillas predefinidas y datos de ejemplo.
 *
 * No genera contenido con inteligencia artificial ni se conecta con
 * ningún backend: el borrador se arma combinando texto fijo con los
 * datos que la persona seleccionó en el asistente guiado.
 */

import { formatDisplayDate } from '../utils/fechas.js';

export const DOCUMENT_TYPES = [
  {
    id: 'informe-avance',
    label: 'Informe de avance',
    description: 'Resume el progreso de obra durante un período determinado.',
    needsPeriod: true,
  },
  {
    id: 'acta-reunion',
    label: 'Acta de reunión',
    description: 'Registra los temas tratados y los compromisos de una reunión de obra.',
    needsPeriod: false,
  },
  {
    id: 'informe-incidencia',
    label: 'Informe de incidencia',
    description: 'Documenta una novedad o incidencia relevante del proyecto.',
    needsPeriod: true,
  },
];

/**
 * @param {string} id
 * @returns {object|null}
 */
export function getDocumentType(id) {
  return DOCUMENT_TYPES.find((tipo) => tipo.id === id) || null;
}

const PERIOD_LABELS = {
  semana: 'la última semana',
  mes: 'el último mes',
  todo: 'todo el período registrado',
};

// Datos de ejemplo, consistentes con los usados en el dashboard y la
// bitácora de demostración. No provienen de ninguna fuente real.
const DEMO_ACTIVITY = [
  'Se completó la fundición de la losa del piso 4.',
  'Avance de mampostería en fachada norte, tercer nivel.',
  'Encofrado de columnas listo para fundición, eje B.',
  'Se completó la instalación eléctrica provisional para las plantas 1 y 2.',
];

const DEMO_INCIDENCIA = 'Filtración menor reportada en el muro perimetral sur. Se notificó al '
  + 'equipo de impermeabilizaciones. (Ejemplo tomado de la bitácora del proyecto.)';

function formatToday() {
  return formatDisplayDate(new Date());
}

function buildHeader(proyectoNombre, tituloDocumento) {
  return `${tituloDocumento.toUpperCase()}\n`
    + `Proyecto: ${proyectoNombre}\n`
    + `Fecha de generación: ${formatToday()}\n`
    + '----------------------------------------\n\n';
}

function buildInstructionsNote(instrucciones) {
  if (!instrucciones) {
    return '';
  }
  return `\nInstrucciones consideradas para este borrador:\n${instrucciones}\n`;
}

function buildInformeAvance({ proyectoNombre, periodoLabel, instrucciones }) {
  let body = buildHeader(proyectoNombre, 'Informe de avance de obra');
  body += `Este informe resume el avance registrado durante ${periodoLabel} en el proyecto `
    + `${proyectoNombre}.\n\n`;
  body += 'Actividades registradas:\n';
  DEMO_ACTIVITY.forEach((item) => {
    body += `- ${item}\n`;
  });
  body += '\nObservaciones generales:\nEl avance reportado corresponde a registros de ejemplo '
    + 'de la bitácora del proyecto. Este borrador debe complementarse y revisarse antes de su '
    + 'uso.\n';
  body += buildInstructionsNote(instrucciones);
  return body;
}

function buildActaReunion({ proyectoNombre, instrucciones }) {
  let body = buildHeader(proyectoNombre, 'Acta de reunión');
  body += `Proyecto: ${proyectoNombre}\n`
    + `Fecha de la reunión: ${formatToday()}\n`
    + 'Asistentes: (completar)\n\n';
  body += 'Temas tratados:\n1. (completar)\n2. (completar)\n\n';
  body += 'Compromisos y responsables:\n- (completar)\n';
  body += buildInstructionsNote(instrucciones);
  return body;
}

function buildInformeIncidencia({ proyectoNombre, periodoLabel, instrucciones }) {
  let body = buildHeader(proyectoNombre, 'Informe de incidencia');
  body += `Se documenta una incidencia identificada durante ${periodoLabel} en el proyecto `
    + `${proyectoNombre}.\n\n`;
  body += `Descripción de la incidencia:\n${DEMO_INCIDENCIA}\n\n`;
  body += 'Acciones tomadas:\n- (completar)\n\nSeguimiento requerido:\n- (completar)\n';
  body += buildInstructionsNote(instrucciones);
  return body;
}

const BUILDERS = {
  'informe-avance': buildInformeAvance,
  'acta-reunion': buildActaReunion,
  'informe-incidencia': buildInformeIncidencia,
};

/**
 * Genera el texto de un borrador de documento de forma determinista,
 * combinando una plantilla fija con los datos seleccionados en el
 * asistente. No utiliza inteligencia artificial ni servicios externos.
 * @param {{tipoId: string, proyectoNombre: string, periodo: string, instrucciones: string}} params
 * @returns {string}
 */
export function buildDraft({
  tipoId, proyectoNombre, periodo, instrucciones,
}) {
  const builder = BUILDERS[tipoId];
  if (!builder) {
    return '';
  }
  const periodoLabel = PERIOD_LABELS[periodo] || PERIOD_LABELS.todo;
  return builder({ proyectoNombre, periodoLabel, instrucciones });
}
