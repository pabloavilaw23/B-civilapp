/**
 * papelera.js
 * Papelera real, conectada a Supabase. Muestra los proyectos que
 * tienen "deleted_at" (eliminados desde proyecto.js), permite
 * restaurarlos, y permite borrarlos DE VERDAD para siempre —
 * incluyendo sus registros de bitácora y las fotos/audios que
 * tengan guardados, para no dejar archivos huérfanos.
 *
 * Igual que la papelera del iPhone: cualquier proyecto que lleve más
 * de 15 días eliminado se borra solo, automáticamente, la próxima vez
 * que alguien abre esta página.
 *
 * Cambios de la versión de rediseño (la lógica de borrado no cambia):
 *  - Cada tarjeta muestra la fecha en que se eliminó y una barra
 *    rayada con el tiempo que le queda antes del borrado automático.
 *    En los últimos 3 días el aviso pasa a rojo.
 *  - Al restaurar o eliminar, la tarjeta sale con una animación breve.
 */

import { supabase } from '../config/supabase.js';
import { announce } from '../app-shell.js';
import { confirmDialog } from '../utils/alertas.js';

const DIAS_ANTES_DE_BORRAR = 15;
const DIA_MS = 24 * 60 * 60 * 1000;
const BUCKET = 'bitacora-media';

/* ============================================================================
   BORRADO DEFINITIVO EN CASCADA
   ============================================================================ */

/**
 * Saca la ruta interna del archivo (la que necesita Supabase Storage
 * para borrarlo) a partir de la URL pública completa guardada en la
 * bitácora.
 */
function extractStoragePath(url) {
  if (!url) {
    return null;
  }
  const marker = `/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) {
    return null;
  }
  return url.slice(idx + marker.length);
}

/**
 * Borra por completo un proyecto: sus fotos y audios guardados,
 * todos sus registros de bitácora, y finalmente el proyecto mismo.
 */
async function purgeProjectCompletely(projectId) {
  const { data: entries, error: entriesError } = await supabase
    .from('bitacora_entries')
    .select('photo_urls, audio_url')
    .eq('project_id', projectId);

  if (entriesError) {
    console.error('No se pudieron leer los registros del proyecto antes de borrarlo:', entriesError);
  }

  const filePaths = [];
  (entries || []).forEach((entry) => {
    (entry.photo_urls || []).forEach((url) => {
      const path = extractStoragePath(url);
      if (path) {
        filePaths.push(path);
      }
    });
    const audioPath = extractStoragePath(entry.audio_url);
    if (audioPath) {
      filePaths.push(audioPath);
    }
  });

  if (filePaths.length) {
    const { error: storageError } = await supabase.storage.from(BUCKET).remove(filePaths);
    if (storageError) {
      console.error('No se pudieron borrar algunos archivos del proyecto:', storageError);
    }
  }

  const { error: deleteEntriesError } = await supabase
    .from('bitacora_entries')
    .delete()
    .eq('project_id', projectId);
  if (deleteEntriesError) {
    console.error('No se pudieron borrar los registros del proyecto:', deleteEntriesError);
  }

  const { error: deleteProjectError } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId);
  if (deleteProjectError) {
    console.error('No se pudo borrar el proyecto:', deleteProjectError);
    throw deleteProjectError;
  }
}

/* ============================================================================
   CARGA Y AUTOBORRADO DE LO YA VENCIDO
   ============================================================================ */
function diasRestantes(deletedAt) {
  const eliminado = new Date(deletedAt).getTime();
  const limite = eliminado + DIAS_ANTES_DE_BORRAR * DIA_MS;
  const restante = Math.ceil((limite - Date.now()) / DIA_MS);
  return Math.max(0, restante);
}

function estaVencido(deletedAt) {
  const eliminado = new Date(deletedAt).getTime();
  return Date.now() - eliminado >= DIAS_ANTES_DE_BORRAR * DIA_MS;
}

async function fetchTrashedProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  if (error) {
    console.error('Error al cargar la papelera:', error);
    announce('No se pudo cargar la papelera. Intenta de nuevo.');
    return [];
  }

  return data || [];
}

/**
 * Recorre lo que ya lleva más de 15 días en la papelera y lo borra de
 * verdad, uno por uno. Devuelve la lista ya sin esos elementos.
 */
async function autoPurgeExpired(trashedProjects) {
  const vigentes = [];

  // eslint-disable-next-line no-restricted-syntax
  for (const proyecto of trashedProjects) {
    if (estaVencido(proyecto.deleted_at)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await purgeProjectCompletely(proyecto.id);
      } catch (error) {
        // Si falla el autoborrado de uno, se deja visible para
        // reintentar la próxima vez, en vez de ocultarlo sin borrarlo.
        vigentes.push(proyecto);
      }
    } else {
      vigentes.push(proyecto);
    }
  }

  return vigentes;
}

/* ============================================================================
   PRESENTACIÓN
   ============================================================================ */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function buildTrashItem(project) {
  const restantes = diasRestantes(project.deleted_at);
  const transcurridos = DIAS_ANTES_DE_BORRAR - restantes;
  const fechaEliminado = new Date(project.deleted_at)
    .toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });

  const li = el('li', 'trash-item');
  li.dataset.projectId = project.id;
  if (restantes <= 3) {
    li.classList.add('is-urgent');
  }

  // Encabezado: ícono, nombre y fecha de eliminación
  const head = el('div', 'trash-item-head');
  const badge = el('span', 'icon-badge');
  const icon = el('span', 'icon');
  icon.dataset.icon = 'proyectos';
  icon.setAttribute('aria-hidden', 'true');
  badge.appendChild(icon);

  const info = el('div', 'trash-item-info');
  info.appendChild(el('p', 'trash-item-title', project.name));
  info.appendChild(el('p', 'trash-item-meta', `Eliminado el ${fechaEliminado}`));

  head.appendChild(badge);
  head.appendChild(info);

  // Cuenta regresiva: transcurrido sólido, restante rayado
  const countdown = el('div', 'trash-item-countdown');
  const row = el('div', 'trash-item-countdown-row');
  const restanteTxt = el('strong');
  restanteTxt.textContent = restantes > 0
    ? `Se borra en ${restantes} día${restantes === 1 ? '' : 's'}`
    : 'Se borrará muy pronto';
  row.appendChild(restanteTxt);
  row.appendChild(el('span', '', `${transcurridos} de ${DIAS_ANTES_DE_BORRAR} días`));

  const bar = el('div', 'hatch-bar hatch-bar--sm');
  bar.style.setProperty('--value', String(Math.round((transcurridos / DIAS_ANTES_DE_BORRAR) * 100)));
  bar.setAttribute('aria-hidden', 'true');
  bar.appendChild(el('span'));

  countdown.appendChild(row);
  countdown.appendChild(bar);

  // Acciones
  const actions = el('div', 'trash-item-actions');
  const restoreBtn = el('button', 'btn btn-secondary trash-restore-btn', 'Restaurar');
  restoreBtn.type = 'button';
  const deleteBtn = el('button', 'btn btn-secondary settings-danger-btn trash-delete-btn', 'Eliminar definitivamente');
  deleteBtn.type = 'button';
  actions.appendChild(restoreBtn);
  actions.appendChild(deleteBtn);

  li.appendChild(head);
  li.appendChild(actions);
  li.appendChild(countdown);
  return li;
}

function updateEmptyState() {
  const list = document.getElementById('trash-list');
  const emptyState = document.getElementById('trash-empty-state');
  if (!list || !emptyState) {
    return;
  }

  const remaining = list.querySelectorAll('.trash-item:not(.is-leaving)').length;
  emptyState.hidden = remaining !== 0;
  list.hidden = remaining === 0;
}

function renderList(projects) {
  const list = document.getElementById('trash-list');
  if (!list) {
    return;
  }
  list.innerHTML = '';
  projects.forEach((project) => list.appendChild(buildTrashItem(project)));
  updateEmptyState();
}

/** Quita la tarjeta con una animación breve (o al instante si se prefiere sin movimiento). */
function removeItem(item) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    item.remove();
    updateEmptyState();
    return;
  }
  item.classList.add('is-leaving');
  item.addEventListener('animationend', () => {
    item.remove();
    updateEmptyState();
  }, { once: true });
}

/* ============================================================================
   ACCIONES: RESTAURAR Y ELIMINAR DEFINITIVAMENTE
   ============================================================================ */
async function restoreItem(item) {
  const projectId = item.dataset.projectId;
  const title = item.querySelector('.trash-item-title').textContent;
  const trigger = item.querySelector('.trash-restore-btn');

  trigger.disabled = true;
  trigger.textContent = 'Restaurando…';

  const { error } = await supabase
    .from('projects')
    .update({ deleted_at: null })
    .eq('id', projectId);

  if (error) {
    console.error('Error al restaurar el proyecto:', error);
    trigger.disabled = false;
    trigger.textContent = 'Restaurar';
    announce('No se pudo restaurar el proyecto. Intenta de nuevo.');
    return;
  }

  removeItem(item);
  announce(`"${title}" fue restaurado y está de nuevo en Proyectos.`);
}

async function requestDelete(item) {
  const projectId = item.dataset.projectId;
  const title = item.querySelector('.trash-item-title').textContent;
  const trigger = item.querySelector('.trash-delete-btn');

  const confirmed = await confirmDialog({
    titleText: 'Eliminar definitivamente',
    message: `"${title}" se eliminará para siempre, junto con todos sus registros de bitácora, fotografías y notas de voz. Esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar definitivamente',
    confirmClassName: 'btn btn-secondary settings-danger-btn',
    restoreFocusTo: trigger,
  });

  if (!confirmed) {
    return;
  }

  trigger.disabled = true;
  trigger.textContent = 'Eliminando…';

  try {
    await purgeProjectCompletely(projectId);
    removeItem(item);
    announce(`"${title}" fue eliminado para siempre.`);
  } catch (error) {
    trigger.disabled = false;
    trigger.textContent = 'Eliminar definitivamente';
    announce('No se pudo eliminar el proyecto. Intenta de nuevo.');
  }
}

/* ============================================================================
   INICIALIZACIÓN
   ============================================================================ */
async function init() {
  const list = document.getElementById('trash-list');
  const loadingNote = document.getElementById('papelera-loading-note');
  if (!list) {
    return;
  }

  list.addEventListener('click', (event) => {
    const restoreBtn = event.target.closest('.trash-restore-btn');
    if (restoreBtn) {
      const item = restoreBtn.closest('.trash-item');
      if (item) {
        restoreItem(item);
      }
      return;
    }

    const deleteBtn = event.target.closest('.trash-delete-btn');
    if (deleteBtn) {
      const item = deleteBtn.closest('.trash-item');
      if (item) {
        requestDelete(item);
      }
    }
  });

  const trashed = await fetchTrashedProjects();
  const vigentes = await autoPurgeExpired(trashed);

  if (loadingNote) {
    loadingNote.hidden = true;
  }

  renderList(vigentes);
}

document.addEventListener('DOMContentLoaded', init);