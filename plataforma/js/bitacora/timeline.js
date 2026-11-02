/**
 * timeline.js
 * Carga real de los registros de la bitácora desde Supabase (tabla
 * "bitacora_entries", filtrados por proyecto y usuario mediante RLS),
 * agrupación por día, filtros visuales, búsqueda, selección de
 * período y apertura del panel de detalle.
 *
 * EXPORTAR BITÁCORA: reutiliza el mismo selector de período que ya
 * existe (Última semana / Último mes / rango personalizado) — el
 * botón "Exportar" exporta exactamente el rango de fechas
 * seleccionado en pantalla, sin filtrar por tipo ni búsqueda (una
 * exportación de bitácora debe ser completa para ese rango).
 *
 * Cambios de la versión de rediseño:
 *  - CORRECCIÓN: los registros se agrupaban por día en hora UTC
 *    (toISOString). En Colombia (UTC−5) todo lo registrado después
 *    de las 7 p. m. aparecía en el día siguiente. Ahora se agrupa por
 *    la fecha local del dispositivo.
 *  - Cada encabezado de día muestra cuántos registros tiene.
 *  - Tocar cualquier parte de la tarjeta de un registro abre su
 *    detalle (antes solo el enlace "Ver detalle"), excepto los
 *    controles del audio.
 *  - "Desde el último" muestra días cuando pasan más de 48 horas.
 *  - Si la URL no trae ?project_id= (entrada desde la barra de
 *    navegación), se abre el proyecto activo guardado.
 */

import { supabase } from '../config/supabase.js';
import { announce } from '../app-shell.js';
import { confirmDialog } from '../utils/alertas.js';
import { setFieldError, clearFieldError } from '../utils/validaciones.js';
import { textIncludes } from '../utils/formato.js';
import { formatDisplayDate, formatDisplayTime } from '../utils/fechas.js';
import {
  setCurrentProjectId,
  getCurrentProjectId as getStoredProjectId,
} from '../utils/proyecto-actual.js';
import { exportarBitacoraPDF, exportarBitacoraWord } from './exportar-bitacora.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const TYPE_LABELS = {
  texto: 'Novedad',
  fotografia: 'Fotografía',
  'nota-voz': 'Nota de voz',
  ensayo: 'Ensayo',
  sst: 'Evento SST',
  avance: 'Avance',
};

const ESTADO_ENSAYO_LABELS = {
  cumple: 'Cumple',
  'no-cumple': 'No cumple',
  pendiente: 'Pendiente',
};

const ICON_CONFIG = {
  texto: {
    paths: [
      { d: 'M6 3h9l3 3v15H6z', linejoin: true },
      { d: 'M9 11h6M9 14h6M9 17h4', linecap: true },
    ],
  },
  fotografia: {
    paths: [
      {
        d: 'M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z',
        linejoin: true,
      },
    ],
    circle: { cx: 12, cy: 13, r: 3.2 },
  },
  'nota-voz': {
    rect: {
      x: 9, y: 3, width: 6, height: 11, rx: 3,
    },
    paths: [
      { d: 'M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6', linecap: true },
    ],
  },
  ensayo: {
    paths: [
      { d: 'M9 3h6', linecap: true },
      { d: 'M10 3v6l-5.5 9.2A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2.8L14 9V3', linejoin: true },
      { d: 'M7.5 15h9', linecap: true },
    ],
  },
  sst: {
    paths: [
      { d: 'M12 3 4.5 6v5.5c0 4.4 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5.1 7.5-9.5V6Z', linejoin: true },
      { d: 'm9 12 2.2 2.2L15.5 10', linecap: true, linejoin: true },
    ],
  },
  avance: {
    paths: [
      { d: 'M3 17l6-6 4 4 8-8', linecap: true, linejoin: true },
      { d: 'M15 7h6v6', linecap: true, linejoin: true },
    ],
  },
};

function buildTypeIcon(tipo) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'log-entry-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('aria-hidden', 'true');

  const config = ICON_CONFIG[tipo];
  if (!config) {
    return svg;
  }

  if (config.rect) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    Object.entries(config.rect).forEach(([key, value]) => rect.setAttribute(key, value));
    svg.appendChild(rect);
  }

  config.paths.forEach(({ d, linejoin, linecap }) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    if (linejoin) {
      path.setAttribute('stroke-linejoin', 'round');
    }
    if (linecap) {
      path.setAttribute('stroke-linecap', 'round');
    }
    svg.appendChild(path);
  });

  if (config.circle) {
    const circle = document.createElementNS(SVG_NS, 'circle');
    Object.entries(config.circle).forEach(([key, value]) => circle.setAttribute(key, value));
    svg.appendChild(circle);
  }

  return svg;
}

/* ============================================================================
   ESTADO EN MEMORIA
   ============================================================================ */
let allEntries = [];
let activeType = 'todos';
let activePeriod = 'todo';
let customRange = { desde: null, hasta: null };
let currentProjectId = null;
let currentProjectName = '';

/**
 * Los registros de tipo "texto" se guardan como un solo bloque de
 * texto donde las primeras líneas pueden traer datos estructurados
 * (Clima, Personal en obra, Maquinaria en obra, Observaciones),
 * seguidos de una línea en blanco y luego la novedad libre. Esta
 * función separa esas dos partes para poder mostrarlas de forma
 * distinta (chips arriba, texto normal abajo) en vez de un párrafo
 * plano. Si el contenido no trae ese formato (registros antiguos,
 * o descripciones de foto/audio), simplemente no encuentra nada y
 * todo el texto se trata como cuerpo normal.
 */
const META_LABELS = ['Clima', 'Personal en obra', 'Maquinaria en obra', 'Observaciones'];

function parseStructuredContent(content) {
  if (!content) {
    return { meta: [], body: '' };
  }

  const lines = content.split('\n');
  const meta = [];
  let bodyStartIndex = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const matchedLabel = META_LABELS.find((label) => line.startsWith(`${label}:`));

    if (matchedLabel && meta.length === i) {
      meta.push({ label: matchedLabel, value: line.slice(matchedLabel.length + 1).trim() });
      bodyStartIndex = i + 1;
    } else if (meta.length > 0 && line.trim() === '') {
      bodyStartIndex = i + 1;
      break;
    } else {
      break;
    }
  }

  const body = lines.slice(bodyStartIndex).join('\n').trim();
  return { meta, body };
}

/**
 * Construye la fila de "chips" con los datos estructurados (Clima,
 * Personal, Maquinaria) y, si hay Observaciones, un párrafo aparte
 * debajo. Devuelve null si no hay nada que mostrar.
 */
function buildStructuredMeta(meta) {
  const chipsData = meta.filter((item) => item.label !== 'Observaciones' && item.value);
  const observaciones = meta.find((item) => item.label === 'Observaciones' && item.value);

  if (!chipsData.length && !observaciones) {
    return null;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'log-entry-meta-wrapper';

  if (chipsData.length) {
    const row = document.createElement('div');
    row.className = 'log-entry-meta';
    chipsData.forEach(({ label, value }) => {
      const chip = document.createElement('span');
      chip.className = 'log-entry-meta-chip';
      chip.dataset.campo = label;
      chip.textContent = `${label}: ${value}`;
      row.appendChild(chip);
    });
    wrapper.appendChild(row);
  }

  if (observaciones) {
    const obsEl = document.createElement('p');
    obsEl.className = 'log-entry-observaciones';
    obsEl.textContent = observaciones.value;
    wrapper.appendChild(obsEl);
  }

  return wrapper;
}

/**
 * Etiquetas del registro (Calidad, SST...) y, en los ensayos, el estado
 * (cumple / no cumple / pendiente). Devuelve null si no hay nada que mostrar.
 */
/** true si el registro se subió en un día distinto al día en que ocurrió */
function esAnexado(entry) {
  return Boolean(entry.registrado_at)
    && localDayKey(entry.registrado_at) !== localDayKey(entry.created_at);
}

function fechaHoraCorta(valor) {
  const d = new Date(valor);
  return `${formatDisplayDate(d)} · ${formatDisplayTime(d)}`;
}

/** Texto de trazabilidad: cuándo se anexó y cuándo se editó */
function textoTrazabilidad(entry) {
  const partes = [];
  if (esAnexado(entry)) {
    partes.push(`Anexado el ${fechaHoraCorta(entry.registrado_at)}`);
  }
  if (entry.editado_at) {
    partes.push(`Editado el ${fechaHoraCorta(entry.editado_at)}`);
  }
  return partes.join(' · ');
}

function buildEntryChips(entry) {
  const etiquetas = Array.isArray(entry.etiquetas) ? entry.etiquetas : [];
  const estado = entry.type === 'ensayo' && entry.datos ? entry.datos.estado : '';
  const anexado = esAnexado(entry);
  const editado = Boolean(entry.editado_at);

  if (!etiquetas.length && !estado && !anexado && !editado) {
    return null;
  }

  const row = document.createElement('div');
  row.className = 'log-entry-chips';

  if (anexado) {
    const chip = document.createElement('span');
    chip.className = 'log-entry-traza';
    chip.dataset.traza = 'anexado';
    chip.textContent = 'Anexado';
    chip.title = `Anexado el ${fechaHoraCorta(entry.registrado_at)}`;
    row.appendChild(chip);
  }

  if (editado) {
    const chip = document.createElement('span');
    chip.className = 'log-entry-traza';
    chip.dataset.traza = 'editado';
    chip.textContent = 'Editado';
    chip.title = `Editado el ${fechaHoraCorta(entry.editado_at)}`;
    row.appendChild(chip);
  }

  if (estado && ESTADO_ENSAYO_LABELS[estado]) {
    const chip = document.createElement('span');
    chip.className = 'log-entry-estado';
    chip.dataset.estado = estado;
    chip.textContent = ESTADO_ENSAYO_LABELS[estado];
    row.appendChild(chip);
  }

  etiquetas.forEach((nombre) => {
    const chip = document.createElement('span');
    chip.className = 'log-entry-tag';
    chip.dataset.etiqueta = nombre;
    chip.textContent = nombre;
    row.appendChild(chip);
  });

  return row;
}

function getProjectIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('project_id');
}

/**
 * Clave del día en la fecha LOCAL del dispositivo (AAAA-MM-DD).
 * No usar toISOString(): devuelve la fecha en UTC y mueve al día
 * siguiente los registros hechos en la noche.
 */
function localDayKey(date) {
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/* ============================================================================
   CARGA DE DATOS
   ============================================================================ */
function cacheKeyForProject(projectId) {
  return `bcivil_cache_entries_${projectId}`;
}

function saveEntriesToLocalCache(projectId, entries) {
  try {
    localStorage.setItem(cacheKeyForProject(projectId), JSON.stringify(entries));
  } catch (error) {
    // Si el almacenamiento local está lleno o no disponible, no es
    // grave: simplemente no habrá respaldo offline para este proyecto.
    console.warn('No se pudo guardar el respaldo local de la bitácora:', error);
  }
}

function readEntriesFromLocalCache(projectId) {
  try {
    const raw = localStorage.getItem(cacheKeyForProject(projectId));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function showOfflineBanner(show) {
  let banner = document.getElementById('bcivil-offline-banner');
  if (show && !banner) {
    banner = document.createElement('div');
    banner.id = 'bcivil-offline-banner';
    banner.className = 'offline-data-banner';
    banner.textContent = 'Sin conexión: mostrando la última información guardada en este celular.';
    document.body.prepend(banner);
  } else if (!show && banner) {
    banner.remove();
  }
}

async function fetchEntries(projectId) {
  try {
    const { data, error } = await supabase
      .from('bitacora_entries')
      .select('*')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error al cargar la bitácora:', error);
      announce('No se pudieron cargar los registros. Intenta de nuevo.');
      return [];
    }

    showOfflineBanner(false);
    saveEntriesToLocalCache(projectId, data || []);
    return data || [];
  } catch (error) {
    // Sin red: se muestra la última copia guardada de este proyecto
    // en vez de dejar la bitácora vacía.
    const cached = readEntriesFromLocalCache(projectId);
    if (cached) {
      showOfflineBanner(true);
      return cached;
    }
    console.error('Error al cargar la bitácora:', error);
    announce('Ocurrió un error inesperado. Intenta nuevamente.');
    return [];
  }
}

function getReferenceDate() {
  if (!allEntries.length) {
    return new Date();
  }
  return new Date(Math.max(...allEntries.map((entry) => new Date(entry.created_at).getTime())));
}

/* ============================================================================
   PRESENTACIÓN
   ============================================================================ */
function buildEntryElement(entry) {
  const li = document.createElement('li');
  li.className = 'log-entry';
  li.dataset.tipo = entry.type;
  li.dataset.entryId = entry.id;

  const createdAt = new Date(entry.created_at);

  const timeWrap = document.createElement('div');
  timeWrap.className = 'log-entry-time';
  const time = document.createElement('time');
  time.dateTime = createdAt.toISOString();
  time.textContent = formatDisplayTime(createdAt);
  timeWrap.appendChild(time);

  const body = document.createElement('div');
  body.className = 'log-entry-body';

  const typeLabel = document.createElement('span');
  typeLabel.className = 'log-entry-type';
  typeLabel.appendChild(buildTypeIcon(entry.type));
  typeLabel.appendChild(document.createTextNode(TYPE_LABELS[entry.type] || entry.type));
  body.appendChild(typeLabel);

  const chipsEl = buildEntryChips(entry);
  if (chipsEl) {
    body.appendChild(chipsEl);
  }

  const textEl = document.createElement('p');
  textEl.className = 'log-entry-text';

  if (entry.type === 'texto') {
    const { meta, body: noveltyText } = parseStructuredContent(entry.content);
    const metaEl = buildStructuredMeta(meta);
    if (metaEl) {
      body.appendChild(metaEl);
    }
    textEl.textContent = noveltyText || entry.content || '';
  } else {
    textEl.textContent = entry.content || '';
  }
  body.appendChild(textEl);

  if (entry.type === 'fotografia' && Array.isArray(entry.photo_urls) && entry.photo_urls.length) {
    const photosList = document.createElement('ul');
    photosList.className = 'entry-photos';
    photosList.setAttribute('role', 'list');
    entry.photo_urls.forEach((url, index) => {
      const item = document.createElement('li');
      item.className = 'photo-placeholder';
      const img = document.createElement('img');
      img.src = url;
      img.alt = `Fotografía ${index + 1} del registro`;
      img.loading = 'lazy';
      img.decoding = 'async';
      item.appendChild(img);
      photosList.appendChild(item);
    });
    body.appendChild(photosList);
  }

  if (entry.type === 'nota-voz' && entry.audio_url) {
    const audioWrap = document.createElement('div');
    audioWrap.className = 'audio-placeholder';
    const audioEl = document.createElement('audio');
    audioEl.controls = true;
    audioEl.preload = 'none';
    audioEl.src = entry.audio_url;
    const duration = document.createElement('span');
    duration.className = 'audio-placeholder-duration';
    duration.textContent = entry.audio_duration || '';
    audioWrap.appendChild(audioEl);
    audioWrap.appendChild(duration);
    body.appendChild(audioWrap);

    if (entry.audio_transcription) {
      const transcripcion = document.createElement('p');
      transcripcion.className = 'log-entry-observaciones';
      transcripcion.textContent = `"${entry.audio_transcription}"`;
      body.appendChild(transcripcion);
    }
  }

  const detailBtn = document.createElement('button');
  detailBtn.type = 'button';
  detailBtn.className = 'link-secondary entry-detail-trigger';
  detailBtn.textContent = 'Ver detalle';
  body.appendChild(detailBtn);

  li.appendChild(timeWrap);
  li.appendChild(body);
  return li;
}

function groupByDay(entries) {
  const groups = new Map();

  entries.forEach((entry) => {
    const dayKey = localDayKey(entry.created_at);
    if (!groups.has(dayKey)) {
      groups.set(dayKey, []);
    }
    groups.get(dayKey).push(entry);
  });

  return groups;
}

function buildDayHeading(dayKey, entries) {
  const date = new Date(`${dayKey}T00:00:00`);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isToday = date.toDateString() === today.toDateString();
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const heading = document.createElement('h2');
  heading.className = 'day-group-heading';

  if (isToday) {
    heading.appendChild(document.createTextNode('Hoy '));
  } else if (isYesterday) {
    heading.appendChild(document.createTextNode('Ayer '));
  }

  const timeEl = document.createElement('time');
  timeEl.dateTime = dayKey;
  timeEl.textContent = formatDisplayDate(date);
  heading.appendChild(timeEl);

  const count = document.createElement('span');
  count.className = 'day-group-count';
  count.textContent = entries.length === 1 ? '1 registro' : `${entries.length} registros`;
  heading.appendChild(count);

  return heading;
}

function matchesTypeAndQuery(entry) {
  const matchesType = activeType === 'todos' || entry.type === activeType;

  const searchInput = document.getElementById('buscar-bitacora');
  const query = searchInput ? searchInput.value : '';
  const textoBusqueda = `${entry.content || ''} ${(entry.etiquetas || []).join(' ')}`;
  const matchesQuery = textIncludes(textoBusqueda, query);

  return matchesType && matchesQuery;
}

function matchesPeriodOnly(entry) {
  const createdAt = new Date(entry.created_at);

  if (customRange.desde || customRange.hasta) {
    if (customRange.desde && createdAt < customRange.desde) {
      return false;
    }
    if (customRange.hasta && createdAt > customRange.hasta) {
      return false;
    }
    return true;
  }

  if (activePeriod !== 'todo') {
    const days = activePeriod === 'semana' ? 7 : 30;
    const threshold = new Date(getReferenceDate());
    threshold.setDate(threshold.getDate() - days);
    return createdAt >= threshold;
  }

  return true;
}

function matchesFilters(entry) {
  return matchesTypeAndQuery(entry) && matchesPeriodOnly(entry);
}

function renderTimeline() {
  const timeline = document.getElementById('bitacora-timeline');
  const emptyState = document.getElementById('bitacora-empty-state');
  const emptyEyebrow = document.getElementById('bitacora-empty-eyebrow');
  const emptyTitle = document.getElementById('bitacora-empty-title');
  const emptyDescription = document.getElementById('bitacora-empty-description');

  if (!timeline || !emptyState) {
    return;
  }

  const filtered = allEntries.filter(matchesFilters);
  timeline.innerHTML = '';

  const groups = groupByDay(filtered);
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => (a < b ? 1 : -1));

  sortedKeys.forEach((dayKey) => {
    const dayGroup = document.createElement('div');
    dayGroup.className = 'day-group';
    dayGroup.appendChild(buildDayHeading(dayKey, groups.get(dayKey)));

    const entriesList = document.createElement('ol');
    entriesList.className = 'day-entries';
    entriesList.setAttribute('role', 'list');
    groups.get(dayKey).forEach((entry) => entriesList.appendChild(buildEntryElement(entry)));

    dayGroup.appendChild(entriesList);
    timeline.appendChild(dayGroup);
  });

  if (allEntries.length === 0) {
    timeline.hidden = true;
    emptyState.hidden = false;
    if (emptyEyebrow) {
      emptyEyebrow.textContent = 'Comienza aquí';
    }
    if (emptyTitle) {
      emptyTitle.textContent = 'Todavía no hay registros';
    }
    if (emptyDescription) {
      emptyDescription.textContent = 'Usa el botón naranja para crear el primer registro de este proyecto.';
    }
    return;
  }

  if (filtered.length === 0) {
    timeline.hidden = true;
    emptyState.hidden = false;
    if (emptyEyebrow) {
      emptyEyebrow.textContent = 'Sin resultados';
    }
    if (emptyTitle) {
      emptyTitle.textContent = 'No se encontraron registros';
    }
    if (emptyDescription) {
      emptyDescription.textContent = 'Intenta con otro término de búsqueda, cambia el filtro o ajusta el período seleccionado.';
    }
    return;
  }

  timeline.hidden = false;
  emptyState.hidden = true;
}

export async function reloadEntries() {
  if (!currentProjectId) {
    return;
  }
  allEntries = await fetchEntries(currentProjectId);
  renderTimeline();
  renderStats();
}

/**
 * Calcula y muestra las cifras rápidas del encabezado: total de
 * registros de los últimos 7 días, cuántos traen fotografía, y hace
 * cuánto fue el último registro. Son datos reales de allEntries, no
 * valores de ejemplo.
 */
function renderStats() {
  const totalEl = document.getElementById('bitacora-stat-total');
  const fotosEl = document.getElementById('bitacora-stat-fotos');
  const ultimoEl = document.getElementById('bitacora-stat-ultimo');

  if (!totalEl && !fotosEl && !ultimoEl) {
    return;
  }

  const unaSemanaMs = 7 * 24 * 60 * 60 * 1000;
  const ahora = Date.now();
  const ultimaSemana = allEntries.filter(
    (entry) => ahora - new Date(entry.created_at).getTime() <= unaSemanaMs,
  );

  if (totalEl) {
    totalEl.textContent = String(ultimaSemana.length);
  }

  if (fotosEl) {
    const conFoto = ultimaSemana.filter(
      (entry) => entry.type === 'fotografia' && Array.isArray(entry.photo_urls) && entry.photo_urls.length,
    ).length;
    fotosEl.textContent = String(conFoto);
  }

  if (ultimoEl) {
    if (!allEntries.length) {
      ultimoEl.textContent = '—';
    } else {
      const masReciente = Math.max(...allEntries.map((entry) => new Date(entry.created_at).getTime()));
      const horas = Math.max(0, Math.round((ahora - masReciente) / (60 * 60 * 1000)));
      if (horas < 1) {
        ultimoEl.textContent = '< 1 h';
      } else if (horas <= 48) {
        ultimoEl.textContent = `${horas} h`;
      } else {
        ultimoEl.textContent = `${Math.round(horas / 24)} días`;
      }
    }
  }
}

export function getCurrentProjectId() {
  return currentProjectId;
}

/* ============================================================================
   EXPORTAR BITÁCORA — usa el período seleccionado en pantalla, sin
   filtrar por tipo ni búsqueda (la exportación debe ser completa
   para ese rango de fechas).
   ============================================================================ */
export function getEntriesForExport() {
  return allEntries.filter(matchesPeriodOnly);
}

export function getExportPeriodLabel() {
  if (customRange.desde || customRange.hasta) {
    const desdeTxt = customRange.desde ? formatDisplayDate(customRange.desde) : '(sin definir)';
    const hastaTxt = customRange.hasta ? formatDisplayDate(customRange.hasta) : '(sin definir)';
    return `Del ${desdeTxt} al ${hastaTxt}`;
  }
  if (activePeriod === 'semana') {
    return 'Última semana';
  }
  if (activePeriod === 'mes') {
    return 'Último mes';
  }
  return 'Todo el período';
}

/* ============================================================================
   FILTROS, BÚSQUEDA Y PERÍODO
   ============================================================================ */
function initFilters() {
  const typeButtons = Array.from(
    document.querySelectorAll('#filtro-todos, #filtro-texto, #filtro-fotografia, #filtro-nota-voz, #filtro-ensayo, #filtro-sst, #filtro-avance'),
  );
  const periodButtons = Array.from(
    document.querySelectorAll('#periodo-todo, #periodo-semana, #periodo-mes'),
  );
  const searchInput = document.getElementById('buscar-bitacora');
  const searchForm = document.querySelector('.search-form');
  const periodForm = document.querySelector('.period-form');
  const desdeInput = document.getElementById('periodo-desde');
  const hastaInput = document.getElementById('periodo-hasta');

  typeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      typeButtons.forEach((btn) => {
        btn.classList.remove('is-active');
        btn.setAttribute('aria-pressed', 'false');
      });
      button.classList.add('is-active');
      button.setAttribute('aria-pressed', 'true');
      activeType = button.id === 'filtro-todos' ? 'todos' : button.id.replace('filtro-', '');
      renderTimeline();
    });
  });

  periodButtons.forEach((button) => {
    button.addEventListener('click', () => {
      periodButtons.forEach((btn) => {
        btn.classList.remove('is-active');
        btn.setAttribute('aria-pressed', 'false');
      });
      button.classList.add('is-active');
      button.setAttribute('aria-pressed', 'true');
      activePeriod = button.id === 'periodo-todo' ? 'todo' : button.id.replace('periodo-', '');
      customRange = { desde: null, hasta: null };
      if (desdeInput) {
        desdeInput.value = '';
      }
      if (hastaInput) {
        hastaInput.value = '';
      }
      renderTimeline();
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', renderTimeline);
  }

  if (searchForm) {
    searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (searchInput) {
        searchInput.blur(); // cierra el teclado del teléfono
      }
      renderTimeline();
    });
  }

  if (periodForm) {
    periodForm.addEventListener('submit', (event) => {
      event.preventDefault();

      const desdeValue = desdeInput && desdeInput.value ? new Date(`${desdeInput.value}T00:00:00`) : null;
      const hastaValue = hastaInput && hastaInput.value ? new Date(`${hastaInput.value}T23:59:59`) : null;
      customRange = { desde: desdeValue, hasta: hastaValue };

      periodButtons.forEach((button) => {
        button.classList.remove('is-active');
        button.setAttribute('aria-pressed', 'false');
      });

      // Se pliega el rango para devolver el espacio a la línea de tiempo
      const details = periodForm.closest('details');
      if (details) {
        details.open = false;
      }

      renderTimeline();
    });
  }
}

/* ============================================================================
   EXPORTAR BITÁCORA — botón y modal de elección de formato
   ============================================================================ */
function initExport() {
  const exportBtn = document.getElementById('bitacora-exportar-btn');
  const modal = document.getElementById('bitacora-exportar-modal');
  const periodoLabelEl = document.getElementById('bitacora-exportar-periodo-label');
  const pdfBtn = document.getElementById('bitacora-exportar-pdf-btn');
  const wordBtn = document.getElementById('bitacora-exportar-word-btn');
  const cancelBtn = document.getElementById('bitacora-exportar-cancelar-btn');

  if (!exportBtn || !modal || !pdfBtn || !wordBtn) {
    return;
  }

  function abrirModal() {
    if (periodoLabelEl) {
      periodoLabelEl.textContent = getExportPeriodLabel();
    }
    modal.hidden = false;
  }

  function cerrarModal() {
    modal.hidden = true;
  }

  async function exportar(formato) {
    const entries = getEntriesForExport();
    if (!entries.length) {
      announce('No hay registros en el período seleccionado para exportar.');
      return;
    }

    const botonActivo = formato === 'pdf' ? pdfBtn : wordBtn;
    const textoOriginal = botonActivo.textContent;
    botonActivo.disabled = true;
    botonActivo.textContent = 'Generando…';

    try {
      const params = {
        proyectoNombre: currentProjectName || 'Proyecto',
        periodoLabel: getExportPeriodLabel(),
        entries,
      };

      if (formato === 'pdf') {
        await exportarBitacoraPDF(params);
      } else {
        exportarBitacoraWord(params);
      }

      announce('La bitácora se exportó correctamente.');
      cerrarModal();
    } catch (error) {
      console.error('Error al exportar la bitácora:', error);
      announce('No se pudo exportar la bitácora. Intenta de nuevo.');
    } finally {
      botonActivo.disabled = false;
      botonActivo.textContent = textoOriginal;
    }
  }

  exportBtn.addEventListener('click', abrirModal);
  if (cancelBtn) {
    cancelBtn.addEventListener('click', cerrarModal);
  }
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      cerrarModal();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) {
      cerrarModal();
    }
  });
  pdfBtn.addEventListener('click', () => exportar('pdf'));
  wordBtn.addEventListener('click', () => exportar('word'));
}

/* ============================================================================
   VISTA DE DETALLE
   ============================================================================ */
/** Fecha local → valor de <input type="datetime-local"> (AAAA-MM-DDTHH:MM) */
function aValorLocal(date) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return d.toISOString().slice(0, 16);
}

/** Lee "Estado: …" del texto de un ensayo y lo convierte a su clave */
function estadoDesdeTexto(texto) {
  const linea = String(texto || '').split('\n').find((l) => /^\s*estado\s*:/i.test(l));
  if (!linea) {
    return '';
  }
  const valor = linea.split(':').slice(1).join(':').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (valor.startsWith('no cumple')) return 'no-cumple';
  if (valor.startsWith('cumple')) return 'cumple';
  if (valor.startsWith('pendiente')) return 'pendiente';
  return '';
}

function formatEntryDate(entry) {
  const date = new Date(entry.created_at);
  return `${formatDisplayDate(date)} · ${formatDisplayTime(date)}`;
}

function initDetailView() {
  const overlay = document.getElementById('entry-detail-overlay');
  const closeBtn = document.getElementById('entry-detail-close');
  const fechaEl = document.getElementById('entry-detail-fecha');
  const tituloEl = document.getElementById('entry-detail-titulo');
  const textoEl = document.getElementById('entry-detail-texto');
  const mediaEl = document.getElementById('entry-detail-photos');
  const editField = document.getElementById('entry-detail-edit-field');
  const editTextarea = document.getElementById('entry-detail-edit-textarea');
  const viewActions = document.getElementById('entry-detail-view-actions');
  const editActions = document.getElementById('entry-detail-edit-actions');
  const editBtn = document.getElementById('entry-detail-edit-btn');
  const saveBtn = document.getElementById('entry-detail-save-btn');
  const cancelEditBtn = document.getElementById('entry-detail-cancel-edit-btn');
  const deleteBtn = document.getElementById('entry-detail-delete-btn');

  if (!overlay || !closeBtn || !fechaEl || !tituloEl || !textoEl || !mediaEl) {
    return;
  }

  let lastTrigger = null;
  let currentEntry = null;

  // Línea de trazabilidad (Anexado / Editado) bajo el título
  const trazaEl = document.createElement('p');
  trazaEl.className = 'entry-detail-traza';
  trazaEl.hidden = true;
  tituloEl.insertAdjacentElement('afterend', trazaEl);

  function mostrarTrazabilidad(entry) {
    const texto = textoTrazabilidad(entry);
    trazaEl.textContent = texto;
    trazaEl.hidden = !texto;
  }

  // Campo de fecha del modo edición (se crea aquí, no requiere cambiar el HTML)
  const fechaEditWrap = document.createElement('div');
  fechaEditWrap.className = 'form-field';
  fechaEditWrap.hidden = true;
  const fechaEditLabel = document.createElement('label');
  fechaEditLabel.setAttribute('for', 'entry-detail-edit-fecha');
  fechaEditLabel.textContent = 'Fecha y hora en que ocurrió';
  const fechaEditInput = document.createElement('input');
  fechaEditInput.type = 'datetime-local';
  fechaEditInput.id = 'entry-detail-edit-fecha';
  const fechaEditHint = document.createElement('p');
  fechaEditHint.className = 'form-hint';
  fechaEditHint.textContent = 'Si cambias la fecha, el registro pasa a ese día. Queda constancia de la edición.';
  fechaEditWrap.appendChild(fechaEditLabel);
  fechaEditWrap.appendChild(fechaEditInput);
  fechaEditWrap.appendChild(fechaEditHint);
  if (editField) {
    editField.insertAdjacentElement('beforebegin', fechaEditWrap);
  }

  if (overlay.hidden) {
    overlay.style.display = 'none';
  }

  function exitEditMode() {
    fechaEditWrap.hidden = true;
    clearFieldError(fechaEditInput);
    if (editField) {
      editField.hidden = true;
    }
    if (textoEl) {
      textoEl.hidden = false;
    }
    if (viewActions) {
      viewActions.hidden = false;
    }
    if (editActions) {
      editActions.hidden = true;
    }
  }

  function closeDetail() {
    overlay.hidden = true;
    overlay.style.display = 'none';
    exitEditMode();
    currentEntry = null;
    document.removeEventListener('keydown', handleKeydown);
    if (lastTrigger) {
      lastTrigger.focus();
      lastTrigger = null;
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      closeDetail();
    }
  }

  function fillMedia(entry) {
    mediaEl.innerHTML = '';

    if (entry.type === 'fotografia' && Array.isArray(entry.photo_urls) && entry.photo_urls.length) {
      entry.photo_urls.forEach((url, index) => {
        const item = document.createElement('li');
        item.className = 'photo-placeholder';
        const img = document.createElement('img');
        img.src = url;
        img.alt = `Fotografía ${index + 1} del registro`;
        item.appendChild(img);
        mediaEl.appendChild(item);
      });
      mediaEl.hidden = false;
      return;
    }

    if (entry.type === 'nota-voz' && entry.audio_url) {
      const item = document.createElement('li');
      item.style.gridColumn = '1 / -1';
      const audioWrap = document.createElement('div');
      audioWrap.className = 'audio-placeholder';
      const audioEl = document.createElement('audio');
      audioEl.controls = true;
      audioEl.src = entry.audio_url;
      const duration = document.createElement('span');
      duration.className = 'audio-placeholder-duration';
      duration.textContent = entry.audio_duration || '';
      audioWrap.appendChild(audioEl);
      audioWrap.appendChild(duration);
      item.appendChild(audioWrap);
      mediaEl.appendChild(item);

      if (entry.audio_transcription) {
        const transcriptionItem = document.createElement('li');
        transcriptionItem.style.gridColumn = '1 / -1';
        const transcripcion = document.createElement('p');
        transcripcion.className = 'log-entry-observaciones';
        transcripcion.textContent = `"${entry.audio_transcription}"`;
        transcriptionItem.appendChild(transcripcion);
        mediaEl.appendChild(transcriptionItem);
      }

      mediaEl.hidden = false;
      return;
    }

    mediaEl.hidden = true;
  }

  function openDetail(entry, trigger) {
    lastTrigger = trigger;
    currentEntry = entry;
    exitEditMode();

    fechaEl.textContent = formatEntryDate(entry);
    tituloEl.textContent = TYPE_LABELS[entry.type] || entry.type;
    mostrarTrazabilidad(entry);

    const previousMeta = textoEl.parentNode.querySelector('.log-entry-meta-wrapper');
    if (previousMeta) {
      previousMeta.remove();
    }
    textoEl.parentNode.querySelectorAll('.log-entry-chips').forEach((el) => el.remove());

    const detailChips = buildEntryChips(entry);
    if (detailChips) {
      textoEl.parentNode.insertBefore(detailChips, textoEl);
    }

    if (entry.type === 'texto') {
      const { meta, body: noveltyText } = parseStructuredContent(entry.content);
      const metaEl = buildStructuredMeta(meta);
      if (metaEl) {
        textoEl.parentNode.insertBefore(metaEl, textoEl);
      }
      textoEl.textContent = noveltyText || entry.content || '';
    } else {
      textoEl.textContent = entry.content || '';
    }

    fillMedia(entry);

    overlay.hidden = false;
    overlay.style.display = '';
    document.addEventListener('keydown', handleKeydown);
    closeBtn.focus();
  }

  // Abrir el detalle tocando la tarjeta completa (o su botón ↗). Los
  // controles del audio y otros elementos interactivos se respetan.
  document.addEventListener('click', (event) => {
    const li = event.target.closest('.log-entry');
    if (!li) {
      return;
    }

    const isDetailTrigger = Boolean(event.target.closest('.entry-detail-trigger'));
    const isOtherControl = event.target.closest('audio, a, input, textarea, select, button');
    if (isOtherControl && !isDetailTrigger) {
      return;
    }

    const entry = allEntries.find((item) => String(item.id) === li.dataset.entryId);
    if (entry) {
      openDetail(entry, li.querySelector('.entry-detail-trigger') || li);
    }
  });

  closeBtn.addEventListener('click', closeDetail);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeDetail();
    }
  });

  if (editBtn && editField && editTextarea && viewActions && editActions) {
    editBtn.addEventListener('click', () => {
      if (!currentEntry) {
        return;
      }
      editTextarea.value = currentEntry.content || '';
      fechaEditInput.value = aValorLocal(new Date(currentEntry.created_at));
      fechaEditInput.max = aValorLocal(new Date());
      clearFieldError(fechaEditInput);
      fechaEditWrap.hidden = false;
      textoEl.hidden = true;
      editField.hidden = false;
      viewActions.hidden = true;
      editActions.hidden = false;
      editTextarea.focus();
    });
  }

  if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', exitEditMode);
  }

  if (saveBtn && editTextarea) {
    saveBtn.addEventListener('click', async () => {
      if (!currentEntry) {
        return;
      }

      const nuevoContenido = editTextarea.value.trim();

      // Texto obligatorio en novedades y registros de control de obra
      if (!nuevoContenido && !['fotografia', 'nota-voz'].includes(currentEntry.type)) {
        setFieldError(editTextarea, 'El contenido no puede quedar vacío.');
        editTextarea.focus();
        return;
      }
      clearFieldError(editTextarea);

      const cambios = { content: nuevoContenido || null };

      const nuevaFecha = fechaEditInput.value ? new Date(fechaEditInput.value) : null;
      if (!nuevaFecha || Number.isNaN(nuevaFecha.getTime())) {
        setFieldError(fechaEditInput, 'Elige la fecha y hora en que ocurrió.');
        fechaEditInput.focus();
        return;
      }
      if (nuevaFecha.getTime() > Date.now() + 60 * 1000) {
        setFieldError(fechaEditInput, 'La fecha no puede ser futura.');
        fechaEditInput.focus();
        return;
      }
      clearFieldError(fechaEditInput);
      // Solo se envía si cambió (el input no maneja segundos)
      if (aValorLocal(nuevaFecha) !== aValorLocal(new Date(currentEntry.created_at))) {
        cambios.created_at = nuevaFecha.toISOString();
      }

      // Ensayos: el estado (Cumple / No cumple / Pendiente) se mantiene
      // sincronizado con lo que diga el texto editado.
      if (currentEntry.type === 'ensayo' && currentEntry.datos) {
        const estado = estadoDesdeTexto(nuevoContenido);
        if (estado && estado !== currentEntry.datos.estado) {
          cambios.datos = { ...currentEntry.datos, estado };
        }
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Guardando...';

      try {
        const { data, error } = await supabase
          .from('bitacora_entries')
          .update(cambios)
          .eq('id', currentEntry.id)
          .select()
          .single();

        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar cambios';

        if (error || !data) {
          console.error('Error al actualizar el registro:', error);
          announce('No se pudo guardar el cambio. Intenta de nuevo.');
          return;
        }

        currentEntry = data;
        fechaEl.textContent = formatEntryDate(data);
        mostrarTrazabilidad(data);
        textoEl.parentNode.querySelectorAll('.log-entry-chips').forEach((el) => el.remove());
        const nuevosChips = buildEntryChips(data);
        if (nuevosChips) {
          textoEl.parentNode.insertBefore(nuevosChips, textoEl);
        }
        const previousMeta = textoEl.parentNode.querySelector('.log-entry-meta-wrapper');
        if (previousMeta) {
          previousMeta.remove();
        }
        if (data.type === 'texto') {
          const { meta, body: noveltyText } = parseStructuredContent(data.content);
          const metaEl = buildStructuredMeta(meta);
          if (metaEl) {
            textoEl.parentNode.insertBefore(metaEl, textoEl);
          }
          textoEl.textContent = noveltyText || data.content || '';
        } else {
          textoEl.textContent = data.content || '';
        }
        exitEditMode();
        announce('Registro actualizado.');
        await reloadEntries();
      } catch (error) {
        console.error('Error al actualizar el registro:', error);
        announce('Ocurrió un error inesperado. Intenta nuevamente.');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar cambios';
      }
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!currentEntry) {
        return;
      }

      const confirmed = await confirmDialog({
        titleText: 'Eliminar registro',
        message: 'Este registro se eliminará de la bitácora. Esta acción no se puede deshacer.',
        confirmLabel: 'Eliminar registro',
        confirmClassName: 'btn btn-secondary settings-danger-btn',
        restoreFocusTo: deleteBtn,
      });

      if (!confirmed) {
        return;
      }

      try {
        const { error } = await supabase
          .from('bitacora_entries')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', currentEntry.id);

        if (error) {
          console.error('Error al eliminar el registro:', error);
          announce('No se pudo eliminar el registro. Intenta de nuevo.');
          return;
        }

        announce('Registro eliminado.');
        closeDetail();
        await reloadEntries();
      } catch (error) {
        console.error('Error al eliminar el registro:', error);
        announce('Ocurrió un error inesperado. Intenta nuevamente.');
      }
    });
  }
}

/* ============================================================================
   INICIALIZACIÓN
   ============================================================================ */
function showSinProyecto() {
  const contenido = document.getElementById('bitacora-contenido');
  const sinProyecto = document.getElementById('bitacora-sin-proyecto');
  if (contenido) {
    contenido.hidden = true;
  }
  if (sinProyecto) {
    sinProyecto.hidden = false;
  }
}

async function loadProjectContext(projectId) {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .is('deleted_at', null)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error al cargar el proyecto de la bitácora:', error);
    return null;
  }
}

async function init() {
  const timeline = document.getElementById('bitacora-timeline');
  if (!timeline) {
    return;
  }

  // Si la URL no trae ?project_id= (por ejemplo, al entrar desde la
  // barra de navegación), se usa el proyecto activo guardado.
  currentProjectId = getProjectIdFromUrl() || getStoredProjectId();
  setCurrentProjectId(currentProjectId);

  document.addEventListener('bcivil:entry-saved', () => {
    reloadEntries();
  });

  if (!currentProjectId) {
    showSinProyecto();
    return;
  }

  const project = await loadProjectContext(currentProjectId);
  if (!project) {
    showSinProyecto();
    return;
  }

  currentProjectName = project.name;
  document.title = `Bitácora — ${project.name} — B-Civil`;
  const nombreEl = document.getElementById('bitacora-proyecto-nombre');
  if (nombreEl) {
    nombreEl.textContent = project.name;
  }
  const volverLink = document.getElementById('link-volver-proyecto');
  if (volverLink) {
    volverLink.href = `../proyectos/proyecto.html?id=${project.id}`;
  }

  initFilters();
  initDetailView();
  initExport();
  await reloadEntries();
}

document.addEventListener('DOMContentLoaded', init);