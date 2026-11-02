/**
 * proyectos.js
 * Listado de proyectos conectado a Supabase: listado real desde la
 * tabla "projects" (con RLS por usuario), búsqueda sobre los datos
 * cargados y creación de proyectos mediante INSERT real.
 *
 * Cambios de la versión de rediseño:
 *  - "Crear proyecto" es ahora un botón directo ("Nuevo") en la
 *    cabecera, en vez de un menú que solo tenía esa opción. Si la
 *    página antigua con el menú (#proyectos-menu) existiera, sigue
 *    funcionando.
 *  - Tarjetas nuevas: estado, nombre, descripción corta, ubicación y
 *    fecha de inicio o última actualización. El proyecto activo (el
 *    último usado) se marca como "Actual".
 *  - Conteo de proyectos junto al título.
 *  - Se quitó del formulario el campo "Imagen (opcional)": la imagen
 *    nunca se guardaba (cover_image_url siempre era null).
 */

import { supabase } from '../config/supabase.js';
import { announce } from '../app-shell.js';
import { setFieldError, clearFieldError } from '../utils/validaciones.js';
import { textIncludes } from '../utils/formato.js';
import { getCurrentProjectId } from '../utils/proyecto-actual.js';
import { confirmDialog } from '../utils/alertas.js';

/* ============================================================================
   ESTADO EN MEMORIA DEL LISTADO
   ============================================================================ */
let allProjects = [];

const STATUS_LABELS = {
  activo: 'Activo',
  pausado: 'Pausado',
  finalizado: 'Finalizado',
};

/* ============================================================================
   CARGA DE DATOS
   ============================================================================ */
async function fetchProjects() {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error al cargar proyectos:', error);
      announce('No se pudieron cargar tus proyectos. Intenta de nuevo.');
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error al cargar proyectos:', error);
    announce('Ocurrió un error inesperado. Intenta nuevamente.');
    return [];
  }
}

/* ============================================================================
   PRESENTACIÓN — TARJETAS
   ============================================================================ */
function iconSpan(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.dataset.icon = name;
  span.setAttribute('aria-hidden', 'true');
  return span;
}

function buildStatusBadge(status) {
  const badge = document.createElement('span');
  const normalized = status && STATUS_LABELS[status] ? status : 'activo';
  badge.className = `status-badge status-badge-${normalized}`;
  badge.textContent = STATUS_LABELS[normalized];
  return badge;
}

function formatShortDate(value) {
  return new Date(value).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

function buildFact(icon, text) {
  const fact = document.createElement('span');
  fact.className = 'project-card-fact';
  fact.appendChild(iconSpan(icon));
  const label = document.createElement('span');
  label.textContent = text;
  fact.appendChild(label);
  return fact;
}

function buildProjectCard(project, currentId) {
  const li = document.createElement('li');
  li.className = 'project-card';
  li.dataset.projectId = project.id;

  const isCurrent = currentId && String(project.id) === String(currentId);
  if (isCurrent) {
    li.classList.add('is-current');
  }

  const link = document.createElement('a');
  link.className = 'project-card-link';
  link.href = `proyecto.html?id=${project.id}`;

  // Fila superior: estado (+ "Actual") y flecha
  const top = document.createElement('div');
  top.className = 'project-card-top';

  const badges = document.createElement('div');
  badges.className = 'project-card-badges';
  badges.appendChild(buildStatusBadge(project.status));
  if (isCurrent) {
    const current = document.createElement('span');
    current.className = 'project-card-current';
    current.textContent = 'Actual';
    badges.appendChild(current);
  }

  top.appendChild(badges);

  const title = document.createElement('h3');
  title.textContent = project.name;

  link.appendChild(top);
  link.appendChild(title);

  const description = project.description ? project.description.trim() : '';
  if (description) {
    const desc = document.createElement('p');
    desc.className = 'project-card-desc';
    desc.textContent = description;
    link.appendChild(desc);
  }

  // Datos reales al pie: ubicación y fecha de inicio (o de actualización)
  const facts = document.createElement('div');
  facts.className = 'project-card-facts';

  const location = project.location ? project.location.trim() : '';
  facts.appendChild(buildFact('ubicacion', location || 'Sin ubicación'));

  if (project.start_date) {
    facts.appendChild(buildFact('calendario', `Inicio: ${formatShortDate(`${project.start_date}T00:00:00`)}`));
  } else if (project.updated_at || project.created_at) {
    facts.appendChild(buildFact('reloj', `Actualizado: ${formatShortDate(project.updated_at || project.created_at)}`));
  }

  link.appendChild(facts);

  li.appendChild(link);
  li.appendChild(buildCardMenu(project));
  return li;
}

/* ============================================================================
   MENÚ ⋯ DE CADA TARJETA: abrir, archivar/reactivar, eliminar
   ============================================================================ */
let openCardMenu = null;

function closeCardMenu() {
  if (!openCardMenu) {
    return;
  }
  const { wrapper, trigger } = openCardMenu;
  const list = wrapper.querySelector('.context-menu-list');
  if (list) {
    list.remove();
  }
  trigger.setAttribute('aria-expanded', 'false');
  wrapper.closest('.project-card')?.classList.remove('is-menu-open');
  openCardMenu = null;
}

function buildCardMenu(project) {
  const wrapper = document.createElement('div');
  wrapper.className = 'context-menu project-card-menu';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'project-card-menu-btn';
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', `Opciones de ${project.name}`);
  trigger.appendChild(iconSpan('mas-opciones'));
  wrapper.appendChild(trigger);

  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const yaAbierto = openCardMenu && openCardMenu.trigger === trigger;
    closeCardMenu();
    if (yaAbierto) {
      return;
    }

    const archivado = project.status === 'finalizado';
    const acciones = [
      { label: 'Abrir proyecto', handler: () => { window.location.href = `proyecto.html?id=${project.id}`; } },
      {
        label: archivado ? 'Reactivar proyecto' : 'Archivar proyecto',
        handler: () => cambiarEstado(project, archivado ? 'activo' : 'finalizado'),
      },
      { label: 'Eliminar proyecto', danger: true, handler: () => eliminarProyecto(project, trigger) },
    ];

    const list = document.createElement('div');
    list.className = 'context-menu-list';
    list.setAttribute('role', 'menu');
    acciones.forEach(({ label, danger, handler }) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.className = danger ? 'context-menu-item context-menu-item-danger' : 'context-menu-item';
      item.textContent = label;
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        closeCardMenu();
        handler();
      });
      list.appendChild(item);
    });

    wrapper.appendChild(list);
    wrapper.closest('.project-card')?.classList.add('is-menu-open');
    trigger.setAttribute('aria-expanded', 'true');
    openCardMenu = { wrapper, trigger };

    // Si no cabe hacia abajo (barra inferior), se abre hacia arriba
    const rect = list.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 96) {
      list.classList.add('is-up');
    }
    const primero = list.querySelector('.context-menu-item');
    if (primero) {
      primero.focus();
    }
  });

  return wrapper;
}

async function cambiarEstado(project, status) {
  try {
    const { error } = await supabase.from('projects').update({ status }).eq('id', project.id);
    if (error) {
      console.error('Error al cambiar el estado del proyecto:', error);
      announce('No se pudo actualizar el proyecto. Intenta de nuevo.');
      return;
    }
    announce(status === 'finalizado'
      ? `"${project.name}" fue archivado.`
      : `"${project.name}" está activo de nuevo.`);
    await loadAndRenderProjects();
  } catch (error) {
    console.error('Error al cambiar el estado del proyecto:', error);
    announce('Ocurrió un error inesperado. Intenta nuevamente.');
  }
}

async function eliminarProyecto(project, trigger) {
  const confirmado = await confirmDialog({
    titleText: 'Eliminar proyecto',
    message: `"${project.name}" se moverá a la papelera. Podrás restaurarlo desde allí.`,
    confirmLabel: 'Eliminar proyecto',
    confirmClassName: 'btn btn-secondary settings-danger-btn',
    restoreFocusTo: trigger,
  });
  if (!confirmado) {
    return;
  }

  try {
    const { error } = await supabase
      .from('projects')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', project.id);
    if (error) {
      console.error('Error al eliminar el proyecto:', error);
      announce('No se pudo eliminar el proyecto. Intenta de nuevo.');
      return;
    }
    announce(`"${project.name}" fue movido a la papelera.`);
    await loadAndRenderProjects();
  } catch (error) {
    console.error('Error al eliminar el proyecto:', error);
    announce('Ocurrió un error inesperado. Intenta nuevamente.');
  }
}

document.addEventListener('click', (event) => {
  if (openCardMenu && !openCardMenu.wrapper.contains(event.target)) {
    closeCardMenu();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && openCardMenu) {
    const { trigger } = openCardMenu;
    closeCardMenu();
    trigger.focus();
  }
});

function getFilteredProjects() {
  const searchInput = document.getElementById('buscar-proyectos');
  const query = searchInput ? searchInput.value : '';

  if (!query.trim()) {
    return allProjects;
  }

  return allProjects.filter((project) => {
    const searchableText = `${project.name || ''} ${project.location || ''} ${project.description || ''}`;
    return textIncludes(searchableText, query);
  });
}

function renderCount(filteredCount) {
  const countEl = document.getElementById('proyectos-count');
  if (!countEl) {
    return;
  }
  if (!allProjects.length) {
    countEl.textContent = '';
    return;
  }
  const total = allProjects.length;
  if (filteredCount !== total) {
    countEl.textContent = `${filteredCount} de ${total}`;
    return;
  }
  countEl.textContent = total === 1 ? '1 proyecto' : `${total} proyectos`;
}

function renderGrid() {
  const grid = document.getElementById('projects-grid');
  const emptyState = document.getElementById('empty-state');
  const emptyEyebrow = document.getElementById('empty-state-eyebrow');
  const emptyTitle = document.getElementById('empty-state-title');
  const emptyDescription = document.getElementById('empty-state-description');
  const emptyCreateBtn = document.getElementById('empty-state-create-btn');

  if (!grid || !emptyState) {
    return;
  }

  const currentId = getCurrentProjectId();
  const filtered = getFilteredProjects();
  grid.innerHTML = '';
  filtered.forEach((project) => grid.appendChild(buildProjectCard(project, currentId)));
  renderCount(filtered.length);

  if (allProjects.length === 0) {
    grid.hidden = true;
    emptyState.hidden = false;
    if (emptyEyebrow) {
      emptyEyebrow.textContent = 'Comienza aquí';
    }
    if (emptyTitle) {
      emptyTitle.textContent = 'Todavía no tienes proyectos';
    }
    if (emptyDescription) {
      emptyDescription.textContent = 'Crea tu primer proyecto para empezar a llevar su bitácora.';
    }
    if (emptyCreateBtn) {
      emptyCreateBtn.hidden = false;
    }
    return;
  }

  if (filtered.length === 0) {
    grid.hidden = true;
    emptyState.hidden = false;
    if (emptyEyebrow) {
      emptyEyebrow.textContent = 'Sin resultados';
    }
    if (emptyTitle) {
      emptyTitle.textContent = 'No se encontraron proyectos';
    }
    if (emptyDescription) {
      emptyDescription.textContent = 'Intenta con otro término de búsqueda.';
    }
    if (emptyCreateBtn) {
      emptyCreateBtn.hidden = true;
    }
    return;
  }

  grid.hidden = false;
  emptyState.hidden = true;
}

async function loadAndRenderProjects() {
  allProjects = await fetchProjects();
  renderGrid();
}

/* ============================================================================
   BÚSQUEDA
   ============================================================================ */
function initSearch() {
  const searchForm = document.querySelector('.search-form');
  const searchInput = document.getElementById('buscar-proyectos');

  if (searchForm) {
    searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (searchInput) {
        searchInput.blur(); // cierra el teclado del teléfono
      }
      renderGrid();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', renderGrid);
  }
}

/* ============================================================================
   BOTÓN "NUEVO" (y menú antiguo, si existiera)
   ============================================================================ */
function initNewProjectButton() {
  const btn = document.getElementById('proyectos-nuevo-btn');
  if (!btn) {
    return;
  }
  btn.addEventListener('click', () => {
    createProjectTrigger = btn;
    openCreateProjectModal();
  });
}

function closeHeaderMenu() {
  const wrapper = document.getElementById('proyectos-menu');
  const trigger = document.getElementById('proyectos-menu-trigger');
  if (!wrapper || !trigger) {
    return;
  }
  const list = wrapper.querySelector('.context-menu-list');
  if (list) {
    list.remove();
  }
  trigger.setAttribute('aria-expanded', 'false');
}

function initHeaderMenu() {
  const wrapper = document.getElementById('proyectos-menu');
  const trigger = document.getElementById('proyectos-menu-trigger');
  if (!wrapper || !trigger) {
    return;
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = trigger.getAttribute('aria-expanded') === 'true';

    if (isOpen) {
      closeHeaderMenu();
      return;
    }

    const list = document.createElement('ul');
    list.className = 'context-menu-list';
    list.setAttribute('role', 'list');

    const li = document.createElement('li');
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'context-menu-item';
    item.textContent = 'Crear proyecto';
    item.addEventListener('click', () => {
      closeHeaderMenu();
      createProjectTrigger = trigger;
      openCreateProjectModal();
    });
    li.appendChild(item);
    list.appendChild(li);

    wrapper.appendChild(list);
    trigger.setAttribute('aria-expanded', 'true');
    item.focus();
  });

  document.addEventListener('click', (event) => {
    if (!wrapper.contains(event.target)) {
      closeHeaderMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
      closeHeaderMenu();
      trigger.focus();
    }
  });
}

/* ============================================================================
   FORMULARIO: CREAR PROYECTO (INSERT REAL EN SUPABASE)
   ============================================================================ */
let createProjectOverlay = null;
let createProjectTrigger = null;

function closeCreateProjectModal() {
  if (!createProjectOverlay) {
    return;
  }
  createProjectOverlay.remove();
  createProjectOverlay = null;
  document.removeEventListener('keydown', handleCreateProjectKeydown);

  if (createProjectTrigger) {
    createProjectTrigger.focus();
  }
}

function handleCreateProjectKeydown(event) {
  if (event.key === 'Escape') {
    closeCreateProjectModal();
  }
}

function buildLabeledField({
  id, label, type = 'text', required = false, placeholder = '',
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
  if (placeholder) {
    input.placeholder = placeholder;
  }
  if (required) {
    input.required = true;
    input.setAttribute('aria-required', 'true');
  }

  wrapper.appendChild(labelEl);
  wrapper.appendChild(input);

  return { wrapper, input };
}

function buildCreateProjectForm() {
  const form = document.createElement('form');
  form.noValidate = true;

  const { wrapper: nombreWrapper, input: nombreInput } = buildLabeledField({
    id: 'proyecto-nombre-input',
    label: 'Nombre',
    required: true,
    placeholder: 'Edificio Torres del Mar',
  });
  form.appendChild(nombreWrapper);

  const descripcionWrapper = document.createElement('div');
  descripcionWrapper.className = 'form-field';
  const descripcionLabel = document.createElement('label');
  descripcionLabel.setAttribute('for', 'proyecto-descripcion');
  descripcionLabel.textContent = 'Descripción (opcional)';
  const descripcionInput = document.createElement('textarea');
  descripcionInput.id = 'proyecto-descripcion';
  descripcionInput.name = 'descripcion';
  descripcionWrapper.appendChild(descripcionLabel);
  descripcionWrapper.appendChild(descripcionInput);
  form.appendChild(descripcionWrapper);

  const fieldRow = document.createElement('div');
  fieldRow.className = 'form-row';

  const { wrapper: ubicacionWrapper, input: ubicacionInput } = buildLabeledField({
    id: 'proyecto-ubicacion',
    label: 'Ubicación general',
    placeholder: 'Ciudad, barrio o vereda',
  });
  const { wrapper: fechaWrapper, input: fechaInput } = buildLabeledField({
    id: 'proyecto-fecha-inicio',
    label: 'Fecha de inicio',
    type: 'date',
  });
  fieldRow.appendChild(ubicacionWrapper);
  fieldRow.appendChild(fechaWrapper);
  form.appendChild(fieldRow);

  const estadoWrapper = document.createElement('div');
  estadoWrapper.className = 'form-field';
  const estadoLabel = document.createElement('label');
  estadoLabel.setAttribute('for', 'proyecto-estado');
  estadoLabel.textContent = 'Estado';
  const estadoSelect = document.createElement('select');
  estadoSelect.id = 'proyecto-estado';
  estadoSelect.name = 'estado';
  [
    { value: 'activo', label: 'Activo' },
    { value: 'pausado', label: 'Pausado' },
    { value: 'finalizado', label: 'Finalizado' },
  ].forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
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
  submitBtn.textContent = 'Crear proyecto';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.addEventListener('click', closeCreateProjectModal);

  actions.appendChild(submitBtn);
  actions.appendChild(cancelBtn);
  form.appendChild(actions);

  return {
    form, nombreInput, descripcionInput, ubicacionInput, fechaInput, estadoSelect, submitBtn,
  };
}

async function handleCreateProjectSubmit(event, fields) {
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

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !session.user) {
      announce('Debes iniciar sesión para crear un proyecto.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creando...';

    const { data: existing, error: duplicateError } = await supabase
      .from('projects')
      .select('id')
      .eq('owner_id', session.user.id)
      .ilike('name', nombre)
      .is('deleted_at', null)
      .limit(1);

    if (duplicateError) {
      console.error('Error al verificar proyectos existentes:', duplicateError);
      announce('Ocurrió un error inesperado. Intenta nuevamente.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Crear proyecto';
      return;
    }

    if (existing && existing.length > 0) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Crear proyecto';
      setFieldError(nombreInput, 'Ya tienes un proyecto con ese nombre.');
      return;
    }

    const { error } = await supabase.from('projects').insert({
      owner_id: session.user.id,
      name: nombre,
      description: descripcionInput.value.trim() || null,
      location: ubicacionInput.value.trim() || null,
      start_date: fechaInput.value || null,
      status: estadoSelect.value,
      cover_image_url: null,
    });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Crear proyecto';

    if (error) {
      console.error('Error al crear el proyecto:', error);
      announce('No se pudo crear el proyecto. Intenta de nuevo.');
      return;
    }

    closeCreateProjectModal();
    announce(`"${nombre}" fue creado.`);
    await loadAndRenderProjects();
  } catch (error) {
    console.error('Error al crear el proyecto:', error);
    announce('Ocurrió un error inesperado. Intenta nuevamente.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Crear proyecto';
  }
}

function openCreateProjectModal() {
  if (createProjectOverlay) {
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'crear-proyecto-titulo');

  const closeCorner = document.createElement('button');
  closeCorner.type = 'button';
  closeCorner.className = 'modal-close';
  closeCorner.setAttribute('aria-label', 'Cerrar');
  closeCorner.textContent = 'Cerrar';
  closeCorner.addEventListener('click', closeCreateProjectModal);

  const title = document.createElement('h2');
  title.id = 'crear-proyecto-titulo';
  title.className = 'modal-title';
  title.textContent = 'Nuevo proyecto';

  const subtitle = document.createElement('p');
  subtitle.className = 'modal-subtitle';
  subtitle.textContent = 'Completa la información básica. Podrás editarla cuando quieras.';

  const fields = buildCreateProjectForm();

  fields.form.addEventListener('submit', (event) => {
    handleCreateProjectSubmit(event, fields);
  });

  dialog.appendChild(closeCorner);
  dialog.appendChild(title);
  dialog.appendChild(subtitle);
  dialog.appendChild(fields.form);
  overlay.appendChild(dialog);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeCreateProjectModal();
    }
  });

  document.body.appendChild(overlay);
  document.addEventListener('keydown', handleCreateProjectKeydown);
  createProjectOverlay = overlay;
  fields.nombreInput.focus();
}

function initCreateProjectModal() {
  const emptyStateCreateBtn = document.getElementById('empty-state-create-btn');
  if (emptyStateCreateBtn) {
    emptyStateCreateBtn.addEventListener('click', (event) => {
      event.preventDefault();
      createProjectTrigger = emptyStateCreateBtn;
      openCreateProjectModal();
    });
  }
}

/* ============================================================================
   INICIALIZACIÓN
   ============================================================================ */
function init() {
  const grid = document.getElementById('projects-grid');
  if (grid) {
    initSearch();
    initNewProjectButton();
    initHeaderMenu();
    initCreateProjectModal();
    loadAndRenderProjects();

    // Desde el Inicio ("Crear proyecto" sin proyectos aún) se puede
    // llegar con #nuevo para abrir directamente el formulario.
    if (window.location.hash === '#nuevo') {
      createProjectTrigger = document.getElementById('proyectos-nuevo-btn');
      openCreateProjectModal();
    }
  }
}

document.addEventListener('DOMContentLoaded', init);