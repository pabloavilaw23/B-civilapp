/**
 * asistente.js
 * Conversación con la IA sobre los registros reales del proyecto
 * (función Edge "ai-bcivil", modo "asistente").
 *
 * Cambios de la versión de rediseño (la llamada a la IA no cambia):
 *  - CORRECCIÓN: el chat no bajaba solo a la respuesta nueva. Se
 *    desplazaba la lista de mensajes, pero el contenedor que tiene el
 *    desplazamiento es #assistant-conversation.
 *  - CORRECCIÓN (iPhone): el teclado tapaba la caja de escribir. La
 *    altura del chat (--app-vh) sigue ahora el espacio visible real
 *    (visualViewport).
 *  - En el teléfono, Enter hace salto de línea y se envía con el
 *    botón (como en las apps de mensajería). En computador, Enter
 *    envía y Shift+Enter hace salto de línea.
 *  - Las sugerencias se envían con un toque.
 *  - Cada respuesta tiene un botón "Copiar" (para pegarla en un
 *    informe o un mensaje).
 *  - "Pensando…" se muestra con tres puntos animados.
 *  - Sin proyecto activo se abre directamente el selector.
 *  - El botón enviar se desactiva mientras la caja está vacía.
 *
 * GENERACIÓN DE DOCUMENTOS: si pides un documento ("hazme la
 * incapacidad de Jaime Pérez"), el servidor identifica el tipo,
 * pregunta los datos obligatorios que falten y lo genera con el mismo
 * motor de Documentos. En el chat aparece una tarjeta con "Descargar
 * PDF" (con el membrete de la empresa) y "Abrir y editar".
 */

import { supabase } from '../config/supabase.js';
import { announce } from '../app-shell.js';
import { getCurrentProjectId, setCurrentProjectId } from '../utils/proyecto-actual.js';

/* ============================================================================
   ELEMENTOS DEL DOM
   ============================================================================ */
const projectNameEl = document.getElementById('assistant-project-name');
const switcherTrigger = document.getElementById('assistant-project-trigger');
const switcherWrapper = document.getElementById('assistant-project-switcher');
const conversationEl = document.getElementById('assistant-conversation');
const emptyStateEl = document.getElementById('assistant-empty-state');
const suggestionsEl = document.getElementById('assistant-suggestions');
const messagesEl = document.getElementById('assistant-messages');
const composerForm = document.getElementById('assistant-composer');
const inputEl = document.getElementById('assistant-input');
const sendBtn = document.getElementById('assistant-send');

const SUGERENCIAS = [
  '¿Qué se registró esta semana?',
  'Genera el informe semanal de interventoría',
  '¿Cuánto personal ha habido en promedio últimamente?',
  'Necesito un reporte de incapacidad',
];

// Teléfonos y tabletas: dedo como puntero principal
const isTouch = window.matchMedia('(pointer: coarse)').matches;

/* ============================================================================
   ESTADO EN MEMORIA
   ============================================================================ */
let currentProjectId = null;
let historial = []; // { role: 'user' | 'assistant', content: string }
let sending = false;

/* ============================================================================
   ALTURA VISIBLE (teclado del teléfono)
   ============================================================================ */
function initViewportHeight() {
  const vv = window.visualViewport;
  if (!vv) {
    return;
  }

  const update = () => {
    document.documentElement.style.setProperty('--app-vh', `${Math.round(vv.height)}px`);
    // iOS desplaza la página al abrir el teclado: se devuelve arriba
    // para que la cabecera no quede oculta.
    if (window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
    scrollToBottom(false);
  };

  vv.addEventListener('resize', update);
  update();
}

/* ============================================================================
   UTILIDADES DE INTERFAZ
   ============================================================================ */
function scrollToBottom(smooth = true) {
  if (!conversationEl) {
    return;
  }
  conversationEl.scrollTo({
    top: conversationEl.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto',
  });
}

function showEmptyState(show) {
  if (emptyStateEl) {
    emptyStateEl.hidden = !show;
  }
  if (messagesEl) {
    messagesEl.hidden = show;
  }
}

function updateSendState() {
  if (!sendBtn || !inputEl) {
    return;
  }
  sendBtn.disabled = sending || !inputEl.value.trim();
}

function formatHora(date) {
  return date.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
}

function renderSuggestions() {
  if (!suggestionsEl) {
    return;
  }
  suggestionsEl.innerHTML = '';
  SUGERENCIAS.forEach((texto) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'assistant-suggestion-chip';
    btn.textContent = texto;
    btn.addEventListener('click', () => {
      if (!currentProjectId) {
        openSwitcher();
        return;
      }
      enviarPregunta(texto);
    });
    li.appendChild(btn);
    suggestionsEl.appendChild(li);
  });
}

async function copiarTexto(texto, boton) {
  try {
    await navigator.clipboard.writeText(texto);
    boton.classList.add('is-done');
    boton.lastChild.textContent = 'Copiado';
    setTimeout(() => {
      boton.classList.remove('is-done');
      boton.lastChild.textContent = 'Copiar';
    }, 1800);
  } catch (error) {
    announce('No se pudo copiar. Mantén presionado el texto para copiarlo.');
  }
}

function appendMessage(role, content) {
  if (!messagesEl) {
    return null;
  }
  const li = document.createElement('li');
  li.className = `assistant-message assistant-message-${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'assistant-message-bubble';
  bubble.textContent = content;
  li.appendChild(bubble);

  const meta = document.createElement('div');
  meta.className = 'assistant-message-meta';

  const hora = document.createElement('span');
  hora.textContent = formatHora(new Date());
  meta.appendChild(hora);

  if (role === 'assistant') {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'assistant-copy-btn';
    copyBtn.setAttribute('aria-label', 'Copiar respuesta');
    copyBtn.appendChild(document.createTextNode('Copiar'));
    copyBtn.addEventListener('click', () => copiarTexto(content, copyBtn));
    meta.appendChild(copyBtn);
  }

  li.appendChild(meta);
  messagesEl.appendChild(li);
  scrollToBottom();
  return li;
}

/* ============================================================================
   TARJETA DE DOCUMENTO GENERADO
   ============================================================================ */
const PLACEHOLDER_RE = /\[[^\]\n]{1,140}\]/g;

function contarPendientes(doc) {
  const textos = [doc.titulo, ...Object.values(doc.metadatos || {})];
  (doc.secciones || []).forEach((s) => (s.bloques || []).forEach((b) => {
    if (b.texto) textos.push(b.texto);
    (b.items || []).forEach((i) => textos.push(i));
    (b.filas || []).forEach((f) => f.forEach((c) => textos.push(c)));
  }));
  (doc.firmas || []).forEach((f) => textos.push(f.nombre));
  return (textos.join(' ').match(PLACEHOLDER_RE) || []).length;
}

async function obtenerMembrete() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const m = user && user.user_metadata ? user.user_metadata.membrete : null;
    return m && (m.empresa || m.logo_url) ? m : null;
  } catch (e) {
    return null;
  }
}

function enlaceDocumento(doc) {
  if (doc.id) {
    return `../documentos/documentos.html?doc=${encodeURIComponent(doc.id)}`;
  }
  // Si no se pudo guardar en la base de datos, se pasa por esta pestaña
  try {
    sessionStorage.setItem('bcivil-doc-local', JSON.stringify({ documento: doc, projectId: currentProjectId }));
  } catch (e) { /* sin almacenamiento disponible */ }
  return '../documentos/documentos.html?doc=local';
}

function appendDocumentCard(doc) {
  if (!messagesEl) return;
  const li = document.createElement('li');
  li.className = 'assistant-message assistant-message-assistant assistant-message-doc';

  const card = document.createElement('div');
  card.className = 'assistant-doc-card';

  const head = document.createElement('div');
  head.className = 'assistant-doc-head';
  head.innerHTML = `
    <span class="assistant-doc-icon" aria-hidden="true"><span class="icon" data-icon="documentos"></span></span>
    <span class="assistant-doc-info">
      <span class="assistant-doc-code"></span>
      <span class="assistant-doc-title"></span>
    </span>`;
  head.querySelector('.assistant-doc-code').textContent = doc.codigo || 'Documento';
  head.querySelector('.assistant-doc-title').textContent = doc.titulo;
  card.appendChild(head);

  const pendientes = contarPendientes(doc);
  const estado = document.createElement('p');
  estado.className = `assistant-doc-estado${pendientes ? '' : ' is-listo'}`;
  estado.textContent = pendientes
    ? `${pendientes} dato${pendientes === 1 ? '' : 's'} pendiente${pendientes === 1 ? '' : 's'} por completar`
    : 'Sin datos pendientes';
  card.appendChild(estado);

  const acciones = document.createElement('div');
  acciones.className = 'assistant-doc-actions';

  const pdfBtn = document.createElement('button');
  pdfBtn.type = 'button';
  pdfBtn.className = 'assistant-doc-btn';
  pdfBtn.textContent = 'Descargar PDF';
  pdfBtn.addEventListener('click', async () => {
    pdfBtn.disabled = true;
    pdfBtn.textContent = 'Preparando…';
    try {
      const { exportarDocumentoPDF } = await import('../documentos/exportacion.js');
      await exportarDocumentoPDF(doc, await obtenerMembrete());
      announce(pendientes ? 'PDF descargado. Recuerda completar los datos pendientes.' : 'PDF descargado.');
    } catch (error) {
      console.error('Error al exportar el PDF desde el chat:', error);
      announce('No se pudo generar el PDF. Ábrelo en Documentos e inténtalo desde allí.');
    } finally {
      pdfBtn.disabled = false;
      pdfBtn.textContent = 'Descargar PDF';
    }
  });

  const abrir = document.createElement('a');
  abrir.className = 'assistant-doc-btn assistant-doc-btn--primary';
  abrir.href = enlaceDocumento(doc);
  abrir.textContent = pendientes ? 'Completar y editar' : 'Abrir y editar';

  acciones.appendChild(pdfBtn);
  acciones.appendChild(abrir);
  card.appendChild(acciones);

  li.appendChild(card);
  messagesEl.appendChild(li);
  scrollToBottom();
}

function appendPendingMessage() {
  if (!messagesEl) {
    return null;
  }
  const li = document.createElement('li');
  li.className = 'assistant-message assistant-message-assistant is-pending';

  const bubble = document.createElement('div');
  bubble.className = 'assistant-message-bubble';

  const typing = document.createElement('span');
  typing.className = 'assistant-typing';
  typing.setAttribute('aria-hidden', 'true');
  typing.innerHTML = '<span></span><span></span><span></span>';

  const srText = document.createElement('span');
  srText.className = 'visually-hidden';
  srText.textContent = 'El asistente está pensando…';

  bubble.appendChild(typing);
  bubble.appendChild(srText);
  li.appendChild(bubble);
  messagesEl.appendChild(li);
  scrollToBottom();
  return li;
}

/* ============================================================================
   CARGA DEL PROYECTO ACTUAL
   ============================================================================ */
async function loadProjectName(projectId) {
  if (!projectNameEl) {
    return;
  }
  const { data, error } = await supabase
    .from('projects')
    .select('name')
    .eq('id', projectId)
    .single();

  projectNameEl.textContent = (!error && data) ? data.name : 'Proyecto no encontrado';
  if (!error && data) {
    document.title = `Asistente — ${data.name} — B-Civil`;
  }
}

async function loadProjectOptions() {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name')
    .is('deleted_at', null)
    .order('name', { ascending: true });

  return (!error && data) ? data : [];
}

function closeSwitcher() {
  if (!switcherWrapper) {
    return;
  }
  const menu = switcherWrapper.querySelector('.context-menu-list');
  if (menu) {
    menu.remove();
  }
  if (switcherTrigger) {
    switcherTrigger.setAttribute('aria-expanded', 'false');
  }
}

async function openSwitcher() {
  if (!switcherWrapper || !switcherTrigger) {
    return;
  }

  const existing = switcherWrapper.querySelector('.context-menu-list');
  if (existing) {
    closeSwitcher();
    return;
  }

  const proyectos = await loadProjectOptions();

  const menu = document.createElement('ul');
  menu.className = 'context-menu-list';
  menu.setAttribute('role', 'list');

  if (!proyectos.length) {
    const li = document.createElement('li');
    li.className = 'context-menu-empty';
    li.textContent = 'No tienes proyectos todavía.';
    menu.appendChild(li);
  }

  proyectos.forEach((proyecto) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'context-menu-item';
    if (String(proyecto.id) === String(currentProjectId)) {
      btn.classList.add('is-active');
      btn.setAttribute('aria-current', 'true');
    }
    btn.textContent = proyecto.name;
    btn.addEventListener('click', () => {
      closeSwitcher();
      if (String(proyecto.id) !== String(currentProjectId)) {
        cambiarProyecto(proyecto.id);
      }
    });
    li.appendChild(btn);
    menu.appendChild(li);
  });

  switcherWrapper.appendChild(menu);
  switcherTrigger.setAttribute('aria-expanded', 'true');

  const first = menu.querySelector('.context-menu-item');
  if (first) {
    first.focus();
  }
}

function cambiarProyecto(projectId) {
  currentProjectId = projectId;
  setCurrentProjectId(projectId);
  historial = [];
  showEmptyState(true);
  if (messagesEl) {
    messagesEl.innerHTML = '';
  }
  loadProjectName(projectId);
  announce('Cambiaste de proyecto. La conversación empieza de nuevo.');
}

/* ============================================================================
   ENVÍO DE PREGUNTAS
   ============================================================================ */
async function enviarPregunta(pregunta) {
  if (!currentProjectId) {
    announce('Elige un proyecto para consultar al asistente.');
    openSwitcher();
    return;
  }
  if (sending) {
    return;
  }
  sending = true;
  updateSendState();

  showEmptyState(false);
  appendMessage('user', pregunta);
  const pendingEl = appendPendingMessage();

  try {
    const { data, error } = await supabase.functions.invoke('ai-bcivil', {
      body: {
        mode: 'asistente',
        projectId: currentProjectId,
        pregunta,
        historial,
      },
    });

    if (pendingEl) {
      pendingEl.remove();
    }

    if (error || !data || data.error) {
      console.error('Error del asistente:', error || data?.error);
      appendMessage('assistant', 'No pude procesar tu pregunta en este momento. Intenta de nuevo en unos segundos.');
      return;
    }

    appendMessage('assistant', data.respuesta);
    if (data.documento) {
      appendDocumentCard(data.documento);
    }
    historial.push({ role: 'user', content: pregunta });
    historial.push({ role: 'assistant', content: data.respuesta });
  } catch (err) {
    console.error('Error inesperado al consultar al asistente:', err);
    if (pendingEl) {
      pendingEl.remove();
    }
    appendMessage('assistant', 'Ocurrió un error de conexión. Verifica tu señal e intenta de nuevo.');
  } finally {
    sending = false;
    updateSendState();
  }
}

function resizeInput() {
  if (!inputEl) {
    return;
  }
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 144)}px`;
}

/* ============================================================================
   INICIALIZACIÓN
   ============================================================================ */
async function init() {
  initViewportHeight();
  renderSuggestions();
  showEmptyState(true);
  updateSendState();

  if (inputEl && isTouch) {
    // En el teléfono Enter hace salto de línea: el teclado muestra "↵"
    inputEl.setAttribute('enterkeyhint', 'enter');
  }

  if (switcherTrigger) {
    switcherTrigger.addEventListener('click', (event) => {
      event.stopPropagation();
      openSwitcher();
    });
  }

  document.addEventListener('click', (event) => {
    if (switcherWrapper && !switcherWrapper.contains(event.target)) {
      closeSwitcher();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && switcherTrigger && switcherTrigger.getAttribute('aria-expanded') === 'true') {
      closeSwitcher();
      switcherTrigger.focus();
    }
  });

  if (composerForm) {
    composerForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const pregunta = inputEl.value.trim();
      if (!pregunta) {
        return;
      }
      inputEl.value = '';
      resizeInput();
      updateSendState();
      enviarPregunta(pregunta);
    });
  }

  if (inputEl) {
    inputEl.addEventListener('input', () => {
      resizeInput();
      updateSendState();
    });

    inputEl.addEventListener('keydown', (event) => {
      // Computador: Enter envía, Shift+Enter salto de línea.
      // Teléfono: Enter siempre es salto de línea; se envía con el botón.
      if (event.key === 'Enter' && !event.shiftKey && !isTouch) {
        event.preventDefault();
        composerForm.requestSubmit();
      }
    });
  }

  currentProjectId = getCurrentProjectId();

  if (!currentProjectId) {
    if (projectNameEl) {
      projectNameEl.textContent = 'Selecciona un proyecto';
    }
    openSwitcher();
  } else {
    await loadProjectName(currentProjectId);
  }
}

init();