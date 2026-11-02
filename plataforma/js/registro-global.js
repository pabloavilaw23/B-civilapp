/**
 * registro-global.js
 * Botón de registro rápido (FAB) reutilizable en cualquier página de la
 * app privada: se inyecta solo en el <body>, y al guardar un registro
 * emite el evento "bcivil:entry-saved" en vez de depender directamente
 * de la página de bitácora — así funciona igual desde Inicio, Proyectos,
 * Documentos o Asistente, y bitacora.html puede escuchar ese evento
 * para refrescar su línea de tiempo si está visible.
 *
 * REGISTRO RÁPIDO (novedad, fotografía, nota de voz): igual que antes,
 * más ETIQUETAS opcionales de un toque (Calidad, SST, Ambiental,
 * Administrativo) para que los informes ubiquen cada registro en su
 * sección.
 *
 * CONTROL DE OBRA (nuevo): tres registros con datos exactos, pensados
 * para que los informes de interventoría tengan de dónde sacar cifras
 * reales en vez de secciones vacías:
 *   - Ensayo de calidad (tipo, elemento, resultado, si cumple)
 *   - Evento SST (charla, inspección, incidente, accidente...)
 *   - Avance de obra (actividad, cantidad ejecutada y unidad)
 * Cada uno guarda un texto legible en "content" (lo leen la bitácora,
 * la búsqueda y la IA) y el detalle estructurado en "datos".
 *
 * RESPALDO: si la base de datos todavía no tiene las columnas o los
 * tipos nuevos (falta ejecutar etapa2.sql), el registro NO se pierde:
 * se guarda como novedad de texto con el mismo contenido.
 *
 * NOTAS DE VOZ: además de subir el audio, se transcribe automáticamente
 * a texto (función Edge "transcribe-audio") y se guarda en
 * "audio_transcription". Si la transcripción falla, la nota se guarda
 * igual — la transcripción nunca bloquea el guardado.
 */

import { supabase } from './config/supabase.js';
import { announce } from './app-shell.js';
import { setFieldError, clearFieldError } from './utils/validaciones.js';
import { createPhotoField, createAudioField } from './bitacora/multimedia.js';
import { uploadEntryFile } from './bitacora/almacenamiento.js';
import { getCurrentProjectId } from './utils/proyecto-actual.js';
import { cargarPersonal } from './utils/personal.js';
import {
  queueEntry, getPendingEntries, removePendingEntry, countPendingEntries, isOnline,
} from './utils/offline-queue.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const TYPE_LABELS = {
  texto: 'Novedad',
  fotografia: 'Fotografía',
  'nota-voz': 'Nota de voz',
  ensayo: 'Ensayo de calidad',
  sst: 'Evento SST',
  avance: 'Avance de obra',
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
  svg.setAttribute('stroke-width', '1.5');
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

/* --------------------------------------------------------------------------
   ESTADO DEL MODAL
   -------------------------------------------------------------------------- */
let overlayEl = null;
let titleEl = null;
let subtitleEl = null;
let contentEl = null;
let triggerEl = null;
let activePhotoField = null;
let activeAudioField = null;
let activeFechaField = null;

function resetActiveCaptureFields() {
  if (activePhotoField) {
    activePhotoField.reset();
    activePhotoField = null;
  }
  if (activeAudioField) {
    activeAudioField.reset();
    activeAudioField = null;
  }
  activeFechaField = null;
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    closeModal();
  }
}

function closeModal() {
  if (!overlayEl) {
    return;
  }
  resetActiveCaptureFields();
  overlayEl.remove();
  overlayEl = null;
  titleEl = null;
  subtitleEl = null;
  contentEl = null;
  document.removeEventListener('keydown', handleKeydown);
  if (triggerEl) {
    triggerEl.classList.remove('is-open');
    triggerEl.focus();
  }
}

/* --------------------------------------------------------------------------
   TRANSCRIPCIÓN AUTOMÁTICA DE NOTAS DE VOZ
   Nunca bloquea el guardado: si falla, devuelve null y la nota se
   guarda igual, sin transcripción.
   -------------------------------------------------------------------------- */
async function transcribeAudio(audioUrl) {
  try {
    const { data, error } = await supabase.functions.invoke('transcribe-audio', {
      body: { audioUrl },
    });

    if (error || !data || data.error) {
      console.error('Error al transcribir el audio:', error || data?.error);
      return null;
    }

    return data.transcription || null;
  } catch (error) {
    console.error('Error inesperado al transcribir el audio:', error);
    return null;
  }
}

/* --------------------------------------------------------------------------
   GUARDAR (INSERT REAL EN SUPABASE, CON RESPALDO OFFLINE)
   -------------------------------------------------------------------------- */

/**
 * Distingue "no hay internet / se cayó la conexión a mitad de la
 * subida" de un error real de la aplicación (permisos, validación).
 * fetch() lanza un TypeError cuando no puede ni siquiera contactar
 * al servidor — eso es la señal más confiable de "no hay red".
 */
function isNetworkError(error) {
  return error instanceof TypeError || !navigator.onLine;
}

const TIPOS_ESTRUCTURADOS = ['ensayo', 'sst', 'avance'];
const TITULOS_RESPALDO = { ensayo: 'Ensayo de calidad', sst: 'Evento SST', avance: 'Avance de obra' };

/** Error por columnas o tipos que aún no existen en la base de datos */
function esErrorDeEsquema(error) {
  if (!error) {
    return false;
  }
  const texto = `${error.code || ''} ${error.message || ''} ${error.details || ''}`;
  return /23514|42703|PGRST204|check constraint|etiquetas|datos|column/i.test(texto);
}

/**
 * Inserta una fila en bitacora_entries. Si la base de datos todavía no
 * tiene las columnas/tipos de la Etapa 2, reintenta guardando el mismo
 * contenido como novedad de texto: el registro nunca se pierde.
 */
async function guardarFila(fila) {
  let { error } = await supabase.from('bitacora_entries').insert(fila);

  if (error && esErrorDeEsquema(error)) {
    console.warn('La base de datos aún no tiene la Etapa 2; se guarda como novedad:', error.message || error);
    const respaldo = { ...fila };
    delete respaldo.etiquetas;
    delete respaldo.datos;
    if (TIPOS_ESTRUCTURADOS.includes(respaldo.type)) {
      respaldo.content = `${TITULOS_RESPALDO[respaldo.type]}\n${respaldo.content || ''}`.trim();
      respaldo.type = 'texto';
    }
    ({ error } = await supabase.from('bitacora_entries').insert(respaldo));
  }

  return { error };
}

function filaBase({
  projectId, ownerId, tipo, content, etiquetas, datos, fecha,
}) {
  const fila = {
    project_id: projectId,
    owner_id: ownerId,
    type: tipo,
    content,
  };
  // Fecha en que ocurrió lo registrado (día anterior o captura sin señal).
  // Sin fecha, la base de datos pone la hora actual del servidor.
  if (fecha) {
    fila.created_at = fecha;
  }
  if (etiquetas && etiquetas.length) {
    fila.etiquetas = etiquetas;
  }
  if (datos) {
    fila.datos = datos;
  }
  return fila;
}

/** Novedad escrita y registros de control de obra (sin archivos) */
async function insertSimpleEntry({
  tipo, content, etiquetas, datos,
}) {
  const projectId = getCurrentProjectId();
  if (!projectId) {
    announce('No se pudo determinar el proyecto activo.');
    return false;
  }

  const fecha = fechaElegida();
  const registro = {
    tipo, projectId, content, etiquetas, datos, fecha: fecha || new Date().toISOString(),
  };

  if (!isOnline()) {
    return queueOfflineEntry(registro);
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !session.user) {
      announce('Debes iniciar sesión para registrar una novedad.');
      return false;
    }

    const { error } = await guardarFila(filaBase({
      projectId, ownerId: session.user.id, tipo, content, etiquetas, datos, fecha,
    }));

    if (error) {
      console.error('Error al guardar el registro:', error);
      announce('No se pudo guardar el registro. Intenta de nuevo.');
      return false;
    }

    return true;
  } catch (error) {
    if (isNetworkError(error)) {
      return queueOfflineEntry(registro);
    }
    console.error('Error al guardar el registro:', error);
    announce('Ocurrió un error inesperado. Intenta nuevamente.');
    return false;
  }
}

async function insertPhotoEntry(texto, files, etiquetas, onProgress) {
  const fecha = fechaElegida();
  const fechaCola = fecha || new Date().toISOString();
  const projectId = getCurrentProjectId();
  if (!projectId) {
    announce('No se pudo determinar el proyecto activo.');
    return false;
  }

  if (!isOnline()) {
    return queueOfflineEntry({
      tipo: 'fotografia', projectId, content: texto || null, files, etiquetas, fecha: fechaCola,
    });
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !session.user) {
      announce('Debes iniciar sesión para registrar una novedad.');
      return false;
    }

    const urls = [];
    for (let i = 0; i < files.length; i += 1) {
      if (onProgress) {
        onProgress(i + 1, files.length);
      }
      // Se suben en secuencia para mostrar el progreso real de cada archivo.
      // eslint-disable-next-line no-await-in-loop
      const url = await uploadEntryFile(files[i], files[i].name, {
        ownerId: session.user.id,
        projectId,
      });
      urls.push(url);
    }

    const { error } = await guardarFila({
      ...filaBase({
        projectId, ownerId: session.user.id, tipo: 'fotografia', content: texto || null, etiquetas, fecha,
      }),
      photo_urls: urls,
    });

    if (error) {
      console.error('Error al guardar la fotografía:', error);
      announce('No se pudo guardar la fotografía. Intenta de nuevo.');
      return false;
    }

    return true;
  } catch (error) {
    if (isNetworkError(error)) {
      return queueOfflineEntry({
        tipo: 'fotografia', projectId, content: texto || null, files, etiquetas, fecha: fechaCola,
      });
    }
    console.error('Error al subir la fotografía:', error);
    announce('No se pudo subir la fotografía. Intenta de nuevo.');
    return false;
  }
}

async function insertVoiceEntry(texto, blob, durationLabel, etiquetas, onStatusChange) {
  const fecha = fechaElegida();
  const fechaCola = fecha || new Date().toISOString();
  const projectId = getCurrentProjectId();
  if (!projectId) {
    announce('No se pudo determinar el proyecto activo.');
    return false;
  }

  if (!isOnline()) {
    return queueOfflineEntry({
      tipo: 'nota-voz', projectId, content: texto || null, blob, durationLabel, etiquetas, fecha: fechaCola,
    });
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !session.user) {
      announce('Debes iniciar sesión para registrar una novedad.');
      return false;
    }

    if (onStatusChange) {
      onStatusChange('Subiendo audio...');
    }
    const extension = (blob.type.split('/')[1] || 'webm').split(';')[0];
    const audioUrl = await uploadEntryFile(blob, `nota-de-voz.${extension}`, {
      ownerId: session.user.id,
      projectId,
    });

    if (onStatusChange) {
      onStatusChange('Transcribiendo audio...');
    }
    // Transcripción automática — no bloquea el guardado si falla.
    const transcription = await transcribeAudio(audioUrl);

    const { error } = await guardarFila({
      ...filaBase({
        projectId, ownerId: session.user.id, tipo: 'nota-voz', content: texto || null, etiquetas, fecha,
      }),
      audio_url: audioUrl,
      audio_duration: durationLabel || null,
      audio_transcription: transcription,
    });

    if (error) {
      console.error('Error al guardar la nota de voz:', error);
      announce('No se pudo guardar la nota de voz. Intenta de nuevo.');
      return false;
    }

    if (!transcription) {
      announce('Nota de voz guardada. No se pudo generar la transcripción automática.');
    }

    return true;
  } catch (error) {
    if (isNetworkError(error)) {
      return queueOfflineEntry({
        tipo: 'nota-voz', projectId, content: texto || null, blob, durationLabel, etiquetas, fecha: fechaCola,
      });
    }
    console.error('Error al subir la nota de voz:', error);
    announce('No se pudo subir la nota de voz. Intenta de nuevo.');
    return false;
  }
}

/**
 * Guarda un registro en la cola local (IndexedDB) cuando no hay
 * conexión, y avisa al usuario con un mensaje distinto al de
 * "guardado" normal, para que sepa que quedó pendiente de subir.
 */
async function queueOfflineEntry(record) {
  try {
    await queueEntry(record);
    announce('Sin conexión: se guardó en tu celular y se subirá cuando vuelva la señal.');
    updatePendingBadge();
    return true;
  } catch (error) {
    console.error('No se pudo guardar el registro sin conexión:', error);
    announce('No se pudo guardar el registro. Intenta de nuevo.');
    return false;
  }
}

/* --------------------------------------------------------------------------
   SINCRONIZACIÓN DE REGISTROS PENDIENTES
   -------------------------------------------------------------------------- */

let syncInProgress = false;

/**
 * Recorre los registros guardados sin conexión y los sube uno por
 * uno, en el orden en que se crearon. Si alguno todavía no puede
 * subir (sigue sin señal), se detiene ahí y lo intenta de nuevo la
 * próxima vez — así no se pierde el orden ni se reintenta en desorden.
 */
async function syncPendingEntries() {
  if (syncInProgress || !isOnline()) {
    return;
  }
  syncInProgress = true;

  try {
    const pending = await getPendingEntries();
    pending.sort((a, b) => a.queuedAt - b.queuedAt);

    // eslint-disable-next-line no-restricted-syntax
    for (const record of pending) {
      let subida = false;

      // eslint-disable-next-line no-await-in-loop
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !session.user) {
        break;
      }

      try {
        if (record.tipo === 'fotografia') {
          const urls = [];
          // eslint-disable-next-line no-restricted-syntax
          for (const file of record.files) {
            // eslint-disable-next-line no-await-in-loop
            const url = await uploadEntryFile(file, file.name, {
              ownerId: session.user.id,
              projectId: record.projectId,
            });
            urls.push(url);
          }
          // eslint-disable-next-line no-await-in-loop
          const { error } = await guardarFila({
            ...filaBase({
              projectId: record.projectId,
              ownerId: session.user.id,
              tipo: 'fotografia',
              content: record.content,
              etiquetas: record.etiquetas,
              fecha: fechaParaSubir(record.fecha),
            }),
            photo_urls: urls,
          });
          subida = !error;
        } else if (record.tipo === 'nota-voz') {
          const extension = (record.blob.type.split('/')[1] || 'webm').split(';')[0];
          // eslint-disable-next-line no-await-in-loop
          const audioUrl = await uploadEntryFile(record.blob, `nota-de-voz.${extension}`, {
            ownerId: session.user.id,
            projectId: record.projectId,
          });
          // eslint-disable-next-line no-await-in-loop
          const transcription = await transcribeAudio(audioUrl);
          // eslint-disable-next-line no-await-in-loop
          const { error } = await guardarFila({
            ...filaBase({
              projectId: record.projectId,
              ownerId: session.user.id,
              tipo: 'nota-voz',
              content: record.content,
              etiquetas: record.etiquetas,
              fecha: fechaParaSubir(record.fecha),
            }),
            audio_url: audioUrl,
            audio_duration: record.durationLabel || null,
            audio_transcription: transcription,
          });
          subida = !error;
        } else {
          // Novedad, ensayo, evento SST o avance (sin archivos)
          // eslint-disable-next-line no-await-in-loop
          const { error } = await guardarFila(filaBase({
            projectId: record.projectId,
            ownerId: session.user.id,
            tipo: record.tipo,
            content: record.content,
            etiquetas: record.etiquetas,
            datos: record.datos,
            fecha: fechaParaSubir(record.fecha),
          }));
          subida = !error;
        }
      } catch (error) {
        // Se cayó la señal a mitad de la subida: se detiene aquí y
        // se reintenta todo desde este registro la próxima vez.
        subida = false;
      }

      if (!subida) {
        break;
      }

      // eslint-disable-next-line no-await-in-loop
      await removePendingEntry(record.id);
    }
  } finally {
    syncInProgress = false;
    updatePendingBadge();
    document.dispatchEvent(new CustomEvent('bcivil:entry-saved'));
  }
}

/* --------------------------------------------------------------------------
   INDICADOR VISUAL DE REGISTROS PENDIENTES
   -------------------------------------------------------------------------- */
let pendingBadgeEl = null;

async function updatePendingBadge() {
  const count = await countPendingEntries();

  if (!pendingBadgeEl) {
    if (!count) {
      return;
    }
    pendingBadgeEl = document.createElement('div');
    pendingBadgeEl.id = 'bcivil-pending-badge';
    pendingBadgeEl.className = 'pending-sync-badge';
    document.body.appendChild(pendingBadgeEl);
  }

  if (!count) {
    pendingBadgeEl.remove();
    pendingBadgeEl = null;
    return;
  }

  pendingBadgeEl.textContent = count === 1
    ? '1 registro pendiente de subir'
    : `${count} registros pendientes de subir`;
  pendingBadgeEl.hidden = false;
}

document.addEventListener('bcivil:queue-changed', updatePendingBadge);
window.addEventListener('online', syncPendingEntries);
window.addEventListener('DOMContentLoaded', () => {
  updatePendingBadge();
  syncPendingEntries();
});

/* --------------------------------------------------------------------------
   CAMPOS REUTILIZABLES DEL FORMULARIO
   -------------------------------------------------------------------------- */
const ETIQUETAS = ['Calidad', 'SST', 'Ambiental', 'Administrativo'];

/**
 * Etiquetas opcionales de un toque. Permiten que los informes ubiquen
 * cada registro en su sección (calidad, SST, ambiental, administrativa).
 */
/* --------------------------------------------------------------------------
   FECHA DEL REGISTRO: "Ahora" o un día anterior (registro anexado)
   -------------------------------------------------------------------------- */
const MS_MINUTO = 60 * 1000;

/** Fecha local → valor de <input type="datetime-local"> (AAAA-MM-DDTHH:MM) */
function aValorLocal(date) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * MS_MINUTO);
  return d.toISOString().slice(0, 16);
}

/** Fecha elegida en el formulario abierto (ISO) o null si es "ahora" */
function fechaElegida() {
  return activeFechaField ? activeFechaField.getISO() : null;
}

/**
 * Fecha para un registro que estaba en la cola sin señal. Se respeta la
 * hora en que se capturó; si el reloj del celular quedó adelantado, se
 * deja que el servidor ponga la hora.
 */
function fechaParaSubir(fecha) {
  if (!fecha) {
    return undefined;
  }
  const t = new Date(fecha).getTime();
  if (Number.isNaN(t) || t > Date.now()) {
    return undefined;
  }
  return new Date(t).toISOString();
}

function formatearFechaCorta(date) {
  return date.toLocaleString('es-CO', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

function createFechaField() {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field capture-fecha-field';

  const fila = document.createElement('div');
  fila.className = 'capture-fecha-row';

  const label = document.createElement('span');
  label.className = 'capture-fecha-label';
  label.textContent = 'Fecha del registro';

  const resumen = document.createElement('span');
  resumen.className = 'capture-fecha-resumen';
  resumen.textContent = 'Ahora';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'capture-fecha-toggle';
  toggle.textContent = 'Es de otro día';
  toggle.setAttribute('aria-expanded', 'false');

  const textos = document.createElement('div');
  textos.className = 'capture-fecha-textos';
  textos.appendChild(label);
  textos.appendChild(resumen);
  fila.appendChild(textos);
  fila.appendChild(toggle);

  const panel = document.createElement('div');
  panel.className = 'capture-fecha-panel';
  panel.hidden = true;

  const inputId = `captura-fecha-${Math.random().toString(36).slice(2, 7)}`;
  toggle.setAttribute('aria-controls', inputId);

  const inputLabel = document.createElement('label');
  inputLabel.setAttribute('for', inputId);
  inputLabel.textContent = '¿Cuándo ocurrió?';

  const input = document.createElement('input');
  input.type = 'datetime-local';
  input.id = inputId;

  const hint = document.createElement('p');
  hint.className = 'form-hint';
  hint.textContent = 'Se guarda en ese día de la bitácora y queda marcado como "Anexado", con la fecha real en que lo subiste.';

  panel.appendChild(inputLabel);
  panel.appendChild(input);
  panel.appendChild(hint);

  wrapper.appendChild(fila);
  wrapper.appendChild(panel);

  let abierto = false;

  function abrir() {
    abierto = true;
    const ahora = new Date();
    const ayer = new Date(ahora.getTime() - 24 * 60 * MS_MINUTO);
    input.max = aValorLocal(ahora);
    if (!input.value) {
      input.value = aValorLocal(ayer);
    }
    panel.hidden = false;
    toggle.textContent = 'Usar ahora';
    toggle.setAttribute('aria-expanded', 'true');
    actualizarResumen();
    input.focus();
  }

  function cerrar() {
    abierto = false;
    panel.hidden = true;
    clearFieldError(input);
    toggle.textContent = 'Es de otro día';
    toggle.setAttribute('aria-expanded', 'false');
    resumen.textContent = 'Ahora';
    wrapper.classList.remove('is-anexado');
  }

  function leer() {
    if (!abierto || !input.value) {
      return null;
    }
    const fecha = new Date(input.value);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  function actualizarResumen() {
    const fecha = leer();
    resumen.textContent = fecha ? formatearFechaCorta(fecha) : 'Elige la fecha';
    wrapper.classList.toggle('is-anexado', Boolean(fecha));
  }

  toggle.addEventListener('click', () => (abierto ? cerrar() : abrir()));
  input.addEventListener('input', () => {
    clearFieldError(input);
    actualizarResumen();
  });

  return {
    element: wrapper,
    /** ISO de la fecha elegida, o null si es "ahora" */
    getISO() {
      const fecha = leer();
      // Si eligió prácticamente "ahora" (menos de 2 minutos), no es anexado
      if (!fecha || Math.abs(Date.now() - fecha.getTime()) < 2 * MS_MINUTO) {
        return null;
      }
      return fecha.toISOString();
    },
    validar() {
      if (!abierto) {
        return true;
      }
      const fecha = leer();
      if (!fecha) {
        setFieldError(input, 'Elige la fecha y hora en que ocurrió.');
        input.focus();
        return false;
      }
      if (fecha.getTime() > Date.now() + MS_MINUTO) {
        setFieldError(input, 'La fecha no puede ser futura.');
        input.focus();
        return false;
      }
      clearFieldError(input);
      return true;
    },
  };
}

function createTagsField() {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field capture-tags-field';

  const label = document.createElement('span');
  label.className = 'capture-tags-label';
  label.id = `captura-etiquetas-${Math.random().toString(36).slice(2, 7)}`;
  label.textContent = 'Etiquetas (opcional)';

  const group = document.createElement('div');
  group.className = 'capture-tags';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', label.id);

  const selected = new Set();

  ETIQUETAS.forEach((nombre) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'capture-tag';
    chip.dataset.etiqueta = nombre;
    chip.setAttribute('aria-pressed', 'false');
    chip.textContent = nombre;
    chip.addEventListener('click', () => {
      if (selected.has(nombre)) {
        selected.delete(nombre);
      } else {
        selected.add(nombre);
      }
      chip.setAttribute('aria-pressed', String(selected.has(nombre)));
    });
    group.appendChild(chip);
  });

  wrapper.appendChild(label);
  wrapper.appendChild(group);

  return {
    element: wrapper,
    getTags: () => ETIQUETAS.filter((e) => selected.has(e)),
  };
}

/** Campo de texto, número, lista o área de texto con su etiqueta */
function buildFormField({
  id, label, type = 'text', required = false, placeholder = '', options = null,
  min = null, max = null, step = null, inputMode = '', list = '', hint = '',
}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';

  const labelEl = document.createElement('label');
  labelEl.setAttribute('for', id);
  labelEl.textContent = label;
  wrapper.appendChild(labelEl);

  let input;
  if (type === 'textarea') {
    input = document.createElement('textarea');
  } else if (type === 'select') {
    input = document.createElement('select');
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Selecciona una opción';
    input.appendChild(blank);
    (options || []).forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      input.appendChild(option);
    });
  } else {
    input = document.createElement('input');
    input.type = type;
    if (min !== null) input.min = String(min);
    if (max !== null) input.max = String(max);
    if (step !== null) input.step = String(step);
    if (inputMode) input.inputMode = inputMode;
    if (list) input.setAttribute('list', list);
  }
  input.id = id;
  input.name = id;
  if (placeholder) input.placeholder = placeholder;
  if (required) {
    input.required = true;
    input.setAttribute('aria-required', 'true');
  }
  input.addEventListener('input', () => clearFieldError(input));
  input.addEventListener('change', () => clearFieldError(input));
  wrapper.appendChild(input);

  if (hint) {
    const hintEl = document.createElement('p');
    hintEl.className = 'capture-field-hint';
    hintEl.textContent = hint;
    wrapper.appendChild(hintEl);
  }

  return { wrapper, input };
}

/** Opciones excluyentes en una fila (por ejemplo, Cumple / No cumple / Pendiente) */
function createChoiceField({
  id, label, options, value,
}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';

  const labelEl = document.createElement('span');
  labelEl.className = 'capture-tags-label';
  labelEl.id = `${id}-label`;
  labelEl.textContent = label;

  const group = document.createElement('div');
  group.className = 'capture-choice';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', labelEl.id);

  let current = value;
  const buttons = options.map((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'capture-choice-option';
    btn.dataset.valor = opt.value;
    btn.setAttribute('role', 'radio');
    btn.textContent = opt.label;
    btn.addEventListener('click', () => {
      current = opt.value;
      paint();
    });
    group.appendChild(btn);
    return btn;
  });

  function paint() {
    buttons.forEach((btn) => {
      const on = btn.dataset.valor === current;
      btn.setAttribute('aria-checked', String(on));
      btn.classList.toggle('is-selected', on);
    });
  }
  paint();

  wrapper.appendChild(labelEl);
  wrapper.appendChild(group);

  return { element: wrapper, getValue: () => current };
}

/* --------------------------------------------------------------------------
   PASOS DEL MODAL: SELECCIÓN DE TIPO
   -------------------------------------------------------------------------- */
function buildChooserGroup(titulo, opciones) {
  const group = document.createElement('div');
  group.className = 'capture-chooser-group';

  const heading = document.createElement('p');
  heading.className = 'capture-chooser-heading';
  heading.textContent = titulo;
  group.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'capture-chooser';

  opciones.forEach(({ tipo, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.tipo = tipo;
    button.className = 'capture-chooser-option';
    button.appendChild(buildTypeIcon(tipo));

    const span = document.createElement('span');
    span.className = 'capture-chooser-option-label';
    span.textContent = label;
    button.appendChild(span);

    button.addEventListener('click', () => showCaptureForm(tipo));
    grid.appendChild(button);
  });

  group.appendChild(grid);
  return group;
}

function buildChooser() {
  const wrapper = document.createElement('div');
  wrapper.className = 'capture-chooser-wrap';

  wrapper.appendChild(buildChooserGroup('Registro rápido', [
    { tipo: 'texto', label: 'Novedad' },
    { tipo: 'fotografia', label: 'Fotografía' },
    { tipo: 'nota-voz', label: 'Nota de voz' },
  ]));

  wrapper.appendChild(buildChooserGroup('Control de obra', [
    { tipo: 'ensayo', label: 'Ensayo' },
    { tipo: 'sst', label: 'Evento SST' },
    { tipo: 'avance', label: 'Avance' },
  ]));

  return wrapper;
}

function showChooser() {
  if (!contentEl) {
    return;
  }
  contentEl.innerHTML = '';
  titleEl.textContent = 'Registrar';
  subtitleEl.textContent = 'Elige qué quieres registrar.';
  contentEl.appendChild(buildChooser());

  const firstOption = contentEl.querySelector('button');
  if (firstOption) {
    firstOption.focus();
  }
}

/* --------------------------------------------------------------------------
   REGISTRO RÁPIDO: NOVEDAD, FOTOGRAFÍA Y NOTA DE VOZ
   -------------------------------------------------------------------------- */
async function handleSubmit(tipo, {
  textArea, climaSelect, personalField, maquinariaField, observacionesTextarea,
  photoField, audioField, tagsField, submitBtn,
}) {
  const etiquetas = tagsField ? tagsField.getTags() : [];

  if (tipo === 'texto') {
    const value = textArea.value.trim();
    if (!value) {
      setFieldError(textArea, 'Escribe la novedad antes de guardar.');
      return;
    }
    if (climaSelect && !climaSelect.value) {
      setFieldError(climaSelect, 'Selecciona el clima antes de guardar.');
      climaSelect.focus();
      return;
    }
    clearFieldError(textArea);
    if (climaSelect) {
      clearFieldError(climaSelect);
    }

    const partes = [];
    if (climaSelect && climaSelect.value) {
      partes.push(`Clima: ${climaSelect.value}`);
    }
    if (personalField && personalField.getItems().length) {
      partes.push(`Personal en obra: ${personalField.getSummary()}`);
    }
    if (maquinariaField && maquinariaField.getItems().length) {
      partes.push(`Maquinaria en obra: ${maquinariaField.getSummary()}`);
    }
    if (observacionesTextarea && observacionesTextarea.value.trim()) {
      partes.push(`Observaciones: ${observacionesTextarea.value.trim()}`);
    }
    const encabezado = partes.length ? `${partes.join('\n')}\n\n` : '';

    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';
    const saved = await insertSimpleEntry({
      tipo: 'texto', content: `${encabezado}${value}`, etiquetas,
    });
    submitBtn.disabled = false;
    submitBtn.textContent = 'Guardar registro';

    if (saved) {
      finishSave();
    }
    return;
  }

  if (tipo === 'fotografia') {
    const descripcion = textArea.value.trim();
    if (!descripcion) {
      setFieldError(textArea, 'Describe la fotografía antes de guardar.');
      return;
    }
    clearFieldError(textArea);

    const files = photoField.getFiles();
    if (!files.length) {
      announce('Selecciona o toma al menos una fotografía antes de guardar.');
      return;
    }

    submitBtn.disabled = true;
    const saved = await insertPhotoEntry(descripcion, files, etiquetas, (current, total) => {
      submitBtn.textContent = `Subiendo ${current} de ${total}...`;
    });
    submitBtn.disabled = false;
    submitBtn.textContent = 'Guardar registro';

    if (saved) {
      finishSave();
    }
    return;
  }

  if (tipo === 'nota-voz') {
    const blob = audioField.getBlob();
    if (!blob) {
      announce('Graba una nota de voz antes de guardar.');
      return;
    }

    submitBtn.disabled = true;
    const saved = await insertVoiceEntry(
      null,
      blob,
      audioField.getDurationLabel(),
      etiquetas,
      (status) => { submitBtn.textContent = status; },
    );
    submitBtn.disabled = false;
    submitBtn.textContent = 'Guardar registro';

    if (saved) {
      finishSave();
    }
  }
}

function finishSave() {
  const anexado = Boolean(fechaElegida());
  announce(anexado
    ? 'Registro anexado en su fecha. Quedará marcado como "Anexado".'
    : 'Registro guardado correctamente.');
  // Cualquier página puede escuchar este evento para refrescarse a sí
  // misma (por ejemplo, bitacora.html recarga su línea de tiempo).
  document.dispatchEvent(new CustomEvent('bcivil:entry-saved'));
  closeModal();
}

const CLIMA_OPTIONS = ['Soleado', 'Nublado', 'Lluvia', 'Viento fuerte'];
const PERSONAL_SUGERENCIAS = ['Obrero', 'Maestro de obra', 'Ing. residente', 'Interventor', 'Ayudante'];
const MAQUINARIA_SUGERENCIAS = ['Vibrocompactadora', 'Pajarita', 'Retroexcavadora', 'Mezcladora', 'Volqueta', 'Grúa'];

/**
 * Campo de "lista con conteo": permite agregar renglones tipo
 * "3 Obreros" o "1 Vibrocompactadora", cada uno con su propia cantidad
 * y una descripción libre (con sugerencias vía datalist, pero el
 * usuario puede escribir cualquier cosa). Se usa tanto para personal
 * como para maquinaria en el formulario de tipo texto.
 */
function createTallyListField({
  fieldId, legend, namePlaceholder, addLabel, suggestions,
}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field capture-tally-field';

  const label = document.createElement('label');
  label.textContent = legend;
  wrapper.appendChild(label);

  const list = document.createElement('ul');
  list.className = 'capture-tally-list';
  list.setAttribute('role', 'list');
  wrapper.appendChild(list);

  const addRow = document.createElement('div');
  addRow.className = 'capture-tally-add-row';

  const qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.min = '1';
  qtyInput.value = '1';
  qtyInput.className = 'capture-tally-qty';
  qtyInput.setAttribute('aria-label', 'Cantidad');
  qtyInput.id = `${fieldId}-cantidad`;

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = namePlaceholder;
  nameInput.className = 'capture-tally-name';
  nameInput.setAttribute('aria-label', namePlaceholder);
  nameInput.id = `${fieldId}-nombre`;

  if (suggestions && suggestions.length) {
    const datalist = document.createElement('datalist');
    datalist.id = `${fieldId}-sugerencias`;
    suggestions.forEach((sugerencia) => {
      const option = document.createElement('option');
      option.value = sugerencia;
      datalist.appendChild(option);
    });
    nameInput.setAttribute('list', datalist.id);
    wrapper.appendChild(datalist);
  }

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-secondary capture-tally-add-btn';
  addBtn.textContent = addLabel;

  addRow.appendChild(qtyInput);
  addRow.appendChild(nameInput);
  addRow.appendChild(addBtn);
  wrapper.appendChild(addRow);

  let items = [];

  function renderList() {
    list.innerHTML = '';
    items.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = 'capture-tally-item';

      const text = document.createElement('span');
      text.textContent = `${item.cantidad} ${item.nombre}`;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'capture-tally-remove';
      removeBtn.setAttribute('aria-label', `Quitar ${item.nombre}`);
      removeBtn.addEventListener('click', () => {
        items = items.filter((_, i) => i !== index);
        renderList();
      });

      li.appendChild(text);
      li.appendChild(removeBtn);
      list.appendChild(li);
    });
  }

  function addItem() {
    const nombre = nameInput.value.trim();
    if (!nombre) {
      nameInput.focus();
      return;
    }
    const cantidad = Math.max(1, Number(qtyInput.value) || 1);
    items.push({ cantidad, nombre });
    renderList();
    nameInput.value = '';
    qtyInput.value = '1';
    nameInput.focus();
  }

  addBtn.addEventListener('click', addItem);
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addItem();
    }
  });

  return {
    element: wrapper,
    getItems: () => items.slice(),
    getSummary: () => items.map((item) => `${item.cantidad} ${item.nombre}`).join(', '),
  };
}

/** Cabecera común de los formularios (ícono, título y subtítulo) */
function startForm(tipo, subtitulo) {
  resetActiveCaptureFields();
  contentEl.innerHTML = '';
  titleEl.textContent = TYPE_LABELS[tipo] || tipo;
  subtitleEl.textContent = subtitulo;

  const headerIcon = document.createElement('span');
  headerIcon.className = 'capture-type-header-icon';
  headerIcon.dataset.tipo = tipo;
  headerIcon.appendChild(buildTypeIcon(tipo));
  contentEl.appendChild(headerIcon);

  const form = document.createElement('form');
  form.noValidate = true;
  return form;
}

/** Botones Guardar / Atrás comunes */
function buildFormActions(form) {
  activeFechaField = createFechaField();
  form.appendChild(activeFechaField.element);
  // Se registra antes que el envío de cada formulario: si la fecha no
  // es válida, el registro no se guarda.
  form.addEventListener('submit', (event) => {
    if (activeFechaField && !activeFechaField.validar()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  });

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'btn btn-primary';
  submitBtn.textContent = 'Guardar registro';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'btn btn-secondary';
  backBtn.textContent = 'Atrás';
  backBtn.addEventListener('click', () => {
    resetActiveCaptureFields();
    showChooser();
  });

  actions.appendChild(submitBtn);
  actions.appendChild(backBtn);
  form.appendChild(actions);
  return submitBtn;
}

function showCaptureForm(tipo) {
  if (!contentEl) {
    return;
  }

  if (TIPOS_ESTRUCTURADOS.includes(tipo)) {
    showStructuredForm(tipo);
    return;
  }

  const form = startForm(tipo, 'Pocos pasos: completa y guarda tu registro.');

  let textArea = null;
  let climaSelect = null;
  let personalField = null;
  let maquinariaField = null;
  let observacionesTextarea = null;
  let photoField = null;
  let audioField = null;
  const tagsField = createTagsField();

  if (tipo === 'texto') {
    const climaWrapper = document.createElement('div');
    climaWrapper.className = 'form-field';
    const climaLabel = document.createElement('label');
    climaLabel.setAttribute('for', 'captura-clima');
    climaLabel.textContent = 'Clima';
    climaSelect = document.createElement('select');
    climaSelect.id = 'captura-clima';
    climaSelect.required = true;
    climaSelect.setAttribute('aria-required', 'true');
    const blankOption = document.createElement('option');
    blankOption.value = '';
    blankOption.textContent = 'Selecciona el clima';
    climaSelect.appendChild(blankOption);
    CLIMA_OPTIONS.forEach((label) => {
      const option = document.createElement('option');
      option.value = label;
      option.textContent = label;
      climaSelect.appendChild(option);
    });
    climaWrapper.appendChild(climaLabel);
    climaWrapper.appendChild(climaSelect);
    form.appendChild(climaWrapper);

    personalField = createTallyListField({
      fieldId: 'captura-personal',
      legend: 'Personal en obra',
      namePlaceholder: 'Ej: Obrero, Maestro de obra, Residente',
      addLabel: 'Agregar personal',
      suggestions: PERSONAL_SUGERENCIAS,
    });
    form.appendChild(personalField.element);

    maquinariaField = createTallyListField({
      fieldId: 'captura-maquinaria',
      legend: 'Maquinaria o equipo en obra',
      namePlaceholder: 'Ej: Vibrocompactadora, Pajarita',
      addLabel: 'Agregar maquinaria',
      suggestions: MAQUINARIA_SUGERENCIAS,
    });
    form.appendChild(maquinariaField.element);

    const observacionesWrapper = document.createElement('div');
    observacionesWrapper.className = 'form-field';
    const observacionesLabel = document.createElement('label');
    observacionesLabel.setAttribute('for', 'captura-observaciones');
    observacionesLabel.textContent = 'Observaciones adicionales (opcional)';
    observacionesTextarea = document.createElement('textarea');
    observacionesTextarea.id = 'captura-observaciones';
    observacionesTextarea.placeholder = 'Cualquier detalle extra que no encaje arriba: incidentes, entregas de material, visitas, etc.';
    observacionesWrapper.appendChild(observacionesLabel);
    observacionesWrapper.appendChild(observacionesTextarea);
    form.appendChild(observacionesWrapper);

    const textWrapper = document.createElement('div');
    textWrapper.className = 'form-field';
    const textLabel = document.createElement('label');
    textLabel.setAttribute('for', 'captura-texto');
    textLabel.textContent = 'Novedad';
    textArea = document.createElement('textarea');
    textArea.id = 'captura-texto';
    textArea.name = 'texto';
    textArea.required = true;
    textArea.setAttribute('aria-required', 'true');
    textWrapper.appendChild(textLabel);
    textWrapper.appendChild(textArea);
    form.appendChild(textWrapper);
  }

  if (tipo === 'fotografia') {
    const textWrapper = document.createElement('div');
    textWrapper.className = 'form-field';
    const textLabel = document.createElement('label');
    textLabel.setAttribute('for', 'captura-texto');
    textLabel.textContent = 'Descripción';
    textArea = document.createElement('textarea');
    textArea.id = 'captura-texto';
    textArea.name = 'texto';
    textArea.required = true;
    textArea.setAttribute('aria-required', 'true');
    textArea.placeholder = 'Describe qué muestra esta fotografía.';
    textWrapper.appendChild(textLabel);
    textWrapper.appendChild(textArea);
    form.appendChild(textWrapper);

    photoField = createPhotoField();
    activePhotoField = photoField;
    form.appendChild(photoField.element);
  }

  if (tipo === 'nota-voz') {
    audioField = createAudioField();
    activeAudioField = audioField;
    form.appendChild(audioField.element);
  }

  form.appendChild(tagsField.element);
  const submitBtn = buildFormActions(form);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    handleSubmit(tipo, {
      textArea,
      climaSelect,
      personalField,
      maquinariaField,
      observacionesTextarea,
      photoField,
      audioField,
      tagsField,
      submitBtn,
    });
  });

  contentEl.appendChild(form);

  if (tipo === 'nota-voz') {
    const recordTrigger = form.querySelector('button');
    if (recordTrigger) {
      recordTrigger.focus();
    }
  } else if (textArea) {
    textArea.focus();
  }
}

/* --------------------------------------------------------------------------
   CONTROL DE OBRA: ENSAYO, EVENTO SST Y AVANCE
   -------------------------------------------------------------------------- */
const ENSAYOS = [
  'Resistencia a compresión del concreto (cilindros)',
  'Asentamiento del concreto (slump)',
  'Densidad en sitio / compactación',
  'Proctor modificado',
  'Granulometría de agregados',
  'CBR',
  'Resistencia del acero de refuerzo',
  'Prueba de presión o estanqueidad',
  'Otro',
];

const ESTADOS_ENSAYO = {
  cumple: 'Cumple',
  'no-cumple': 'No cumple',
  pendiente: 'Pendiente de verificación',
};

const EVENTOS_SST = [
  'Charla de seguridad',
  'Inspección de seguridad',
  'Capacitación',
  'Entrega de EPP',
  'Incidente (sin lesión)',
  'Accidente de trabajo',
  'Otro',
];

const UNIDADES = ['m³', 'm²', 'm', 'kg', 'un', 'glb'];

function formatearNumero(valor) {
  return Number(valor).toLocaleString('es-CO', { maximumFractionDigits: 3 });
}

function showStructuredForm(tipo) {
  const subtitulos = {
    ensayo: 'Deja constancia del ensayo y de su resultado.',
    sst: 'Registra una charla, inspección, incidente o accidente.',
    avance: 'Anota qué actividad avanzó y cuánto se ejecutó.',
  };
  const form = startForm(tipo, subtitulos[tipo]);
  const campos = {};
  let choice = null;
  let hintEvento = null;

  const agregar = (campo) => {
    campos[campo.input.id] = campo.input;
    form.appendChild(campo.wrapper);
    return campo;
  };

  if (tipo === 'ensayo') {
    const tipoEnsayo = agregar(buildFormField({
      id: 'ensayo-tipo', label: 'Tipo de ensayo', type: 'select', required: true, options: ENSAYOS,
    }));
    const otro = agregar(buildFormField({
      id: 'ensayo-otro', label: '¿Qué ensayo?', required: true, placeholder: 'Nombre del ensayo',
    }));
    otro.wrapper.hidden = true;
    tipoEnsayo.input.addEventListener('change', () => {
      otro.wrapper.hidden = tipoEnsayo.input.value !== 'Otro';
    });
    agregar(buildFormField({
      id: 'ensayo-elemento', label: 'Elemento o ubicación', required: true, placeholder: 'Ej. Placa nivel 3, eje B–C',
    }));
    agregar(buildFormField({
      id: 'ensayo-resultado', label: 'Resultado obtenido', required: true, placeholder: 'Ej. 24,5 MPa a 7 días',
    }));
    agregar(buildFormField({
      id: 'ensayo-especificado', label: 'Valor especificado (opcional)', placeholder: 'Ej. 21 MPa a 28 días',
    }));
    choice = createChoiceField({
      id: 'ensayo-estado',
      label: 'Estado',
      value: 'pendiente',
      options: [
        { value: 'cumple', label: 'Cumple' },
        { value: 'no-cumple', label: 'No cumple' },
        { value: 'pendiente', label: 'Pendiente' },
      ],
    });
    form.appendChild(choice.element);
    agregar(buildFormField({ id: 'ensayo-laboratorio', label: 'Laboratorio (opcional)' }));
    agregar(buildFormField({ id: 'ensayo-observaciones', label: 'Observaciones (opcional)', type: 'textarea' }));
  }

  if (tipo === 'sst') {
    const evento = agregar(buildFormField({
      id: 'sst-evento', label: 'Tipo de evento', type: 'select', required: true, options: EVENTOS_SST,
    }));
    const trabajador = agregar(buildFormField({
      id: 'sst-trabajador',
      label: 'Trabajador involucrado (opcional)',
      placeholder: 'Nombre del trabajador',
      list: 'captura-sst-personal',
    }));
    const datalist = document.createElement('datalist');
    datalist.id = 'captura-sst-personal';
    trabajador.wrapper.appendChild(datalist);
    cargarPersonal(getCurrentProjectId()).then((lista) => {
      lista.forEach((p) => {
        const option = document.createElement('option');
        option.value = p.nombre;
        datalist.appendChild(option);
      });
    });
    agregar(buildFormField({
      id: 'sst-descripcion', label: 'Descripción', type: 'textarea', required: true, placeholder: 'Qué ocurrió o qué se trató.',
    }));
    hintEvento = document.createElement('p');
    hintEvento.className = 'capture-field-hint capture-field-hint--aviso';
    hintEvento.hidden = true;
    hintEvento.textContent = 'Si hubo una lesión, después genera el "Reporte de incidente o accidente" en Documentos.';
    form.appendChild(hintEvento);
    evento.input.addEventListener('change', () => {
      hintEvento.hidden = !/Incidente|Accidente/.test(evento.input.value);
    });
  }

  if (tipo === 'avance') {
    agregar(buildFormField({
      id: 'avance-actividad', label: 'Actividad', required: true, placeholder: 'Ej. Vaciado de placa nivel 3',
    }));
    const fila = document.createElement('div');
    fila.className = 'form-row';
    const cantidad = buildFormField({
      id: 'avance-cantidad', label: 'Cantidad ejecutada', type: 'number', required: true, min: 0, step: 'any', inputMode: 'decimal', placeholder: '0',
    });
    const unidad = buildFormField({
      id: 'avance-unidad', label: 'Unidad', type: 'select', required: true, options: UNIDADES,
    });
    campos['avance-cantidad'] = cantidad.input;
    campos['avance-unidad'] = unidad.input;
    fila.appendChild(cantidad.wrapper);
    fila.appendChild(unidad.wrapper);
    form.appendChild(fila);
    agregar(buildFormField({
      id: 'avance-acumulado', label: 'Avance acumulado de la actividad, % (opcional)', type: 'number', min: 0, max: 100, step: 'any', inputMode: 'decimal', placeholder: 'Ej. 60',
    }));
    agregar(buildFormField({ id: 'avance-observaciones', label: 'Observaciones (opcional)', type: 'textarea' }));
  }

  const submitBtn = buildFormActions(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const v = (id) => (campos[id] ? campos[id].value.trim() : '');
    let primerError = null;
    const exigir = (id, mensaje) => {
      clearFieldError(campos[id]);
      if (!v(id)) {
        setFieldError(campos[id], mensaje);
        if (!primerError) primerError = campos[id];
      }
    };

    let content = '';
    let datos = null;
    let etiquetas = [];

    if (tipo === 'ensayo') {
      exigir('ensayo-tipo', 'Selecciona el tipo de ensayo.');
      if (v('ensayo-tipo') === 'Otro') exigir('ensayo-otro', 'Escribe qué ensayo se realizó.');
      exigir('ensayo-elemento', 'Indica el elemento o la ubicación.');
      exigir('ensayo-resultado', 'Escribe el resultado obtenido.');
      if (!primerError) {
        const nombre = v('ensayo-tipo') === 'Otro' ? v('ensayo-otro') : v('ensayo-tipo');
        const estado = choice.getValue();
        datos = {
          ensayo: nombre,
          elemento: v('ensayo-elemento'),
          resultado: v('ensayo-resultado'),
          especificado: v('ensayo-especificado'),
          estado,
          laboratorio: v('ensayo-laboratorio'),
          observaciones: v('ensayo-observaciones'),
        };
        const lineas = [
          `Ensayo: ${datos.ensayo}`,
          `Elemento: ${datos.elemento}`,
          `Resultado: ${datos.resultado}`,
          datos.especificado ? `Valor especificado: ${datos.especificado}` : '',
          `Estado: ${ESTADOS_ENSAYO[estado]}`,
          datos.laboratorio ? `Laboratorio: ${datos.laboratorio}` : '',
          datos.observaciones ? `Observaciones: ${datos.observaciones}` : '',
        ];
        content = lineas.filter(Boolean).join('\n');
        etiquetas = ['Calidad'];
      }
    }

    if (tipo === 'sst') {
      exigir('sst-evento', 'Selecciona el tipo de evento.');
      exigir('sst-descripcion', 'Describe el evento.');
      if (!primerError) {
        datos = {
          evento: v('sst-evento'),
          trabajador: v('sst-trabajador'),
          descripcion: v('sst-descripcion'),
        };
        content = [
          `Evento SST: ${datos.evento}`,
          datos.trabajador ? `Trabajador involucrado: ${datos.trabajador}` : '',
          `Descripción: ${datos.descripcion}`,
        ].filter(Boolean).join('\n');
        etiquetas = ['SST'];
      }
    }

    if (tipo === 'avance') {
      exigir('avance-actividad', 'Escribe la actividad.');
      exigir('avance-cantidad', 'Indica la cantidad ejecutada.');
      exigir('avance-unidad', 'Selecciona la unidad.');
      if (v('avance-cantidad') && Number(v('avance-cantidad')) < 0) {
        setFieldError(campos['avance-cantidad'], 'La cantidad no puede ser negativa.');
        if (!primerError) primerError = campos['avance-cantidad'];
      }
      clearFieldError(campos['avance-acumulado']);
      const acumulado = v('avance-acumulado');
      if (acumulado && (Number(acumulado) < 0 || Number(acumulado) > 100)) {
        setFieldError(campos['avance-acumulado'], 'Debe estar entre 0 y 100.');
        if (!primerError) primerError = campos['avance-acumulado'];
      }
      if (!primerError) {
        datos = {
          actividad: v('avance-actividad'),
          cantidad: Number(v('avance-cantidad')),
          unidad: v('avance-unidad'),
          acumulado: acumulado ? Number(acumulado) : null,
          observaciones: v('avance-observaciones'),
        };
        content = [
          `Avance: ${datos.actividad}`,
          `Cantidad ejecutada: ${formatearNumero(datos.cantidad)} ${datos.unidad}`,
          datos.acumulado !== null ? `Avance acumulado de la actividad: ${formatearNumero(datos.acumulado)} %` : '',
          datos.observaciones ? `Observaciones: ${datos.observaciones}` : '',
        ].filter(Boolean).join('\n');
      }
    }

    if (primerError) {
      primerError.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';
    const saved = await insertSimpleEntry({
      tipo, content, datos, etiquetas,
    });
    submitBtn.disabled = false;
    submitBtn.textContent = 'Guardar registro';

    if (saved) {
      finishSave();
    }
  });

  contentEl.appendChild(form);
  const primero = form.querySelector('select, input, textarea');
  if (primero) {
    primero.focus({ preventScroll: true });
  }
}

/* --------------------------------------------------------------------------
   APERTURA DEL MODAL
   -------------------------------------------------------------------------- */
function openRegistroModal() {
  if (overlayEl) {
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'registro-rapido-titulo');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.setAttribute('aria-label', 'Cerrar');
  closeBtn.textContent = 'Cerrar';
  closeBtn.addEventListener('click', closeModal);

  const title = document.createElement('h2');
  title.id = 'registro-rapido-titulo';
  title.className = 'modal-title';
  title.textContent = 'Registrar';

  const subtitle = document.createElement('p');
  subtitle.className = 'modal-subtitle';
  subtitle.textContent = 'Elige qué quieres registrar.';

  const content = document.createElement('div');
  content.className = 'capture-content';
  content.appendChild(buildChooser());

  dialog.appendChild(closeBtn);
  dialog.appendChild(title);
  dialog.appendChild(subtitle);
  dialog.appendChild(content);
  overlay.appendChild(dialog);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeModal();
    }
  });

  document.body.appendChild(overlay);
  document.addEventListener('keydown', handleKeydown);

  overlayEl = overlay;
  titleEl = title;
  subtitleEl = subtitle;
  contentEl = content;

  const firstOption = content.querySelector('button');
  if (firstOption) {
    firstOption.focus();
  }
}

/* --------------------------------------------------------------------------
   INYECCIÓN DEL BOTÓN FLOTANTE
   -------------------------------------------------------------------------- */
function injectFab() {
  if (document.getElementById('global-quick-register-fab')) {
    return document.getElementById('global-quick-register-fab');
  }

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.id = 'global-quick-register-fab';
  fab.className = 'global-fab';
  fab.setAttribute('aria-label', 'Registrar novedad');

  const plus = document.createElementNS(SVG_NS, 'svg');
  plus.setAttribute('viewBox', '0 0 24 24');
  plus.setAttribute('fill', 'none');
  plus.setAttribute('stroke', 'currentColor');
  plus.setAttribute('stroke-width', '2');
  plus.setAttribute('stroke-linecap', 'round');
  plus.setAttribute('aria-hidden', 'true');
  const plusPath = document.createElementNS(SVG_NS, 'path');
  plusPath.setAttribute('d', 'M12 5v14M5 12h14');
  plus.appendChild(plusPath);
  fab.appendChild(plus);

  document.body.appendChild(fab);
  return fab;
}

function init() {
  const fab = injectFab();
  triggerEl = fab;
  fab.addEventListener('click', () => {
    openRegistroModal();
    fab.classList.add('is-open');
  });
}

document.addEventListener('DOMContentLoaded', init);