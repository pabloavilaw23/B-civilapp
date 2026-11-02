/**
 * dashboard.js
 * Pantalla de Inicio conectada a datos reales de Supabase:
 *  - saludo con el nombre de la cuenta (user_metadata.full_name),
 *  - proyecto usado más recientemente,
 *  - registros de bitácora de los últimos 7 días (total, por día y
 *    por tipo),
 *  - últimos registros y otros proyectos.
 *
 * Guarda el proyecto activo con proyecto-actual.js para que el botón
 * global de registro rápido sepa en qué proyecto trabajar desde
 * cualquier página.
 *
 * Nota: la navegación de esta página usa el id "hub-nav-bitacora" (y no
 * "nav-bitacora") porque app-shell.js todavía marca "nav-bitacora" como
 * sección pendiente y bloquearía el enlace.
 */

import { supabase } from './config/supabase.js';
import { announce } from './app-shell.js';
import { formatDisplayDate, formatDisplayTime } from './utils/fechas.js';
import { setCurrentProjectId } from './utils/proyecto-actual.js';

const TYPE_INFO = {
  texto: { label: 'Novedad', icon: 'novedad' },
  fotografia: { label: 'Fotografía', icon: 'fotografia' },
  'nota-voz': { label: 'Nota de voz', icon: 'voz' },
  ensayo: { label: 'Ensayo', icon: 'ensayo' },
  sst: { label: 'Evento SST', icon: 'seguridad' },
  avance: { label: 'Avance', icon: 'avance' },
};

// Los registros de control de obra se cuentan junto con las novedades
const COMO_NOVEDAD = ['ensayo', 'sst', 'avance'];

const WEEK_DAYS = 7;

/* ============================================================================
   UTILIDADES
   ============================================================================ */
function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

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

function iconSpan(name) {
  const span = el('span', 'icon');
  span.dataset.icon = name;
  span.setAttribute('aria-hidden', 'true');
  return span;
}

/* ============================================================================
   CARGA DE DATOS
   ============================================================================ */
async function fetchUser() {
  try {
    const { data } = await supabase.auth.getUser();
    return data ? data.user : null;
  } catch (error) {
    console.error('Error al leer la cuenta:', error);
    return null;
  }
}

async function fetchProjects() {
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

async function fetchWeekEntries(projectId) {
  const since = startOfDay(new Date());
  since.setDate(since.getDate() - (WEEK_DAYS - 1));

  const { data, error } = await supabase
    .from('bitacora_entries')
    .select('id, type, created_at')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .gte('created_at', since.toISOString());

  if (error) {
    console.error('Error al cargar la actividad de la semana:', error);
    return [];
  }

  return data || [];
}

/* ============================================================================
   SALUDO Y CUENTA
   ============================================================================ */
function renderDate() {
  const dateEl = document.getElementById('hub-fecha');
  if (!dateEl) {
    return;
  }
  dateEl.textContent = new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function renderGreeting(user) {
  const fullName = user && user.user_metadata ? (user.user_metadata.full_name || '').trim() : '';
  const firstName = fullName.split(/\s+/)[0] || '';

  const saludo = document.getElementById('hub-saludo');
  if (saludo) {
    saludo.textContent = firstName ? `Hola, ${firstName},` : 'Hola,';
  }

  const initialsEl = document.getElementById('hub-account-initials');
  const iconEl = document.getElementById('hub-account-icon');
  const avatarUrl = user && user.user_metadata ? user.user_metadata.avatar_url : '';

  // Con foto de perfil (se sube en Mi perfil), se muestra la foto
  if (avatarUrl) {
    const trigger = document.getElementById('hub-account-trigger');
    if (trigger) {
      const img = document.createElement('img');
      img.src = avatarUrl;
      img.alt = '';
      img.className = 'hub-account-photo';
      img.addEventListener('error', () => img.remove());
      trigger.appendChild(img);
      if (initialsEl) initialsEl.hidden = true;
      if (iconEl) iconEl.hidden = true;
    }
    return;
  }

  if (fullName && initialsEl) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    const initials = (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
    initialsEl.textContent = initials;
    initialsEl.hidden = false;
    if (iconEl) {
      iconEl.hidden = true;
    }
  }
}

/* ============================================================================
   PROYECTO ACTUAL
   ============================================================================ */
function formatProjectMeta(project) {
  const location = project.location ? project.location.trim() : '';
  const referenceDate = project.updated_at || project.created_at;
  const dateLabel = referenceDate ? formatDisplayDate(new Date(referenceDate)) : '';

  if (location && dateLabel) {
    return `${location} · Actualizado el ${dateLabel}`;
  }
  return location || (dateLabel ? `Actualizado el ${dateLabel}` : 'Sin información adicional');
}

function renderCurrentProject(project) {
  setCurrentProjectId(project.id);

  const heading = document.getElementById('dashboard-proyecto-nombre');
  const meta = document.getElementById('dashboard-proyecto-meta');
  if (heading) {
    heading.textContent = project.name;
  }
  if (meta) {
    meta.textContent = formatProjectMeta(project);
  }

  document.title = `Inicio — ${project.name} — B-Civil`;

  const continuarLink = document.getElementById('link-continuar-trabajando');
  if (continuarLink) {
    continuarLink.href = `proyectos/proyecto.html?id=${project.id}`;
  }

  const bitacoraDestino = `bitacora/bitacora.html?project_id=${project.id}`;
  ['link-ver-bitacora-completa', 'hub-nav-bitacora'].forEach((id) => {
    const link = document.getElementById(id);
    if (link) {
      link.href = bitacoraDestino;
    }
  });

  return bitacoraDestino;
}

/* ============================================================================
   SEMANA: total, histograma por día y desglose por tipo
   ============================================================================ */
function renderWeek(entries) {
  const today = startOfDay(new Date());
  const days = [];

  for (let i = WEEK_DAYS - 1; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    days.push({ date, key: dayKey(date), count: 0 });
  }

  const byKey = new Map(days.map((d) => [d.key, d]));
  const byType = { texto: 0, fotografia: 0, 'nota-voz': 0 };

  entries.forEach((entry) => {
    const day = byKey.get(dayKey(entry.created_at));
    if (day) {
      day.count += 1;
    }
    const bucket = COMO_NOVEDAD.includes(entry.type) ? 'texto' : entry.type;
    if (bucket in byType) {
      byType[bucket] += 1;
    }
  });

  const total = days.reduce((sum, d) => sum + d.count, 0);
  const max = Math.max(...days.map((d) => d.count), 1);
  const todayCount = days[days.length - 1].count;

  // Total
  const totalEl = document.getElementById('hub-semana-total');
  if (totalEl) {
    totalEl.textContent = String(total);
  }

  // Estado de hoy
  const todayEl = document.getElementById('hub-hoy-estado');
  if (todayEl) {
    if (todayCount > 0) {
      todayEl.textContent = `Hoy: ${plural(todayCount, 'registro', 'registros')}`;
      todayEl.className = 'status-pill status-pill--progress hub-today';
    } else {
      todayEl.textContent = 'Sin registros hoy';
      todayEl.className = 'status-pill status-pill--plain hub-today';
    }
  }

  // Histograma
  const chart = document.getElementById('hub-semana-chart');
  if (chart) {
    chart.innerHTML = '';
    const resumen = [];

    days.forEach((day, index) => {
      const isToday = index === days.length - 1;
      const col = el('div', 'histogram-col');
      const bar = el('div', 'histogram-bar');
      bar.style.setProperty('--h', String(Math.round((day.count / max) * 100)));
      bar.style.animationDelay = `${index * 0.04}s`;
      if (day.count === 0) {
        bar.classList.add('is-empty');
      }
      if (isToday && day.count > 0) {
        bar.classList.add('is-current');
      }
      bar.title = plural(day.count, 'registro', 'registros');

      const weekday = day.date.toLocaleDateString('es-CO', { weekday: 'short' }).replace('.', '');
      const label = el('span', 'histogram-label', isToday ? 'Hoy' : weekday.slice(0, 3));
      if (isToday) {
        label.classList.add('is-current');
      }

      col.appendChild(bar);
      col.appendChild(label);
      chart.appendChild(col);

      resumen.push(`${isToday ? 'hoy' : weekday} ${day.count}`);
    });

    chart.setAttribute('aria-label', `Registros por día: ${resumen.join(', ')}`);
  }

  // Desglose por tipo
  const typeTargets = [
    ['texto', 'hub-semana-novedades', 'hub-bar-novedades'],
    ['fotografia', 'hub-semana-fotos', 'hub-bar-fotos'],
    ['nota-voz', 'hub-semana-voz', 'hub-bar-voz'],
  ];

  typeTargets.forEach(([type, numberId, barId]) => {
    const numberEl = document.getElementById(numberId);
    const barEl = document.getElementById(barId);
    const count = byType[type];
    if (numberEl) {
      numberEl.textContent = String(count);
    }
    if (barEl) {
      const share = total ? Math.round((count / total) * 100) : 0;
      barEl.style.setProperty('--value', String(share));
      barEl.title = total ? `${share} % de los registros de la semana` : 'Sin registros esta semana';
    }
  });
}

/* ============================================================================
   ÚLTIMOS REGISTROS
   ============================================================================ */
function renderActivity(entries, bitacoraHref) {
  const list = document.getElementById('activity-list');
  const emptyMessage = document.getElementById('activity-empty-message');
  if (!list) {
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

  entries.forEach((entry) => {
    const info = TYPE_INFO[entry.type] || { label: entry.type, icon: 'bitacora' };
    const createdAt = new Date(entry.created_at);

    const li = el('li', 'activity-item');
    const link = el('a', 'list-row');
    link.href = bitacoraHref;

    const badge = el('span', 'icon-badge');
    badge.style.backgroundColor = 'var(--color-surface)';
    badge.appendChild(iconSpan(info.icon));

    const body = el('span', 'list-row-body');
    const content = (entry.content || '').trim();
    body.appendChild(el('span', 'list-row-title', content || info.label));
    body.appendChild(
      el('span', 'list-row-meta', `${info.label} · ${formatDisplayDate(createdAt)}, ${formatDisplayTime(createdAt)}`)
    );

    const arrow = el('span', 'icon-btn icon-btn--sm');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.appendChild(iconSpan('flecha'));

    link.appendChild(badge);
    link.appendChild(body);
    link.appendChild(arrow);
    li.appendChild(link);
    list.appendChild(li);
  });
}

/* ============================================================================
   OTROS PROYECTOS
   ============================================================================ */
function renderOtherProjects(projects) {
  const list = document.getElementById('other-projects-list');
  const emptyMessage = document.getElementById('other-projects-empty-message');
  if (!list) {
    return;
  }

  list.innerHTML = '';

  if (!projects.length) {
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

  projects.slice(0, 4).forEach((project) => {
    const li = el('li', 'project-card');
    const link = el('a', 'list-row');
    link.href = `proyectos/proyecto.html?id=${project.id}`;

    const badge = el('span', 'icon-badge');
    badge.appendChild(iconSpan('proyectos'));

    const body = el('span', 'list-row-body');
    body.appendChild(el('span', 'list-row-title', project.name));
    body.appendChild(el('span', 'list-row-meta', formatProjectMeta(project)));

    const arrow = el('span', 'icon-btn icon-btn--sm');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.appendChild(iconSpan('flecha'));

    link.appendChild(badge);
    link.appendChild(body);
    link.appendChild(arrow);
    li.appendChild(link);
    list.appendChild(li);
  });
}

/* ============================================================================
   ESTADOS DE LA PÁGINA
   ============================================================================ */
function showContent() {
  const contenido = document.getElementById('dashboard-contenido');
  const emptyState = document.getElementById('dashboard-empty-state');
  if (contenido) {
    contenido.hidden = false;
  }
  if (emptyState) {
    emptyState.hidden = true;
  }
}

function showEmptyState() {
  const contenido = document.getElementById('dashboard-contenido');
  const emptyState = document.getElementById('dashboard-empty-state');
  if (contenido) {
    contenido.hidden = true;
  }
  if (emptyState) {
    emptyState.hidden = false;
  }
}

/* ============================================================================
   INICIALIZACIÓN
   ============================================================================ */
async function init() {
  if (!document.getElementById('dashboard-contenido')) {
    return;
  }

  renderDate();

  const [user, projects] = await Promise.all([fetchUser(), fetchProjects()]);
  renderGreeting(user);

  if (!projects.length) {
    showEmptyState();
    return;
  }

  showContent();

  const [currentProject] = projects;
  const bitacoraHref = renderCurrentProject(currentProject);
  renderOtherProjects(projects.slice(1));

  const [weekEntries, recentEntries] = await Promise.all([
    fetchWeekEntries(currentProject.id),
    fetchRecentEntries(currentProject.id),
  ]);

  renderWeek(weekEntries);
  renderActivity(recentEntries, bitacoraHref);
}

document.addEventListener('DOMContentLoaded', init);