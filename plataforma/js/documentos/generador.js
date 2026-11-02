/**
 * generador.js — Documentos (Etapa 1: motor de documentos)
 *
 * Recorrido en 4 pasos:
 *  1. Tipo: catálogo agrupado (obra, interventoría, actas, laboral y SST).
 *  2. Datos: proyecto, período (solo si el tipo lo usa) y los campos
 *     propios del documento (por ejemplo, la incapacidad pide
 *     trabajador, origen, fecha y días).
 *  3. Revisión: lista de verificación de datos reales (modo "verificar"
 *     de la función ai-bcivil) e instrucciones opcionales.
 *  4. Documento: vista previa formateada y editable (toca un texto para
 *     editarlo; los datos pendientes [entre corchetes] se resaltan) y
 *     exportación a PDF o Word.
 *
 * PERSONAL DEL PROYECTO: en los documentos laborales, al escribir el
 * nombre del trabajador se sugieren los del personal registrado y se
 * avisa que su cédula, cargo y EPS o ARL se completan solos (el servidor
 * hace el completado; aquí solo se muestra la ayuda).
 *
 * ABRIR UN DOCUMENTO GUARDADO: documentos.html?doc=<id> carga un
 * documento ya generado (por ejemplo, desde el Asistente) directamente
 * en el paso 4. ?doc=local lo toma de esta pestaña si no se guardó.
 *
 * MEMBRETE: el logo y los datos de la empresa (Configuración → Membrete
 * de documentos) se muestran en la vista previa y salen en cada página
 * del PDF y del Word.
 *
 * Los ids de tipo y de campos deben coincidir con las FICHAS de la
 * función ai-bcivil: el servidor es quien define la estructura.
 */

import { supabase } from '../config/supabase.js';
import { announce } from '../app-shell.js';
import { getCurrentProjectId } from '../utils/proyecto-actual.js';
import { setFieldError, clearFieldError } from '../utils/validaciones.js';
import { confirmDialog } from '../utils/alertas.js';
import { cargarPersonal } from '../utils/personal.js';
import { exportarDocumentoPDF, exportarDocumentoWord, textoADocumento } from './exportacion.js';

/* ============================================================================
   ÍCONOS
   ============================================================================ */
const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const ICONOS = {
  dia: svg('<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>'),
  semana: svg('<rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01"></path>'),
  mes: svg('<rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path><rect x="7" y="13" width="4" height="4"></rect>'),
  resumen: svg('<path d="M3 3v18h18"></path><path d="M7 16v-4M12 16V8M17 16v-7"></path>'),
  lista: svg('<path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1Z"></path><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"></path><path d="M8 11h8M8 15h8"></path>'),
  lupa: svg('<path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1Z"></path><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"></path><circle cx="16.5" cy="16.5" r="3.5"></circle><path d="m19 19 2.5 2.5"></path>'),
  oficio: svg('<path d="M4 6h16v12H4z"></path><path d="m4 7 8 6 8-6"></path>'),
  inicio: svg('<path d="M5 21V4"></path><path d="M5 4h11l-2 4 2 4H5"></path>'),
  pausa: svg('<circle cx="12" cy="12" r="9"></circle><path d="M10 9v6M14 9v6"></path>'),
  comite: svg('<circle cx="9" cy="8" r="3"></circle><path d="M3 20a6 6 0 0 1 12 0"></path><circle cx="17" cy="9" r="2.5"></circle><path d="M16 14.5a5 5 0 0 1 5 5.5"></path>'),
  pregunta: svg('<circle cx="12" cy="12" r="9"></circle><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"></path><path d="M12 17h.01"></path>'),
  alerta: svg('<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"></path><path d="M12 9v4M12 17h.01"></path>'),
  salud: svg('<rect x="3" y="7" width="18" height="13" rx="2"></rect><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M12 11v5M9.5 13.5h5"></path>'),
  balanza: svg('<path d="M12 3v18M5 21h14M6 7h12"></path><path d="m6 7-3 7a3 3 0 0 0 6 0Z"></path><path d="m18 7-3 7a3 3 0 0 0 6 0Z"></path>'),
  lapiz: svg('<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>'),
};

/* ============================================================================
   CATÁLOGO (debe coincidir con las FICHAS del servidor)
   periodo: período por defecto; null = el documento no usa período.
   ============================================================================ */
const GRUPOS = [
  { id: 'obra', titulo: 'Informes de obra' },
  { id: 'interventoria', titulo: 'Interventoría' },
  { id: 'actas', titulo: 'Actas y comunicaciones' },
  { id: 'laboral', titulo: 'Laboral y SST' },
  { id: 'otro', titulo: 'Otro' },
];

const ORIGEN_INCAPACIDAD = ['Enfermedad general (EPS)', 'Accidente de trabajo (ARL)', 'Enfermedad laboral (ARL)', 'Licencia de maternidad o paternidad (EPS)'];
const TIPO_EVENTO = ['Incidente (sin lesión)', 'Accidente de trabajo'];

const TIPOS = [
  { id: 'informe-diario', grupo: 'obra', titulo: 'Informe diario de obra', descripcion: 'Lo que pasó hoy: clima, personal, equipos y actividades.', icono: 'dia', periodo: 'dia', campos: [] },
  { id: 'informe-semanal', grupo: 'obra', titulo: 'Informe semanal de avance', descripcion: 'El avance del contratista en la semana, con personal y maquinaria.', icono: 'semana', periodo: 'semana', campos: [] },
  { id: 'informe-mensual', grupo: 'obra', titulo: 'Informe mensual de avance', descripcion: 'Avance, recursos, seguridad e imprevistos del mes.', icono: 'mes', periodo: 'mes', campos: [] },
  { id: 'resumen-ejecutivo', grupo: 'obra', titulo: 'Resumen ejecutivo', descripcion: 'Panorama del proyecto para alguien que no lo conoce.', icono: 'resumen', periodo: 'todo', campos: [] },

  { id: 'informe-interventoria-semanal', grupo: 'interventoria', titulo: 'Informe semanal de interventoría', descripcion: 'Seguimiento técnico, calidad, SST y requerimientos al contratista.', icono: 'lupa', periodo: 'semana', campos: [] },
  { id: 'informe-interventoria', grupo: 'interventoria', titulo: 'Informe mensual de interventoría', descripcion: 'Evaluación integral: administrativa, técnica, financiera, SST y ambiental.', icono: 'lupa', periodo: 'mes', campos: [] },
  {
    id: 'oficio-requerimiento', grupo: 'interventoria', titulo: 'Oficio de requerimiento', descripcion: 'Comunica un hallazgo o no conformidad al contratista y exige corrección.', icono: 'oficio', periodo: 'semana',
    campos: [
      { id: 'hallazgo', etiqueta: 'Hallazgo o no conformidad', tipo: 'textarea', requerido: true, placeholder: 'Ej. Recubrimiento del acero de columnas C4 a C9 inferior a lo especificado.' },
      { id: 'plazo', etiqueta: 'Plazo de respuesta', tipo: 'text', placeholder: 'Ej. 5 días hábiles' },
      { id: 'referencia', etiqueta: 'Referencia (plano, ítem o especificación)', tipo: 'text' },
    ],
  },

  {
    id: 'acta-inicio', grupo: 'actas', titulo: 'Acta de inicio', descripcion: 'Constancia formal del inicio de ejecución del contrato.', icono: 'inicio', periodo: null,
    campos: [
      { id: 'fecha_inicio', etiqueta: 'Fecha de inicio', tipo: 'date', requerido: true },
      { id: 'lugar', etiqueta: 'Lugar de la reunión', tipo: 'text' },
      { id: 'observaciones', etiqueta: 'Observaciones o constancias', tipo: 'textarea' },
    ],
  },
  {
    id: 'acta-suspension', grupo: 'actas', titulo: 'Acta de suspensión', descripcion: 'Suspende temporalmente la obra, con su motivo y estado.', icono: 'pausa', periodo: 'semana',
    campos: [
      { id: 'fecha_suspension', etiqueta: 'Fecha de suspensión', tipo: 'date', requerido: true },
      { id: 'motivo', etiqueta: 'Motivo de la suspensión', tipo: 'textarea', requerido: true },
      { id: 'fecha_reinicio', etiqueta: 'Fecha prevista de reinicio', tipo: 'date' },
      { id: 'actividades_afectadas', etiqueta: 'Actividades afectadas', tipo: 'textarea' },
    ],
  },
  {
    id: 'acta-comite', grupo: 'actas', titulo: 'Acta de comité de obra', descripcion: 'Asistentes, temas tratados y compromisos de una reunión.', icono: 'comite', periodo: 'semana',
    campos: [
      { id: 'fecha_reunion', etiqueta: 'Fecha de la reunión', tipo: 'date', requerido: true },
      { id: 'asistentes', etiqueta: 'Asistentes', tipo: 'textarea', requerido: true, placeholder: 'Uno por línea: nombre - cargo - entidad' },
      { id: 'temas', etiqueta: 'Temas tratados', tipo: 'textarea', requerido: true },
      { id: 'compromisos', etiqueta: 'Compromisos', tipo: 'textarea', placeholder: 'Uno por línea: compromiso - responsable - fecha' },
      { id: 'proxima_reunion', etiqueta: 'Próxima reunión', tipo: 'text' },
    ],
  },
  {
    id: 'rfi', grupo: 'actas', titulo: 'Solicitud de información (RFI)', descripcion: 'Consulta técnica a la interventoría o al diseñador.', icono: 'pregunta', periodo: null,
    campos: [
      { id: 'consulta', etiqueta: 'Consulta técnica', tipo: 'textarea', requerido: true },
      { id: 'referencia_tecnica', etiqueta: 'Plano o especificación', tipo: 'text' },
      { id: 'frente', etiqueta: 'Frente de trabajo', tipo: 'text' },
      { id: 'impacto', etiqueta: 'Impacto si no se responde', tipo: 'textarea' },
    ],
  },

  {
    id: 'reporte-incidente', grupo: 'laboral', titulo: 'Reporte de incidente o accidente', descripcion: 'Registro interno de un evento de SST: hechos, atención y acciones.', icono: 'alerta', periodo: null,
    campos: [
      { id: 'trabajador', etiqueta: 'Nombre del trabajador', tipo: 'text', requerido: true },
      { id: 'cedula', etiqueta: 'Cédula', tipo: 'text', inputmode: 'numeric' },
      { id: 'cargo', etiqueta: 'Cargo', tipo: 'text' },
      { id: 'tipo_evento', etiqueta: 'Tipo de evento', tipo: 'select', opciones: TIPO_EVENTO, requerido: true },
      { id: 'fecha_hora', etiqueta: 'Fecha y hora del evento', tipo: 'datetime-local', requerido: true },
      { id: 'lugar', etiqueta: 'Lugar o frente de trabajo', tipo: 'text', requerido: true },
      { id: 'descripcion', etiqueta: 'Descripción de los hechos', tipo: 'textarea', requerido: true },
      { id: 'lesion', etiqueta: 'Lesión (si la hubo)', tipo: 'text' },
      { id: 'atencion', etiqueta: 'Atención brindada', tipo: 'textarea' },
    ],
  },
  {
    id: 'incapacidad', grupo: 'laboral', titulo: 'Reporte de incapacidad', descripcion: 'Novedad de incapacidad de un trabajador para nómina y SG-SST.', icono: 'salud', periodo: null,
    campos: [
      { id: 'trabajador', etiqueta: 'Nombre del trabajador', tipo: 'text', requerido: true },
      { id: 'cedula', etiqueta: 'Cédula', tipo: 'text', inputmode: 'numeric' },
      { id: 'cargo', etiqueta: 'Cargo', tipo: 'text' },
      { id: 'origen', etiqueta: 'Origen de la incapacidad', tipo: 'select', opciones: ORIGEN_INCAPACIDAD, requerido: true },
      { id: 'entidad', etiqueta: 'EPS o ARL que la expide', tipo: 'text' },
      { id: 'fecha_inicio', etiqueta: 'Fecha de inicio', tipo: 'date', requerido: true },
      { id: 'dias', etiqueta: 'Días de incapacidad', tipo: 'number', requerido: true, min: 1 },
      { id: 'reemplazo', etiqueta: 'Reemplazo o ajuste en obra', tipo: 'text' },
    ],
  },
  {
    id: 'citacion-descargos', grupo: 'laboral', titulo: 'Citación a descargos', descripcion: 'Citación formal con hechos, fecha de la diligencia y derechos del trabajador.', icono: 'balanza', periodo: null,
    campos: [
      { id: 'trabajador', etiqueta: 'Nombre del trabajador', tipo: 'text', requerido: true },
      { id: 'cedula', etiqueta: 'Cédula', tipo: 'text', inputmode: 'numeric' },
      { id: 'cargo', etiqueta: 'Cargo', tipo: 'text' },
      { id: 'hechos', etiqueta: 'Hechos', tipo: 'textarea', requerido: true },
      { id: 'fecha_diligencia', etiqueta: 'Fecha y hora de la diligencia', tipo: 'datetime-local', requerido: true },
      { id: 'lugar', etiqueta: 'Lugar de la diligencia', tipo: 'text' },
    ],
  },

  { id: 'acta-novedades', grupo: 'otro', titulo: 'Acta de novedades', descripcion: 'Relación cronológica formal de las novedades del período.', icono: 'lista', periodo: 'semana', campos: [] },
  { id: 'personalizado', grupo: 'otro', titulo: 'Documento personalizado', descripcion: 'Describe exactamente lo que necesitas; misma regla: solo datos reales.', icono: 'lapiz', periodo: 'semana', campos: [] },
];

const PERIODO_LABELS = {
  dia: 'Hoy', semana: 'Última semana', mes: 'Último mes', todo: 'Todo el proyecto',
};

/* ============================================================================
   ELEMENTOS DEL DOM
   ============================================================================ */
const $ = (id) => document.getElementById(id);
const typeGridEl = $('doc-type-grid');
const step1NextBtn = $('doc-step-1-next');
const personalizadoField = $('doc-personalizado-field');
const personalizadoInput = $('doc-personalizado-input');
const proyectoSelect = $('doc-proyecto');
const periodField = $('doc-period-field');
const camposEl = $('doc-campos');
const verificacionEl = $('doc-verificacion');
const instruccionesInput = $('doc-instrucciones');
const step3NextBtn = $('doc-step-3-next');
const previewEl = $('doc-preview');
const pendientesEl = $('doc-pendientes');
const exportPdfBtn = $('doc-exportar-pdf');
const exportWordBtn = $('doc-exportar-word');
const periodoBtns = {
  dia: $('doc-periodo-dia'), semana: $('doc-periodo-semana'), mes: $('doc-periodo-mes'), todo: $('doc-periodo-todo'),
};

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const PLACEHOLDER_RE = /\[[^\]\n]{1,140}\]/g;

/* ============================================================================
   ESTADO
   ============================================================================ */
let tipoActual = null;
let periodoSeleccionado = 'semana';
let documentoActual = null;
let verificacionToken = 0;
let membreteCache; // undefined = sin cargar · null = sin configurar
let refrescarPersonal = null; // se define cuando el documento pide un trabajador

function normalizarNombre(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Mismo criterio del servidor: solo hay coincidencia si es única */
function buscarEnPersonal(lista, nombre) {
  const objetivo = normalizarNombre(nombre).split(' ').filter(Boolean);
  if (!objetivo.length) return null;
  const exactos = lista.filter((p) => normalizarNombre(p.nombre) === objetivo.join(' '));
  if (exactos.length === 1) return exactos[0];
  if (exactos.length > 1) return null;
  const parciales = lista.filter((p) => {
    const t = normalizarNombre(p.nombre).split(' ');
    return objetivo.every((x) => t.includes(x)) || t.every((x) => objetivo.includes(x));
  });
  return parciales.length === 1 ? parciales[0] : null;
}

/** Sugerencias de trabajadores y aviso de qué datos se completarán solos */
function prepararAyudaPersonal() {
  refrescarPersonal = null;
  const input = camposEl.querySelector('[data-campo="trabajador"]');
  if (!input) return;

  const datalist = document.createElement('datalist');
  datalist.id = 'doc-personal-lista';
  camposEl.appendChild(datalist);
  input.setAttribute('list', datalist.id);

  const hint = document.createElement('p');
  hint.className = 'capture-field-hint doc-personal-hint';
  hint.hidden = true;
  // Encima del campo: debajo quedaría tapado por la barra fija de "Continuar"
  input.closest('.form-field').insertBefore(hint, input);

  let lista = [];

  const actualizarHint = () => {
    const valor = input.value.trim();
    hint.hidden = !valor || !lista.length;
    if (hint.hidden) return;
    const fila = buscarEnPersonal(lista, valor);
    const completa = fila
      ? [fila.cedula && 'cédula', fila.cargo && 'cargo', (fila.eps || fila.arl) && 'EPS o ARL'].filter(Boolean)
      : [];
    hint.classList.toggle('is-ok', Boolean(fila));
    hint.textContent = fila
      ? `${fila.nombre} está en el personal del proyecto${completa.length ? `: se completan su ${completa.join(', ')}.` : '.'}`
      : 'No está en el personal del proyecto: escribe su cédula o regístralo en el proyecto.';
  };

  refrescarPersonal = async () => {
    lista = await cargarPersonal(proyectoSelect.value);
    datalist.innerHTML = '';
    lista.forEach((p) => {
      const option = document.createElement('option');
      option.value = p.nombre;
      datalist.appendChild(option);
    });
    actualizarHint();
  };

  input.addEventListener('input', actualizarHint);
  input.addEventListener('change', actualizarHint);
  refrescarPersonal();
}

/** Membrete de la empresa guardado en la cuenta (user_metadata.membrete) */
async function obtenerMembrete() {
  if (membreteCache !== undefined) return membreteCache;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const m = user && user.user_metadata ? user.user_metadata.membrete : null;
    membreteCache = m && (m.empresa || m.logo_url) ? m : null;
  } catch (e) {
    membreteCache = null;
  }
  return membreteCache;
}

/* ============================================================================
   UTILIDADES
   ============================================================================ */
function escapeHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto == null ? '' : String(texto);
  return div.innerHTML;
}

/** Texto con los [pendientes] resaltados */
function resaltar(texto) {
  return escapeHtml(texto).replace(PLACEHOLDER_RE, (m) => `<mark class="doc-ph">${m}</mark>`);
}

function nombreProyecto() {
  const opt = proyectoSelect && proyectoSelect.options[proyectoSelect.selectedIndex];
  return opt ? opt.textContent : 'Proyecto';
}

/* ============================================================================
   PASO 1 — TIPO DE DOCUMENTO
   ============================================================================ */
function renderTypeGrid() {
  if (!typeGridEl) return;
  typeGridEl.innerHTML = '';

  GRUPOS.forEach((grupo) => {
    const tipos = TIPOS.filter((t) => t.grupo === grupo.id);
    if (!tipos.length) return;

    const titulo = document.createElement('p');
    titulo.className = 'doc-type-group';
    titulo.textContent = grupo.titulo;
    titulo.setAttribute('role', 'presentation');
    typeGridEl.appendChild(titulo);

    tipos.forEach((tipo) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'doc-type-card';
      card.dataset.tipo = tipo.id;
      card.setAttribute('role', 'listitem');
      card.setAttribute('aria-pressed', 'false');
      card.innerHTML = `
        <span class="doc-type-card-icon" aria-hidden="true">${ICONOS[tipo.icono] || ICONOS.lista}</span>
        <span class="doc-type-card-title">${escapeHtml(tipo.titulo)}</span>
        <span class="doc-type-card-desc">${escapeHtml(tipo.descripcion)}</span>`;
      card.addEventListener('click', () => seleccionarTipo(tipo, card));
      typeGridEl.appendChild(card);
    });
  });

  if (personalizadoInput) {
    personalizadoInput.addEventListener('input', () => {
      if (tipoActual && tipoActual.id === 'personalizado') {
        step1NextBtn.disabled = !personalizadoInput.value.trim();
      }
    });
  }
}

function seleccionarTipo(tipo, card) {
  tipoActual = tipo;
  typeGridEl.querySelectorAll('.doc-type-card').forEach((el) => {
    const sel = el === card;
    el.classList.toggle('is-selected', sel);
    el.setAttribute('aria-pressed', String(sel));
  });

  const esPersonalizado = tipo.id === 'personalizado';
  if (personalizadoField) personalizadoField.hidden = !esPersonalizado;

  if (esPersonalizado) {
    step1NextBtn.disabled = !personalizadoInput.value.trim();
    personalizadoField.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center' });
    personalizadoInput.focus({ preventScroll: true });
  } else {
    step1NextBtn.disabled = false;
  }
}

/* ============================================================================
   PASO 2 — PROYECTO, PERÍODO Y CAMPOS DEL DOCUMENTO
   ============================================================================ */
async function loadProjectsIntoSelect() {
  if (!proyectoSelect) return;
  const { data, error } = await supabase.from('projects').select('id, name')
    .is('deleted_at', null).order('name', { ascending: true });

  proyectoSelect.innerHTML = '';
  if (error || !data || !data.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No tienes proyectos todavía';
    proyectoSelect.appendChild(option);
    proyectoSelect.disabled = true;
    return;
  }

  data.forEach((p) => {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.name;
    proyectoSelect.appendChild(option);
  });

  const actual = getCurrentProjectId();
  if (actual && data.some((p) => String(p.id) === String(actual))) {
    proyectoSelect.value = actual;
  }
}

function setPeriodo(periodo) {
  periodoSeleccionado = periodo;
  Object.entries(periodoBtns).forEach(([key, btn]) => {
    if (!btn) return;
    const activo = key === periodo;
    btn.classList.toggle('is-active', activo);
    btn.setAttribute('aria-pressed', String(activo));
  });
}

function prepararPaso2() {
  const tipo = tipoActual;
  // Período: solo si el documento lo usa
  if (periodField) periodField.hidden = !tipo.periodo;
  if (tipo.periodo) setPeriodo(tipo.periodo);

  // Campos propios del documento
  camposEl.innerHTML = '';
  camposEl.hidden = !tipo.campos.length;
  if (!tipo.campos.length) return;

  const titulo = document.createElement('p');
  titulo.className = 'doc-field-label doc-campos-titulo';
  titulo.textContent = `Datos para el ${tipo.titulo.toLowerCase()}`;
  camposEl.appendChild(titulo);

  tipo.campos.forEach((campo) => {
    const wrap = document.createElement('div');
    wrap.className = 'form-field';
    const id = `doc-campo-${campo.id}`;

    const label = document.createElement('label');
    label.setAttribute('for', id);
    label.innerHTML = `${escapeHtml(campo.etiqueta)}${campo.requerido ? '' : ' <span class="doc-opcional">(opcional)</span>'}`;

    let input;
    if (campo.tipo === 'textarea') {
      input = document.createElement('textarea');
    } else if (campo.tipo === 'select') {
      input = document.createElement('select');
      const vacia = document.createElement('option');
      vacia.value = '';
      vacia.textContent = 'Selecciona una opción';
      input.appendChild(vacia);
      campo.opciones.forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o;
        input.appendChild(opt);
      });
    } else {
      input = document.createElement('input');
      input.type = campo.tipo;
      if (campo.min) input.min = String(campo.min);
      if (campo.inputmode) input.inputMode = campo.inputmode;
    }
    input.id = id;
    input.dataset.campo = campo.id;
    if (campo.placeholder) input.placeholder = campo.placeholder;
    if (campo.requerido) input.setAttribute('aria-required', 'true');
    input.addEventListener('input', () => clearFieldError(input));
    input.addEventListener('change', () => clearFieldError(input));

    wrap.appendChild(label);
    wrap.appendChild(input);
    camposEl.appendChild(wrap);
  });

  prepararAyudaPersonal();
}

function leerDatos() {
  const datos = {};
  camposEl.querySelectorAll('[data-campo]').forEach((input) => {
    let valor = input.value.trim();
    // datetime-local llega como 2026-10-06T08:30 → formato legible
    if (input.type === 'datetime-local' && valor) {
      const fecha = new Date(valor);
      valor = Number.isNaN(fecha.getTime()) ? valor : fecha.toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' });
    }
    datos[input.dataset.campo] = valor;
  });
  return datos;
}

function validarPaso2() {
  if (!proyectoSelect.value) {
    announce('Selecciona un proyecto para continuar.');
    return false;
  }
  let primero = null;
  tipoActual.campos.forEach((campo) => {
    const input = camposEl.querySelector(`[data-campo="${campo.id}"]`);
    if (!input) return;
    clearFieldError(input);
    if (campo.requerido && !input.value.trim()) {
      setFieldError(input, `${campo.etiqueta} es obligatorio.`);
      if (!primero) primero = input;
    }
    if (campo.tipo === 'number' && input.value && Number(input.value) < (campo.min || 0)) {
      setFieldError(input, `Debe ser un número mayor o igual a ${campo.min}.`);
      if (!primero) primero = input;
    }
  });
  if (primero) {
    primero.focus();
    return false;
  }
  return true;
}

/* ============================================================================
   PASO 3 — VERIFICACIÓN DE DATOS
   ============================================================================ */
function cuerpoBase() {
  return {
    projectId: proyectoSelect.value,
    tipoId: tipoActual.id,
    tipoDocumento: tipoActual.id === 'personalizado' ? personalizadoInput.value.trim() : tipoActual.titulo,
    periodo: tipoActual.periodo ? periodoSeleccionado : 'todo',
    datos: leerDatos(),
  };
}

async function verificar() {
  if (!verificacionEl) return;
  const token = ++verificacionToken;
  verificacionEl.innerHTML = '<li class="doc-verif-item is-cargando">Revisando la información del proyecto…</li>';
  step3NextBtn.disabled = true;

  try {
    const { data, error } = await supabase.functions.invoke('ai-bcivil', {
      body: { mode: 'verificar', ...cuerpoBase() },
    });
    if (token !== verificacionToken) return;

    if (error || !data || !data.verificacion) {
      // Función aún sin actualizar o sin conexión: se permite continuar
      verificacionEl.innerHTML = '<li class="doc-verif-item is-aviso">No se pudo revisar la información en este momento. Puedes generar el documento igual.</li>';
      step3NextBtn.disabled = false;
      return;
    }

    verificacionEl.innerHTML = '';
    data.verificacion.items.forEach((item) => {
      const li = document.createElement('li');
      li.className = `doc-verif-item is-${item.estado}`;
      li.textContent = item.texto;
      verificacionEl.appendChild(li);
    });
    step3NextBtn.disabled = !data.verificacion.puedeGenerar;
  } catch (e) {
    if (token !== verificacionToken) return;
    verificacionEl.innerHTML = '<li class="doc-verif-item is-aviso">Sin conexión para revisar la información. Verifica tu señal.</li>';
    step3NextBtn.disabled = false;
  }
}

/* ============================================================================
   NAVEGACIÓN ENTRE PASOS
   ============================================================================ */
function goToStep(step, { scroll = true } = {}) {
  for (let i = 1; i <= 4; i += 1) {
    const panel = $(`doc-panel-${i}`);
    const indicator = $(`doc-step-indicator-${i}`);
    if (panel) panel.hidden = i !== step;
    if (indicator) {
      indicator.classList.toggle('is-active', i === step);
      indicator.classList.toggle('is-complete', i < step);
      if (i === step) indicator.setAttribute('aria-current', 'step');
      else indicator.removeAttribute('aria-current');
    }
  }
  const fill = $('doc-stepper-fill');
  if (fill) fill.style.width = `${((step - 1) / 3) * 100}%`;

  if (!scroll) return;
  window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  const titulo = $(`doc-panel-${step}-titulo`);
  if (titulo) {
    titulo.setAttribute('tabindex', '-1');
    titulo.focus({ preventScroll: true });
  }
}

/* ============================================================================
   PASO 4 — VISTA PREVIA EDITABLE
   ============================================================================ */
function editable(el, campo) {
  el.contentEditable = 'true';
  el.spellcheck = true;
  if (campo) el.dataset.campo = campo;
  // Al salir del texto se vuelven a resaltar los pendientes
  el.addEventListener('blur', () => {
    const texto = el.textContent;
    el.innerHTML = resaltar(texto);
    actualizarPendientes();
  });
  el.addEventListener('input', actualizarPendientes);
  return el;
}

function crear(tag, className, html) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (html !== undefined) el.innerHTML = html;
  return el;
}

function renderDocumento(doc) {
  previewEl.innerHTML = '';
  const papel = crear('article', 'doc-paper');

  // Membrete de la empresa
  if (membreteCache) {
    const m = membreteCache;
    const banda = crear('div', 'doc-paper-membrete');
    if (m.logo_url) {
      const img = document.createElement('img');
      img.src = m.logo_url;
      img.alt = m.empresa ? `Logo de ${m.empresa}` : 'Logo de la empresa';
      img.className = 'doc-paper-logo';
      img.addEventListener('error', () => img.remove());
      banda.appendChild(img);
    }
    const datos = crear('div', 'doc-paper-membrete-datos');
    if (m.empresa) datos.appendChild(crear('strong', '', escapeHtml(m.empresa)));
    if (m.nit) datos.appendChild(crear('span', '', `NIT ${escapeHtml(m.nit)}`));
    const contacto = [m.direccion, m.telefono, m.correo].filter(Boolean).join(' · ');
    if (contacto) datos.appendChild(crear('span', '', escapeHtml(contacto)));
    banda.appendChild(datos);
    papel.appendChild(banda);
  }

  // Encabezado
  const head = crear('header', 'doc-paper-head');
  head.appendChild(crear('p', 'doc-paper-code', escapeHtml(doc.codigo || '')));
  head.appendChild(editable(crear('h3', 'doc-paper-title', resaltar(doc.titulo)), 'titulo'));

  const meta = crear('dl', 'doc-paper-meta');
  const filasMeta = [
    ['Proyecto', 'proyecto', false], ['Fecha', 'fecha', false], ['Ubicación', 'ubicacion', true],
    ['Elaborado por', 'elaborado_por', true], ['Dirigido a', 'dirigido_a', true], ['Asunto', 'asunto', true],
  ];
  filasMeta.forEach(([etiqueta, clave, esEditable]) => {
    let valor = doc.metadatos[clave];
    if (clave === 'fecha' && /^\d{4}-\d{2}-\d{2}$/.test(valor || '')) {
      valor = new Date(`${valor}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (!valor && clave === 'asunto') return;
    const fila = crear('div', 'doc-paper-meta-row');
    fila.appendChild(crear('dt', '', escapeHtml(etiqueta)));
    const dd = crear('dd', '', resaltar(valor || ''));
    if (esEditable) editable(dd, `meta.${clave}`);
    fila.appendChild(dd);
    meta.appendChild(fila);
  });
  head.appendChild(meta);
  papel.appendChild(head);

  // Secciones
  let numero = 0;
  doc.secciones.forEach((seccion) => {
    const esAdvertencia = seccion.titulo === 'Advertencia';
    const sec = crear('section', `doc-paper-section${esAdvertencia ? ' is-advertencia' : ''}`);
    sec.dataset.titulo = seccion.titulo;
    if (!esAdvertencia) {
      numero += 1;
      sec.appendChild(crear('h4', '', `${numero}. ${escapeHtml(seccion.titulo)}`));
    }

    seccion.bloques.forEach((b) => {
      if (b.tipo === 'lista') {
        const ul = crear('ul', 'doc-b doc-b--lista');
        ul.dataset.tipo = 'lista';
        b.items.forEach((it) => ul.appendChild(editable(crear('li', '', resaltar(it)))));
        sec.appendChild(ul);
      } else if (b.tipo === 'tabla') {
        const wrap = crear('div', 'doc-table-wrap');
        const table = crear('table', 'doc-b doc-b--tabla');
        table.dataset.tipo = 'tabla';
        const thead = crear('thead');
        const trh = crear('tr');
        b.columnas.forEach((c) => trh.appendChild(editable(crear('th', '', resaltar(c)))));
        thead.appendChild(trh);
        const tbody = crear('tbody');
        b.filas.forEach((fila) => {
          const tr = crear('tr');
          fila.forEach((celda) => tr.appendChild(editable(crear('td', '', resaltar(celda)))));
          tbody.appendChild(tr);
        });
        table.appendChild(thead);
        table.appendChild(tbody);
        wrap.appendChild(table);
        sec.appendChild(wrap);
      } else {
        const p = editable(crear('p', `doc-b doc-b--${b.tipo}`, resaltar(b.texto)));
        p.dataset.tipo = b.tipo;
        sec.appendChild(p);
      }
    });
    papel.appendChild(sec);
  });

  // Firmas
  if (doc.firmas && doc.firmas.length) {
    const firmas = crear('div', 'doc-paper-firmas');
    doc.firmas.forEach((f) => {
      const caja = crear('div', 'doc-firma');
      caja.appendChild(crear('span', 'doc-firma-linea'));
      caja.appendChild(editable(crear('span', 'doc-firma-nombre', resaltar(f.nombre))));
      caja.appendChild(crear('span', 'doc-firma-cargo', escapeHtml(f.cargo)));
      caja.dataset.cargo = f.cargo;
      firmas.appendChild(caja);
    });
    papel.appendChild(firmas);
  }

  // Fuentes (no editables)
  if (doc.fuentes && doc.fuentes.length) {
    const det = crear('details', 'doc-paper-fuentes');
    det.appendChild(crear('summary', '', `Registros de bitácora consultados (${doc.fuentes.length})`));
    const ul = crear('ul');
    doc.fuentes.forEach((f) => ul.appendChild(crear('li', '', `${escapeHtml(f.fecha)} · ${escapeHtml(f.tipo)}`)));
    det.appendChild(ul);
    papel.appendChild(det);
  }

  previewEl.appendChild(papel);

  // Sin membrete: invitación a configurarlo
  if (!membreteCache) {
    const aviso = crear('p', 'doc-membrete-aviso',
      'Tus documentos pueden salir con el logo y los datos de tu empresa. <a href="../configuracion.html#membrete">Configurar membrete</a>');
    previewEl.appendChild(aviso);
  }
  actualizarPendientes();
}

/** Reconstruye el documento a partir de lo que el usuario editó */
function leerDocumentoEditado() {
  const doc = JSON.parse(JSON.stringify(documentoActual));
  const papel = previewEl.querySelector('.doc-paper');
  if (!papel) return doc;
  const txt = (el) => (el ? el.textContent.trim() : '');

  doc.titulo = txt(papel.querySelector('[data-campo="titulo"]')) || doc.titulo;
  papel.querySelectorAll('[data-campo^="meta."]').forEach((el) => {
    doc.metadatos[el.dataset.campo.slice(5)] = txt(el);
  });

  doc.secciones = Array.from(papel.querySelectorAll('.doc-paper-section')).map((sec) => ({
    titulo: sec.dataset.titulo,
    bloques: Array.from(sec.querySelectorAll('[data-tipo]')).map((el) => {
      const tipo = el.dataset.tipo;
      if (tipo === 'lista') return { tipo, items: Array.from(el.querySelectorAll('li')).map(txt).filter(Boolean) };
      if (tipo === 'tabla') {
        return {
          tipo,
          columnas: Array.from(el.querySelectorAll('thead th')).map(txt),
          filas: Array.from(el.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.children).map(txt)),
        };
      }
      return { tipo, texto: txt(el) };
    }),
  }));

  doc.firmas = Array.from(papel.querySelectorAll('.doc-firma')).map((f) => ({
    cargo: f.dataset.cargo,
    nombre: txt(f.querySelector('.doc-firma-nombre')),
  }));
  return doc;
}

function contarPendientes() {
  const papel = previewEl.querySelector('.doc-paper');
  if (!papel) return 0;
  let texto = '';
  papel.querySelectorAll('[contenteditable="true"]').forEach((el) => { texto += ` ${el.textContent}`; });
  return (texto.match(PLACEHOLDER_RE) || []).length;
}

function actualizarPendientes() {
  if (!pendientesEl) return;
  const n = contarPendientes();
  pendientesEl.hidden = !previewEl.querySelector('.doc-paper');
  pendientesEl.classList.toggle('is-listo', n === 0);
  pendientesEl.textContent = n
    ? `${n} dato${n === 1 ? '' : 's'} pendiente${n === 1 ? '' : 's'} por completar. Toca el texto resaltado para editarlo.`
    : 'Sin datos pendientes. Revísalo y expórtalo.';
}

function mostrarCargando() {
  pendientesEl.hidden = true;
  const n = (verificacionEl && verificacionEl.querySelector('.is-ok')) ? verificacionEl.querySelector('.is-ok').textContent : '';
  previewEl.innerHTML = `
    <div class="doc-generando" role="status">
      <span class="doc-generando-titulo">Redactando ${escapeHtml(tipoActual.titulo.toLowerCase())}…</span>
      <span class="doc-generando-detalle">${escapeHtml(n || 'Usando solo la información real de tu proyecto.')}</span>
      <span class="doc-generando-linea"></span><span class="doc-generando-linea"></span><span class="doc-generando-linea is-corta"></span>
    </div>`;
}

async function generarDocumento() {
  if (!tipoActual || !proyectoSelect.value) {
    announce('Selecciona un tipo de documento y un proyecto.');
    return;
  }

  step3NextBtn.disabled = true;
  step3NextBtn.textContent = 'Generando…';
  exportPdfBtn.disabled = true;
  exportWordBtn.disabled = true;
  documentoActual = null;

  goToStep(4);
  mostrarCargando();

  try {
    const { data, error } = await supabase.functions.invoke('ai-bcivil', {
      body: {
        mode: 'documento',
        ...cuerpoBase(),
        instrucciones: instruccionesInput ? instruccionesInput.value.trim() : '',
      },
    });

    if (error || !data || data.error) {
      let mensaje = (data && data.error) || '';
      if (!mensaje && error && error.context && typeof error.context.json === 'function') {
        try { mensaje = (await error.context.json()).error || ''; } catch (e) { /* sin detalle */ }
      }
      console.error('Error al generar el documento:', error || data);
      announce(mensaje || 'No se pudo generar el documento. Vuelve a intentarlo.');
      goToStep(3);
      return;
    }

    // Servidor nuevo: documento estructurado. Servidor anterior: texto.
    documentoActual = data.documento || textoADocumento(data.respuesta, {
      titulo: tipoActual.titulo,
      proyecto: nombreProyecto(),
      periodo: PERIODO_LABELS[periodoSeleccionado],
    });

    await obtenerMembrete();
    renderDocumento(documentoActual);
    if (documentoActual.secciones_incompletas && documentoActual.secciones_incompletas.length) {
      announce('Algunas secciones quedaron pendientes. Revísalas antes de exportar.');
    }
  } catch (err) {
    console.error('Error inesperado al generar el documento:', err);
    announce('Ocurrió un error de conexión. Verifica tu señal e intenta de nuevo.');
    goToStep(3);
  } finally {
    exportPdfBtn.disabled = false;
    exportWordBtn.disabled = false;
    step3NextBtn.disabled = false;
    step3NextBtn.textContent = 'Generar documento';
  }
}

async function exportar(formato) {
  if (!documentoActual) {
    announce('Genera un documento antes de exportar.');
    return;
  }

  const pendientes = contarPendientes();
  if (pendientes) {
    const seguir = await confirmDialog({
      titleText: 'Hay datos pendientes',
      message: `El documento tiene ${pendientes} dato${pendientes === 1 ? '' : 's'} entre corchetes sin completar. ¿Quieres exportarlo de todos modos?`,
      confirmLabel: 'Exportar igual',
      cancelLabel: 'Seguir editando',
      restoreFocusTo: formato === 'pdf' ? exportPdfBtn : exportWordBtn,
    });
    if (!seguir) return;
  }

  const boton = formato === 'pdf' ? exportPdfBtn : exportWordBtn;
  boton.disabled = true;
  try {
    const doc = leerDocumentoEditado();
    const membrete = await obtenerMembrete();
    if (formato === 'pdf') {
      await exportarDocumentoPDF(doc, membrete);
      announce('El PDF se descargó.');
    } else {
      exportarDocumentoWord(doc, membrete);
      announce('El documento de Word se descargó.');
    }
  } catch (error) {
    console.error(`Error al exportar a ${formato}:`, error);
    announce(formato === 'pdf'
      ? 'No se pudo generar el PDF. Recarga la página e intenta de nuevo.'
      : 'No se pudo generar el documento de Word. Intenta de nuevo.');
  } finally {
    boton.disabled = false;
  }
}

/* ============================================================================
   ABRIR UN DOCUMENTO YA GENERADO (desde el Asistente)
   ============================================================================ */
async function abrirDocumentoGuardado(param, proyectosListos) {
  let doc = null;
  let projectId = null;

  if (param === 'local') {
    try {
      const guardado = JSON.parse(sessionStorage.getItem('bcivil-doc-local') || 'null');
      if (guardado) {
        doc = guardado.documento;
        projectId = guardado.projectId;
      }
    } catch (e) { /* sin datos */ }
  } else {
    const { data, error } = await supabase.from('documents')
      .select('id, content, document_type, project_id')
      .eq('id', param)
      .maybeSingle();
    if (!error && data && data.content) {
      try {
        doc = JSON.parse(data.content);
        doc.id = data.id;
        projectId = data.project_id;
      } catch (e) { doc = null; }
    }
  }

  history.replaceState(null, '', window.location.pathname);

  if (!doc || !Array.isArray(doc.secciones)) {
    announce('No se encontró el documento. Puedes generarlo de nuevo.');
    return;
  }

  tipoActual = TIPOS.find((t) => t.id === doc.tipo_documento) || TIPOS.find((t) => t.id === 'personalizado');
  const card = typeGridEl.querySelector(`[data-tipo="${tipoActual.id}"]`);
  if (card) {
    card.classList.add('is-selected');
    card.setAttribute('aria-pressed', 'true');
  }
  step1NextBtn.disabled = false;

  await proyectosListos;
  if (projectId) proyectoSelect.value = projectId;
  prepararPaso2();

  documentoActual = doc;
  await obtenerMembrete();
  goToStep(4, { scroll: false });
  renderDocumento(doc);
}

/* ============================================================================
   REINICIAR
   ============================================================================ */
function reiniciar() {
  tipoActual = null;
  documentoActual = null;
  if (personalizadoField) personalizadoField.hidden = true;
  if (personalizadoInput) personalizadoInput.value = '';
  typeGridEl.querySelectorAll('.doc-type-card').forEach((el) => {
    el.classList.remove('is-selected');
    el.setAttribute('aria-pressed', 'false');
  });
  step1NextBtn.disabled = true;
  if (instruccionesInput) instruccionesInput.value = '';
  camposEl.innerHTML = '';
  previewEl.innerHTML = '';
  pendientesEl.hidden = true;
  goToStep(1);
}

/* ============================================================================
   PLANTILLAS — carga desde Supabase (tabla "plantillas")
   ============================================================================ */
let plantillasCargadas = false;

function iconoParaTipo(tipoArchivo) {
  const tipo = (tipoArchivo || '').toLowerCase();
  if (tipo.includes('excel') || tipo.includes('xls')) {
    return svg('<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M8 4v16M16 4v16M3 10h18M3 16h18"></path>');
  }
  if (tipo.includes('word') || tipo.includes('doc')) {
    return svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path><path d="m9 13 1.5 6L12 15l1.5 4L15 13"></path>');
  }
  return svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path><path d="M9 13h6M9 17h6"></path>');
}

function buildPlantillaCard(plantilla) {
  const li = document.createElement('li');
  const link = document.createElement('a');
  link.className = 'plantilla-card';
  link.href = plantilla.archivo_url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.innerHTML = `
    <span class="plantilla-card-icon" aria-hidden="true">${iconoParaTipo(plantilla.tipo_archivo)}</span>
    <span class="plantilla-card-textos">
      <span class="plantilla-card-title">${escapeHtml(plantilla.nombre)}</span>
      <span class="plantilla-card-meta">${escapeHtml([plantilla.categoria, plantilla.tipo_archivo, plantilla.descripcion].filter(Boolean).join(' · '))}</span>
    </span>`;
  li.appendChild(link);
  return li;
}

async function cargarPlantillas() {
  if (plantillasCargadas) return;
  plantillasCargadas = true;
  const grid = $('plantillas-grid');
  const emptyState = $('plantillas-empty-state');
  if (!grid || !emptyState) return;

  const { data, error } = await supabase.from('plantillas').select('*')
    .order('categoria', { ascending: true }).order('orden', { ascending: true });

  if (error) {
    console.error('Error al cargar las plantillas:', error);
    plantillasCargadas = false;
    return;
  }
  if (!data || !data.length) {
    grid.hidden = true;
    emptyState.hidden = false;
    return;
  }
  grid.innerHTML = '';
  data.forEach((p) => grid.appendChild(buildPlantillaCard(p)));
  grid.hidden = false;
  emptyState.hidden = true;
}

function initTabs() {
  const tabGenerar = $('tab-generar');
  const tabPlantillas = $('tab-plantillas');
  const seccionGenerar = $('seccion-generar');
  const seccionPlantillas = $('seccion-plantillas');
  if (!tabGenerar || !tabPlantillas || !seccionGenerar || !seccionPlantillas) return;

  function activar(tab) {
    const esGenerar = tab === 'generar';
    tabGenerar.classList.toggle('is-active', esGenerar);
    tabGenerar.setAttribute('aria-selected', String(esGenerar));
    tabPlantillas.classList.toggle('is-active', !esGenerar);
    tabPlantillas.setAttribute('aria-selected', String(!esGenerar));
    seccionGenerar.hidden = !esGenerar;
    seccionPlantillas.hidden = esGenerar;
  }

  tabGenerar.addEventListener('click', () => activar('generar'));
  tabPlantillas.addEventListener('click', () => {
    activar('plantillas');
    cargarPlantillas();
  });
}

/* ============================================================================
   INICIALIZACIÓN
   ============================================================================ */
function init() {
  obtenerMembrete();
  initTabs();
  renderTypeGrid();
  const proyectosListos = loadProjectsIntoSelect();
  setPeriodo('semana');
  goToStep(1, { scroll: false });

  const docParam = new URLSearchParams(window.location.search).get('doc');
  if (docParam) {
    abrirDocumentoGuardado(docParam, proyectosListos);
  }

  step1NextBtn.addEventListener('click', () => {
    if (!tipoActual) return;
    prepararPaso2();
    goToStep(2);
  });

  $('doc-step-2-back').addEventListener('click', () => goToStep(1));
  $('doc-step-2-next').addEventListener('click', () => {
    if (!validarPaso2()) return;
    goToStep(3);
    verificar();
  });

  Object.entries(periodoBtns).forEach(([key, btn]) => {
    if (btn) btn.addEventListener('click', () => setPeriodo(key));
  });

  // Si cambia el proyecto, cambia también el personal que se sugiere
  proyectoSelect.addEventListener('change', () => {
    if (refrescarPersonal) refrescarPersonal();
  });

  $('doc-step-3-back').addEventListener('click', () => goToStep(2));
  step3NextBtn.textContent = 'Generar documento';
  step3NextBtn.addEventListener('click', generarDocumento);

  $('doc-step-4-back').addEventListener('click', () => goToStep(3));
  $('doc-step-4-restart').addEventListener('click', reiniciar);

  exportPdfBtn.addEventListener('click', () => exportar('pdf'));
  exportWordBtn.addEventListener('click', () => exportar('word'));
}

init();