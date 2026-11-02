/**
 * proyecto.js
 * Carga el proyecto real desde Supabase según el parámetro "id" de la
 * URL (?id=...) y lo muestra en el espacio de trabajo. También aloja
 * el menú de acciones propias del proyecto (Editar, Archivar,
 * Eliminar), ya que necesitan el proyecto actualmente cargado.
 *
 * MÓDULO 1 — DATOS DEL CONTRATO: además del proyecto, carga y edita
 * la fila de "project_contracts" asociada (si existe). Es información
 * administrativa/legal fija que alimenta las secciones administrativas
 * del informe de interventoría generado por IA.
 *
 * Cambios de la versión de rediseño:
 *  - PLAZO DEL CONTRATO: con la fecha de inicio y el vencimiento
 *    vigente (o el inicial) del contrato de obra se calcula qué parte
 *    del plazo ha transcurrido y cuántos días faltan. Solo se muestra
 *    si esas fechas están registradas.
 *  - El menú "Más acciones" se abre desde el botón "···" de la
 *    cabecera (#proyecto-acciones-trigger). Si no existe, se crea como
 *    antes junto al encabezado.
 *  - La actividad reciente usa las filas con ícono del nuevo diseño.
 *  - Los enlaces a la bitácora de la barra de navegación y de
 *    "Actividad reciente" apuntan al proyecto cargado.
 */

import { supabase } from '../config/supabase.js';
import { announce } from '../app-shell.js';
import { confirmDialog } from '../utils/alertas.js';
import { setFieldError, clearFieldError } from '../utils/validaciones.js';
import { formatDisplayDate, formatDisplayTime } from '../utils/fechas.js';
import { setCurrentProjectId } from '../utils/proyecto-actual.js';
import { initDocumentosProyecto } from './documentos-proyecto.js';
import { initPersonal } from './personal.js';

const STATUS_LABELS = {
  activo: 'Activo',
  pausado: 'Pausado',
  finalizado: 'Finalizado',
};

const TYPE_INFO = {
  texto: { label: 'Novedad', icon: 'novedad' },
  fotografia: { label: 'Fotografía', icon: 'fotografia' },
  'nota-voz': { label: 'Nota de voz', icon: 'voz' },
  ensayo: { label: 'Ensayo', icon: 'ensayo' },
  sst: { label: 'Evento SST', icon: 'seguridad' },
  avance: { label: 'Avance', icon: 'avance' },
};

const DAY_MS = 24 * 60 * 60 * 1000;

let currentProject = null;
let currentContract = null;

/* ============================================================================
   UTILIDADES
   ============================================================================ */
function iconSpan(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.dataset.icon = name;
  span.setAttribute('aria-hidden', 'true');
  return span;
}

function setHref(id, href) {
  const el = document.getElementById(id);
  if (el) {
    el.href = href;
  }
}

/* ============================================================================
   CARGA Y PRESENTACIÓN DEL PROYECTO
   ============================================================================ */
function getProjectIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function showNotFound() {
  const contenido = document.getElementById('proyecto-contenido');
  const notFound = document.getElementById('proyecto-no-encontrado');

  if (contenido) {
    contenido.hidden = true;
  }
  if (notFound) {
    notFound.hidden = false;
  }

  const acciones = document.getElementById('proyecto-acciones');
  if (acciones) {
    acciones.hidden = true;
  }
}

function applyStatusBadge(status) {
  const badge = document.getElementById('proyecto-estado-badge');
  if (!badge) {
    return;
  }

  const normalized = status && STATUS_LABELS[status] ? status : 'activo';
  badge.className = `status-badge status-badge-${normalized}`;
  badge.textContent = STATUS_LABELS[normalized];
}

function renderProject(project) {
  document.title = `${project.name} — B-Civil`;

  const nombreEl = document.getElementById('proyecto-nombre');
  if (nombreEl) {
    nombreEl.textContent = project.name;
  }

  applyStatusBadge(project.status);

  const ubicacion = project.location && project.location.trim()
    ? project.location.trim()
    : 'Sin ubicación registrada';

  const ubicacionMeta = document.getElementById('proyecto-ubicacion-meta');
  if (ubicacionMeta) {
    ubicacionMeta.textContent = ubicacion;
  }

  const infoUbicacion = document.getElementById('info-ubicacion');
  if (infoUbicacion) {
    infoUbicacion.textContent = ubicacion;
  }

  const infoEstado = document.getElementById('info-estado');
  if (infoEstado) {
    infoEstado.textContent = STATUS_LABELS[project.status] || STATUS_LABELS.activo;
  }

  const infoFecha = document.getElementById('info-fecha-inicio');
  if (infoFecha) {
    infoFecha.textContent = project.start_date
      ? formatDisplayDate(new Date(`${project.start_date}T00:00:00`))
      : 'Sin fecha registrada';
  }

  const infoDescripcion = document.getElementById('info-descripcion');
  if (infoDescripcion) {
    infoDescripcion.textContent = project.description && project.description.trim()
      ? project.description.trim()
      : 'Sin descripción';
  }

  // El botón de registro rápido lee el proyecto activo desde aquí.
  setCurrentProjectId(project.id);

  const bitacoraHref = `../bitacora/bitacora.html?project_id=${project.id}`;
  setHref('link-bitacora-proyecto', bitacoraHref);
  setHref('link-ver-bitacora-actividad', bitacoraHref);
  setHref('dock-bitacora-proyecto', bitacoraHref);
  setHref('link-documentos-proyecto', `../documentos/documentos.html?project_id=${project.id}`);
  setHref('link-asistente-proyecto', `../chat/asistente.html?project_id=${project.id}`);
}

async function fetchRecentEntries(projectId) {
  const { data, error } = await supabase
    .from('bitacora_entries')
    .select('*')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(4);

  if (error) {
    console.error('Error al cargar la actividad reciente:', error);
    return [];
  }

  return data || [];
}

function renderActivity(entries) {
  const list = document.getElementById('activity-list');
  const emptyMessage = document.getElementById('activity-empty-message');
  if (!list || !currentProject) {
    return;
  }

  list.innerHTML = '';

  if (!entries.length) {
    list.hidden = true;
    if (emptyMessage) {
      emptyMessage.hidden = false;
    }
    return;
  }

  list.hidden = false;
  if (emptyMessage) {
    emptyMessage.hidden = true;
  }

  const bitacoraHref = `../bitacora/bitacora.html?project_id=${currentProject.id}`;

  entries.forEach((entry) => {
    const info = TYPE_INFO[entry.type] || { label: entry.type, icon: 'bitacora' };
    const createdAt = new Date(entry.created_at);

    const li = document.createElement('li');
    li.className = 'activity-item';

    const link = document.createElement('a');
    link.className = 'list-row';
    link.href = bitacoraHref;

    const badge = document.createElement('span');
    badge.className = 'icon-badge';
    badge.style.backgroundColor = 'var(--color-surface)';
    badge.appendChild(iconSpan(info.icon));

    const body = document.createElement('span');
    body.className = 'list-row-body';

    const title = document.createElement('span');
    title.className = 'list-row-title activity-text';
    title.textContent = (entry.content || '').trim() || info.label;

    const meta = document.createElement('span');
    meta.className = 'list-row-meta activity-time';
    meta.textContent = `${info.label} · ${formatDisplayDate(createdAt)}, ${formatDisplayTime(createdAt)}`;

    body.appendChild(title);
    body.appendChild(meta);

    link.appendChild(badge);
    link.appendChild(body);
    li.appendChild(link);
    list.appendChild(li);
  });
}

async function loadProject() {
  const projectId = getProjectIdFromUrl();

  if (!projectId) {
    console.warn('proyecto.html se abrió sin "?id=" en la URL.');
    showNotFound();
    return;
  }

  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .is('deleted_at', null)
      .single();

    if (error || !data) {
      console.error('No se pudo cargar el proyecto. project_id:', projectId, 'Error de Supabase:', error);
      showNotFound();
      return;
    }

    currentProject = data;
    renderProject(currentProject);

    const [entries] = await Promise.all([
      fetchRecentEntries(currentProject.id),
      loadContract(currentProject.id),
    ]);
    renderActivity(entries);
  } catch (error) {
    console.error('Error inesperado al cargar el proyecto:', error);
    announce('Ocurrió un error inesperado. Intenta nuevamente.');
    showNotFound();
  }
}

/* ============================================================================
   MÓDULO 1 — DATOS DEL CONTRATO: CARGA Y PRESENTACIÓN
   ============================================================================ */
function formatCurrency(value) {
  if (value === null || value === undefined || value === '') {
    return 'Sin registrar';
  }
  const numero = Number(value);
  if (Number.isNaN(numero)) {
    return 'Sin registrar';
  }
  return numero.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
}

function formatContractDate(value) {
  if (!value) {
    return 'Sin registrar';
  }
  return formatDisplayDate(new Date(`${value}T00:00:00`));
}

function setContractField(id, value) {
  const el = document.getElementById(id);
  if (!el) {
    return;
  }
  const texto = value && String(value).trim() ? String(value).trim() : 'Sin registrar';
  el.textContent = texto;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
  }
}

/**
 * Plazo del contrato de obra: porcentaje transcurrido entre la fecha
 * de inicio y el vencimiento vigente (o el inicial, si no hay
 * prórroga registrada), y días que faltan. Solo con fechas reales.
 */
function renderTerm(contract) {
  const block = document.getElementById('proyecto-plazo');
  if (!block) {
    return;
  }

  const c = contract || {};
  const inicioRaw = c.obra_fecha_inicio;
  const finRaw = c.obra_fecha_vencimiento_vigente || c.obra_fecha_vencimiento_inicial;

  if (!inicioRaw || !finRaw) {
    block.hidden = true;
    return;
  }

  const inicio = new Date(`${inicioRaw}T00:00:00`);
  const fin = new Date(`${finRaw}T00:00:00`);
  const total = fin - inicio;

  if (!(total > 0)) {
    block.hidden = true;
    return;
  }

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const transcurrido = Math.min(Math.max(hoy - inicio, 0), total);
  const porcentaje = Math.round((transcurrido / total) * 100);
  const diasRestantes = Math.round((fin - hoy) / DAY_MS);

  const porcentajeEl = document.getElementById('proyecto-plazo-porcentaje');
  if (porcentajeEl) {
    porcentajeEl.innerHTML = '';
    porcentajeEl.appendChild(document.createTextNode(String(porcentaje)));
    const unidad = document.createElement('small');
    unidad.textContent = '%';
    porcentajeEl.appendChild(unidad);
  }

  const barra = document.getElementById('proyecto-plazo-barra');
  if (barra) {
    barra.style.setProperty('--value', String(porcentaje));
    barra.setAttribute('role', 'img');
    barra.setAttribute('aria-label', `${porcentaje} % del plazo transcurrido`);
  }

  const estado = document.getElementById('proyecto-plazo-estado');
  if (estado) {
    if (hoy < inicio) {
      const diasParaIniciar = Math.round((inicio - hoy) / DAY_MS);
      estado.className = 'status-pill';
      estado.textContent = diasParaIniciar === 1 ? 'Inicia mañana' : `Inicia en ${diasParaIniciar} días`;
    } else if (diasRestantes < 0) {
      const diasVencido = Math.abs(diasRestantes);
      estado.className = 'status-pill status-pill--late';
      estado.textContent = diasVencido === 1 ? 'Vencido hace 1 día' : `Vencido hace ${diasVencido} días`;
    } else if (diasRestantes === 0) {
      estado.className = 'status-pill status-pill--late';
      estado.textContent = 'Vence hoy';
    } else {
      estado.className = 'status-pill status-pill--progress';
      estado.textContent = diasRestantes === 1 ? 'Falta 1 día' : `Faltan ${diasRestantes} días`;
    }
  }

  setText('proyecto-plazo-inicio', `Inicio: ${formatDisplayDate(inicio)}`);
  setText(
    'proyecto-plazo-fin',
    `${c.obra_fecha_vencimiento_vigente ? 'Vence' : 'Vence (inicial)'}: ${formatDisplayDate(fin)}`,
  );

  block.hidden = false;
}

function renderContract(contract) {
  const c = contract || {};

  setContractField('contrato-entidad', c.entidad_contratante);
  setContractField('contrato-supervisor', c.supervisor_nombre);
  setContractField(
    'contrato-director',
    c.director_interventoria_nombre
      ? `${c.director_interventoria_nombre}${c.director_interventoria_matricula ? ` (M.P. ${c.director_interventoria_matricula})` : ''}`
      : '',
  );
  setContractField('contrato-alcance', c.alcance_fisico);

  setContractField('contrato-obra-numero', c.obra_numero);
  setContractField('contrato-obra-contratista', c.obra_contratista_nombre);
  setContractField('contrato-obra-nit', c.obra_contratista_nit);
  setContractField('contrato-obra-objeto', c.obra_objeto);
  setText('contrato-obra-valor', formatCurrency(c.obra_valor_inicial));
  setText('contrato-obra-fecha-inicio', formatContractDate(c.obra_fecha_inicio));
  setText('contrato-obra-venc-inicial', formatContractDate(c.obra_fecha_vencimiento_inicial));
  setText('contrato-obra-venc-vigente', formatContractDate(c.obra_fecha_vencimiento_vigente));

  setContractField('contrato-interv-numero', c.interv_numero);
  setContractField('contrato-interv-nombre', c.interv_contratista_nombre);
  setContractField('contrato-interv-nit', c.interv_contratista_nit);
  setContractField('contrato-interv-objeto', c.interv_objeto);
  setText('contrato-interv-fecha-inicio', formatContractDate(c.interv_fecha_inicio));
  setText('contrato-interv-venc', formatContractDate(c.interv_fecha_vencimiento));

  renderTerm(contract);
}

async function loadContract(projectId) {
  try {
    const { data, error } = await supabase
      .from('project_contracts')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    if (error) {
      console.error('Error al cargar los datos del contrato:', error);
      renderContract(null);
      return;
    }

    currentContract = data || null;
    renderContract(currentContract);
  } catch (error) {
    console.error('Error inesperado al cargar los datos del contrato:', error);
    renderContract(null);
  }
}

/* ============================================================================
   MÓDULO 1 — DATOS DEL CONTRATO: MODAL DE EDICIÓN (UPSERT)
   ============================================================================ */
let contractEditOverlay = null;
let contractEditTrigger = null;

function closeContractEditModal() {
  if (!contractEditOverlay) {
    return;
  }
  contractEditOverlay.remove();
  contractEditOverlay = null;
  document.removeEventListener('keydown', handleContractEditKeydown);

  if (contractEditTrigger) {
    contractEditTrigger.focus();
  }
}

function handleContractEditKeydown(event) {
  if (event.key === 'Escape') {
    closeContractEditModal();
  }
}

function buildContractField({
  id, label, type = 'text', value = '',
}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';

  const labelEl = document.createElement('label');
  labelEl.setAttribute('for', id);
  labelEl.textContent = label;

  const input = document.createElement('input');
  input.type = type;
  input.id = id;
  input.name = id;
  input.value = value === null || value === undefined ? '' : value;
  if (type === 'number') {
    input.inputMode = 'numeric';
  }

  wrapper.appendChild(labelEl);
  wrapper.appendChild(input);

  return { wrapper, input };
}

function buildTextareaField({ id, label, value = '' }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';
  const labelEl = document.createElement('label');
  labelEl.setAttribute('for', id);
  labelEl.textContent = label;
  const input = document.createElement('textarea');
  input.id = id;
  input.name = id;
  input.value = value || '';
  wrapper.appendChild(labelEl);
  wrapper.appendChild(input);
  return { wrapper, input };
}

function buildFormSectionTitle(text) {
  const title = document.createElement('h3');
  title.className = 'modal-section-title';
  title.textContent = text;
  return title;
}

function buildContractForm(contract) {
  const c = contract || {};
  const form = document.createElement('form');
  form.noValidate = true;
  const inputs = {};

  // --- Datos generales ---
  form.appendChild(buildFormSectionTitle('Información general'));

  [
    { key: 'entidad_contratante', label: 'Entidad contratante' },
    { key: 'supervisor_nombre', label: 'Supervisor del contrato' },
    { key: 'director_interventoria_nombre', label: 'Director de interventoría (nombre)' },
    { key: 'director_interventoria_matricula', label: 'Matrícula profesional del director' },
  ].forEach(({ key, label }) => {
    const { wrapper, input } = buildContractField({ id: `contrato-form-${key}`, label, value: c[key] });
    inputs[key] = input;
    form.appendChild(wrapper);
  });

  const alcance = buildTextareaField({
    id: 'contrato-form-alcance_fisico', label: 'Alcance físico contractual', value: c.alcance_fisico,
  });
  form.appendChild(alcance.wrapper);
  inputs.alcance_fisico = alcance.input;

  // --- Contrato de obra ---
  form.appendChild(buildFormSectionTitle('Contrato de obra'));

  [
    { key: 'obra_numero', label: 'Número de contrato' },
    { key: 'obra_contratista_nombre', label: 'Contratista' },
    { key: 'obra_contratista_nit', label: 'NIT del contratista' },
  ].forEach(({ key, label }) => {
    const { wrapper, input } = buildContractField({ id: `contrato-form-${key}`, label, value: c[key] });
    inputs[key] = input;
    form.appendChild(wrapper);
  });

  const obraObjeto = buildTextareaField({
    id: 'contrato-form-obra_objeto', label: 'Objeto del contrato de obra', value: c.obra_objeto,
  });
  form.appendChild(obraObjeto.wrapper);
  inputs.obra_objeto = obraObjeto.input;

  const obraRow1 = document.createElement('div');
  obraRow1.className = 'form-row';
  const { wrapper: obraValorWrapper, input: obraValorInput } = buildContractField({
    id: 'contrato-form-obra_valor_inicial', label: 'Valor inicial (COP)', type: 'number', value: c.obra_valor_inicial,
  });
  const { wrapper: obraFechaWrapper, input: obraFechaInput } = buildContractField({
    id: 'contrato-form-obra_fecha_inicio', label: 'Fecha de inicio', type: 'date', value: c.obra_fecha_inicio,
  });
  obraRow1.appendChild(obraValorWrapper);
  obraRow1.appendChild(obraFechaWrapper);
  form.appendChild(obraRow1);
  inputs.obra_valor_inicial = obraValorInput;
  inputs.obra_fecha_inicio = obraFechaInput;

  const obraRow2 = document.createElement('div');
  obraRow2.className = 'form-row';
  const { wrapper: obraVencInicialWrapper, input: obraVencInicialInput } = buildContractField({
    id: 'contrato-form-obra_fecha_vencimiento_inicial', label: 'Vencimiento inicial', type: 'date', value: c.obra_fecha_vencimiento_inicial,
  });
  const { wrapper: obraVencVigenteWrapper, input: obraVencVigenteInput } = buildContractField({
    id: 'contrato-form-obra_fecha_vencimiento_vigente', label: 'Vencimiento vigente', type: 'date', value: c.obra_fecha_vencimiento_vigente,
  });
  obraRow2.appendChild(obraVencInicialWrapper);
  obraRow2.appendChild(obraVencVigenteWrapper);
  form.appendChild(obraRow2);
  inputs.obra_fecha_vencimiento_inicial = obraVencInicialInput;
  inputs.obra_fecha_vencimiento_vigente = obraVencVigenteInput;

  // --- Contrato de interventoría ---
  form.appendChild(buildFormSectionTitle('Contrato de interventoría'));

  [
    { key: 'interv_numero', label: 'Número de contrato' },
    { key: 'interv_contratista_nombre', label: 'Interventor' },
    { key: 'interv_contratista_nit', label: 'NIT del interventor' },
  ].forEach(({ key, label }) => {
    const { wrapper, input } = buildContractField({ id: `contrato-form-${key}`, label, value: c[key] });
    inputs[key] = input;
    form.appendChild(wrapper);
  });

  const intervObjeto = buildTextareaField({
    id: 'contrato-form-interv_objeto', label: 'Objeto del contrato de interventoría', value: c.interv_objeto,
  });
  form.appendChild(intervObjeto.wrapper);
  inputs.interv_objeto = intervObjeto.input;

  const intervRow = document.createElement('div');
  intervRow.className = 'form-row';
  const { wrapper: intervFechaWrapper, input: intervFechaInput } = buildContractField({
    id: 'contrato-form-interv_fecha_inicio', label: 'Fecha de inicio', type: 'date', value: c.interv_fecha_inicio,
  });
  const { wrapper: intervVencWrapper, input: intervVencInput } = buildContractField({
    id: 'contrato-form-interv_fecha_vencimiento', label: 'Fecha de vencimiento', type: 'date', value: c.interv_fecha_vencimiento,
  });
  intervRow.appendChild(intervFechaWrapper);
  intervRow.appendChild(intervVencWrapper);
  form.appendChild(intervRow);
  inputs.interv_fecha_inicio = intervFechaInput;
  inputs.interv_fecha_vencimiento = intervVencInput;

  // --- Acciones ---
  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'btn btn-primary';
  submitBtn.textContent = 'Guardar datos del contrato';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.addEventListener('click', closeContractEditModal);

  actions.appendChild(submitBtn);
  actions.appendChild(cancelBtn);
  form.appendChild(actions);

  return { form, inputs, submitBtn };
}

async function handleContractEditSubmit(event, fields) {
  event.preventDefault();
  const { inputs, submitBtn } = fields;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Guardando...';

  const toNullable = (value) => (value && String(value).trim() ? String(value).trim() : null);
  const toNumberOrNull = (value) => (value === '' || value === null || value === undefined ? null : Number(value));

  const payload = {
    project_id: currentProject.id,
    entidad_contratante: toNullable(inputs.entidad_contratante.value),
    supervisor_nombre: toNullable(inputs.supervisor_nombre.value),
    director_interventoria_nombre: toNullable(inputs.director_interventoria_nombre.value),
    director_interventoria_matricula: toNullable(inputs.director_interventoria_matricula.value),
    alcance_fisico: toNullable(inputs.alcance_fisico.value),

    obra_numero: toNullable(inputs.obra_numero.value),
    obra_contratista_nombre: toNullable(inputs.obra_contratista_nombre.value),
    obra_contratista_nit: toNullable(inputs.obra_contratista_nit.value),
    obra_objeto: toNullable(inputs.obra_objeto.value),
    obra_valor_inicial: toNumberOrNull(inputs.obra_valor_inicial.value),
    obra_fecha_inicio: inputs.obra_fecha_inicio.value || null,
    obra_fecha_vencimiento_inicial: inputs.obra_fecha_vencimiento_inicial.value || null,
    obra_fecha_vencimiento_vigente: inputs.obra_fecha_vencimiento_vigente.value || null,

    interv_numero: toNullable(inputs.interv_numero.value),
    interv_contratista_nombre: toNullable(inputs.interv_contratista_nombre.value),
    interv_contratista_nit: toNullable(inputs.interv_contratista_nit.value),
    interv_objeto: toNullable(inputs.interv_objeto.value),
    interv_fecha_inicio: inputs.interv_fecha_inicio.value || null,
    interv_fecha_vencimiento: inputs.interv_fecha_vencimiento.value || null,
  };

  try {
    // upsert por project_id: crea la fila si no existe o la actualiza
    // si ya existe — para la persona siempre es "guardar".
    const { data, error } = await supabase
      .from('project_contracts')
      .upsert(payload, { onConflict: 'project_id' })
      .select()
      .single();

    submitBtn.disabled = false;
    submitBtn.textContent = 'Guardar datos del contrato';

    if (error || !data) {
      console.error('Error al guardar los datos del contrato:', error);
      announce('No se pudieron guardar los datos del contrato. Intenta de nuevo.');
      return;
    }

    currentContract = data;
    renderContract(currentContract);
    closeContractEditModal();
    announce('Datos del contrato guardados.');
  } catch (error) {
    console.error('Error inesperado al guardar los datos del contrato:', error);
    announce('Ocurrió un error inesperado. Intenta nuevamente.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Guardar datos del contrato';
  }
}

function openContractEditModal(trigger) {
  if (contractEditOverlay || !currentProject) {
    return;
  }

  contractEditTrigger = trigger;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'editar-contrato-titulo');

  const closeCorner = document.createElement('button');
  closeCorner.type = 'button';
  closeCorner.className = 'modal-close';
  closeCorner.setAttribute('aria-label', 'Cerrar');
  closeCorner.textContent = 'Cerrar';
  closeCorner.addEventListener('click', closeContractEditModal);

  const title = document.createElement('h2');
  title.id = 'editar-contrato-titulo';
  title.className = 'modal-title';
  title.textContent = 'Datos del contrato';

  const subtitle = document.createElement('p');
  subtitle.className = 'modal-subtitle';
  subtitle.textContent = 'Es opcional, pero mejora los informes de interventoría y activa el seguimiento del plazo.';

  const fields = buildContractForm(currentContract);
  fields.form.addEventListener('submit', (event) => handleContractEditSubmit(event, fields));

  dialog.appendChild(closeCorner);
  dialog.appendChild(title);
  dialog.appendChild(subtitle);
  dialog.appendChild(fields.form);
  overlay.appendChild(dialog);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeContractEditModal();
    }
  });

  document.body.appendChild(overlay);
  document.addEventListener('keydown', handleContractEditKeydown);
  contractEditOverlay = overlay;

  const firstInput = fields.form.querySelector('input, textarea');
  if (firstInput) {
    firstInput.focus();
  }
}

function initContractEdit() {
  const btn = document.getElementById('btn-editar-contrato');
  if (!btn) {
    return;
  }
  btn.addEventListener('click', () => openContractEditModal(btn));
}

/* ============================================================================
   EDITAR PROYECTO (UPDATE REAL)
   ============================================================================ */
let editOverlay = null;
let editTrigger = null;

function closeEditModal() {
  if (!editOverlay) {
    return;
  }
  editOverlay.remove();
  editOverlay = null;
  document.removeEventListener('keydown', handleEditKeydown);

  if (editTrigger) {
    editTrigger.focus();
  }
}

function handleEditKeydown(event) {
  if (event.key === 'Escape') {
    closeEditModal();
  }
}

function buildLabeledField({
  id, label, type = 'text', value = '',
}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';

  const labelEl = document.createElement('label');
  labelEl.setAttribute('for', id);
  labelEl.textContent = label;

  const input = document.createElement('input');
  input.type = type;
  input.id = id;
  input.name = id;
  input.value = value;

  wrapper.appendChild(labelEl);
  wrapper.appendChild(input);

  return { wrapper, input };
}

function buildEditForm(project) {
  const form = document.createElement('form');
  form.noValidate = true;

  const { wrapper: nombreWrapper, input: nombreInput } = buildLabeledField({
    id: 'editar-proyecto-nombre',
    label: 'Nombre',
    value: project.name || '',
  });
  form.appendChild(nombreWrapper);

  const descripcion = buildTextareaField({
    id: 'editar-proyecto-descripcion', label: 'Descripción', value: project.description,
  });
  form.appendChild(descripcion.wrapper);
  const descripcionInput = descripcion.input;

  const fieldRow = document.createElement('div');
  fieldRow.className = 'form-row';

  const { wrapper: ubicacionWrapper, input: ubicacionInput } = buildLabeledField({
    id: 'editar-proyecto-ubicacion',
    label: 'Ubicación general',
    value: project.location || '',
  });
  const { wrapper: fechaWrapper, input: fechaInput } = buildLabeledField({
    id: 'editar-proyecto-fecha-inicio',
    label: 'Fecha de inicio',
    type: 'date',
    value: project.start_date || '',
  });
  fieldRow.appendChild(ubicacionWrapper);
  fieldRow.appendChild(fechaWrapper);
  form.appendChild(fieldRow);

  const estadoWrapper = document.createElement('div');
  estadoWrapper.className = 'form-field';
  const estadoLabel = document.createElement('label');
  estadoLabel.setAttribute('for', 'editar-proyecto-estado');
  estadoLabel.textContent = 'Estado';
  const estadoSelect = document.createElement('select');
  estadoSelect.id = 'editar-proyecto-estado';
  estadoSelect.name = 'estado';
  [
    { value: 'activo', label: 'Activo' },
    { value: 'pausado', label: 'Pausado' },
    { value: 'finalizado', label: 'Finalizado' },
  ].forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (value === project.status) {
      option.selected = true;
    }
    estadoSelect.appendChild(option);
  });
  estadoWrapper.appendChild(estadoLabel);
  estadoWrapper.appendChild(estadoSelect);
  form.appendChild(estadoWrapper);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'btn btn-primary';
  submitBtn.textContent = 'Guardar cambios';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.addEventListener('click', closeEditModal);

  actions.appendChild(submitBtn);
  actions.appendChild(cancelBtn);
  form.appendChild(actions);

  return {
    form, nombreInput, descripcionInput, ubicacionInput, fechaInput, estadoSelect, submitBtn,
  };
}

async function handleEditSubmit(event, fields) {
  event.preventDefault();

  const {
    nombreInput, descripcionInput, ubicacionInput, fechaInput, estadoSelect, submitBtn,
  } = fields;

  clearFieldError(nombreInput);

  const nombre = nombreInput.value.trim();
  if (!nombre) {
    setFieldError(nombreInput, 'Ingresa el nombre del proyecto.');
    nombreInput.focus();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Guardando...';

  try {
    const { data, error } = await supabase
      .from('projects')
      .update({
        name: nombre,
        description: descripcionInput.value.trim() || null,
        location: ubicacionInput.value.trim() || null,
        start_date: fechaInput.value || null,
        status: estadoSelect.value,
      })
      .eq('id', currentProject.id)
      .select()
      .single();

    submitBtn.disabled = false;
    submitBtn.textContent = 'Guardar cambios';

    if (error || !data) {
      console.error('Error al actualizar el proyecto:', error);
      announce('No se pudo guardar el proyecto. Intenta de nuevo.');
      return;
    }

    currentProject = data;
    renderProject(currentProject);
    closeEditModal();
    announce(`"${nombre}" fue actualizado.`);
  } catch (error) {
    console.error('Error al actualizar el proyecto:', error);
    announce('Ocurrió un error inesperado. Intenta nuevamente.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Guardar cambios';
  }
}

function openEditModal(trigger) {
  if (editOverlay || !currentProject) {
    return;
  }

  editTrigger = trigger;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'editar-proyecto-titulo');

  const closeCorner = document.createElement('button');
  closeCorner.type = 'button';
  closeCorner.className = 'modal-close';
  closeCorner.setAttribute('aria-label', 'Cerrar');
  closeCorner.textContent = 'Cerrar';
  closeCorner.addEventListener('click', closeEditModal);

  const title = document.createElement('h2');
  title.id = 'editar-proyecto-titulo';
  title.className = 'modal-title';
  title.textContent = 'Editar proyecto';

  const subtitle = document.createElement('p');
  subtitle.className = 'modal-subtitle';
  subtitle.textContent = 'Actualiza la información básica de tu proyecto.';

  const fields = buildEditForm(currentProject);
  fields.form.addEventListener('submit', (event) => handleEditSubmit(event, fields));

  dialog.appendChild(closeCorner);
  dialog.appendChild(title);
  dialog.appendChild(subtitle);
  dialog.appendChild(fields.form);
  overlay.appendChild(dialog);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeEditModal();
    }
  });

  document.body.appendChild(overlay);
  document.addEventListener('keydown', handleEditKeydown);
  editOverlay = overlay;
  fields.nombreInput.focus();
}

/* ============================================================================
   ARCHIVAR PROYECTO (UPDATE status = "finalizado")
   ============================================================================ */
async function archiveProject(trigger) {
  if (!currentProject) {
    return;
  }

  const confirmed = await confirmDialog({
    titleText: 'Archivar proyecto',
    message: `"${currentProject.name}" pasará a estado Finalizado. Podrás seguir consultando su información.`,
    confirmLabel: 'Archivar proyecto',
    confirmClassName: 'btn btn-primary',
    restoreFocusTo: trigger,
  });

  if (!confirmed) {
    return;
  }

  try {
    const { data, error } = await supabase
      .from('projects')
      .update({ status: 'finalizado' })
      .eq('id', currentProject.id)
      .select()
      .single();

    if (error || !data) {
      console.error('Error al archivar el proyecto:', error);
      announce('No se pudo archivar el proyecto. Intenta de nuevo.');
      return;
    }

    currentProject = data;
    renderProject(currentProject);
    announce(`"${currentProject.name}" fue archivado.`);
  } catch (error) {
    console.error('Error al archivar el proyecto:', error);
    announce('Ocurrió un error inesperado. Intenta nuevamente.');
  }
}

/* ============================================================================
   ELIMINAR PROYECTO (SOFT DELETE: deleted_at)
   ============================================================================ */
async function deleteProject(trigger) {
  if (!currentProject) {
    return;
  }

  const confirmed = await confirmDialog({
    titleText: 'Eliminar proyecto',
    message: `"${currentProject.name}" se moverá a la papelera. Podrás restaurarlo desde allí.`,
    confirmLabel: 'Eliminar proyecto',
    confirmClassName: 'btn btn-secondary settings-danger-btn',
    restoreFocusTo: trigger,
  });

  if (!confirmed) {
    return;
  }

  try {
    const { error } = await supabase
      .from('projects')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', currentProject.id);

    if (error) {
      console.error('Error al eliminar el proyecto:', error);
      announce('No se pudo eliminar el proyecto. Intenta de nuevo.');
      return;
    }

    announce(`"${currentProject.name}" fue movido a la papelera.`);
    window.location.href = 'index.html';
  } catch (error) {
    console.error('Error al eliminar el proyecto:', error);
    announce('Ocurrió un error inesperado. Intenta nuevamente.');
  }
}

/* ============================================================================
   MENÚ DE ACCIONES DEL PROYECTO
   ============================================================================ */
function closeContextMenu(menu, trigger) {
  const list = menu.querySelector('.context-menu-list');
  if (list) {
    list.remove();
  }
  trigger.setAttribute('aria-expanded', 'false');
}

function buildContextMenuList(trigger, menu) {
  const list = document.createElement('div');
  list.className = 'context-menu-list';
  list.setAttribute('role', 'menu');

  const actions = [
    { label: 'Editar proyecto', danger: false, handler: () => openEditModal(trigger) },
    { label: 'Archivar proyecto', danger: false, handler: () => archiveProject(trigger) },
    { label: 'Eliminar proyecto', danger: true, handler: () => deleteProject(trigger) },
  ];

  actions.forEach(({ label, danger, handler }) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.className = danger ? 'context-menu-item context-menu-item-danger' : 'context-menu-item';
    item.textContent = label;
    item.addEventListener('click', () => {
      closeContextMenu(menu, trigger);
      handler();
    });
    list.appendChild(item);
  });

  return list;
}

/**
 * Usa el botón "···" de la cabecera si existe; si no (página antigua),
 * crea el botón "Más acciones" junto al encabezado del proyecto.
 */
function getOrCreateMenu() {
  const existingTrigger = document.getElementById('proyecto-acciones-trigger');
  const existingMenu = document.getElementById('proyecto-acciones');
  if (existingTrigger && existingMenu) {
    return { menu: existingMenu, trigger: existingTrigger };
  }

  const header = document.querySelector('.workspace-header-row');
  if (!header) {
    return null;
  }

  const menu = document.createElement('div');
  menu.className = 'context-menu';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'btn btn-secondary context-menu-trigger';
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.textContent = 'Más acciones';

  menu.appendChild(trigger);
  header.appendChild(menu);
  return { menu, trigger };
}

function initContextMenu() {
  const found = getOrCreateMenu();
  if (!found) {
    return;
  }
  const { menu, trigger } = found;

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = trigger.getAttribute('aria-expanded') === 'true';

    if (isOpen) {
      closeContextMenu(menu, trigger);
      return;
    }

    const list = buildContextMenuList(trigger, menu);
    menu.appendChild(list);
    trigger.setAttribute('aria-expanded', 'true');
    const firstItem = list.querySelector('.context-menu-item');
    if (firstItem) {
      firstItem.focus();
    }
  });

  document.addEventListener('click', (event) => {
    if (!menu.contains(event.target)) {
      closeContextMenu(menu, trigger);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
      closeContextMenu(menu, trigger);
      trigger.focus();
    }
  });
}

/* ============================================================================
   INICIALIZACIÓN
   ============================================================================ */
async function init() {
  if (!document.getElementById('proyecto-contenido')) {
    return;
  }

  await loadProject();

  if (currentProject) {
    initContextMenu();
    initContractEdit();
    initDocumentosProyecto(currentProject.id);
    initPersonal(currentProject.id);
  }
}

document.addEventListener('DOMContentLoaded', init);