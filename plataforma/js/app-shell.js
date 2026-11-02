/**
 * app-shell.js
 * Comportamiento compartido de la app privada:
 *  - announce(): aviso flotante breve, reutilizado por todas las
 *    secciones (dashboard.js, timeline.js, registro-global.js...).
 *  - Estado activo de la navegación flotante.
 *
 * Cambios respecto a la versión anterior:
 *  - Se eliminó la lista de "secciones pendientes" (nav-bitacora,
 *    nav-documentos, nav-asistente, nav-perfil, nav-configuracion,
 *    nav-papelera, link-perfil-topbar) que bloqueaba esos enlaces con
 *    el aviso "disponible en una próxima etapa": todas existen ya.
 *  - El aviso flotante usa el estilo nuevo (píldora negra), queda por
 *    encima de la barra de navegación y también por encima de los
 *    modales, para que los mensajes de validación se vean siempre.
 *  - Se eliminó el comportamiento del botón #app-nav-toggle y del riel
 *    lateral: la navegación es ahora la barra flotante en todos los
 *    tamaños de pantalla.
 *
 * No conecta con Supabase ni con ningún backend.
 */

/* --------------------------------------------------------------------------
   AVISO FLOTANTE (TOAST)
   -------------------------------------------------------------------------- */
let toastEl = null;
let toastTimer = null;

function buildToast() {
  const el = document.createElement('div');
  el.className = 'app-toast';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');

  // Estilos en línea a propósito: el aviso debe verse bien incluso en
  // páginas que no cargan app-shell.css.
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    bottom: 'calc(var(--app-bottom-nav-height, 4rem) + var(--app-bottom-nav-margin, 0.875rem) * 2 + env(safe-area-inset-bottom, 0px))',
    transform: 'translate(-50%, 8px)',
    zIndex: '300',
    maxWidth: 'min(calc(100vw - 2rem), 26rem)',
    padding: '0.8rem 1.15rem',
    backgroundColor: 'var(--color-ink, #15161A)',
    color: '#FFFFFF',
    fontFamily: 'var(--font-body, sans-serif)',
    fontSize: 'var(--text-sm, 0.875rem)',
    fontWeight: '600',
    lineHeight: '1.4',
    textAlign: 'center',
    borderRadius: '18px',
    boxShadow: '0 16px 36px -12px rgba(21, 22, 26, 0.5)',
    opacity: '0',
    pointerEvents: 'none',
    transition: 'opacity 0.18s ease, transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
  });

  document.body.appendChild(el);
  return el;
}

/**
 * Muestra un mensaje breve en un aviso flotante.
 * @param {string} message
 */
export function announce(message) {
  if (!toastEl) {
    toastEl = buildToast();
  }

  toastEl.textContent = message;

  requestAnimationFrame(() => {
    toastEl.style.opacity = '1';
    toastEl.style.transform = 'translate(-50%, 0)';
  });

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    toastEl.style.opacity = '0';
    toastEl.style.transform = 'translate(-50%, 8px)';
  }, 3400);
}

/* --------------------------------------------------------------------------
   ESTADO ACTIVO DE NAVEGACIÓN
   Se marca el destino cuya ruta coincide con la página actual (los
   parámetros como ?project_id= no cuentan). Una página interna puede
   declarar a qué sección pertenece con <body data-nav-section="...">
   y el enlace correspondiente con data-section="...": así "Proyectos"
   queda marcado también dentro de un proyecto (proyecto.html).
   -------------------------------------------------------------------------- */
function initActiveNavState() {
  const links = document.querySelectorAll('.app-nav-link');
  if (!links.length) {
    return;
  }

  const section = document.body.dataset.navSection || '';

  links.forEach((link) => {
    if (link.getAttribute('href') === '#') {
      return;
    }

    let isCurrent = false;
    try {
      isCurrent = new URL(link.href, window.location.href).pathname === window.location.pathname;
    } catch (error) {
      isCurrent = false;
    }

    if (!isCurrent && section && link.dataset.section === section) {
      isCurrent = true;
    }

    link.classList.toggle('is-active', isCurrent);
    if (isCurrent) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function init() {
  initActiveNavState();
}

document.addEventListener('DOMContentLoaded', init);