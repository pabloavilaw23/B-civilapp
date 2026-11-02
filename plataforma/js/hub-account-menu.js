/**
 * hub-account-menu.js
 * Menú de cuenta del Dashboard: despliega Perfil, Configuración,
 * Papelera y Soporte — las páginas/acciones que se quedaron sin
 * acceso visible cuando se quitó el menú lateral clásico del resto
 * de la app.
 */

const OPCIONES = [
  { label: 'Perfil', href: 'perfil.html' },
  { label: 'Configuración', href: 'configuracion.html' },
  { label: 'Papelera', href: 'papelera/papelera.html' },
  {
    label: 'Soporte',
    href: 'https://wa.me/573003716104?text=Hola%2C%20necesito%20ayuda%20con%20la%20plataforma%20B-Civil',
    external: true,
  },
];

function closeMenu(wrapper, trigger) {
  const list = wrapper.querySelector('.context-menu-list');
  if (list) {
    list.remove();
  }
  trigger.setAttribute('aria-expanded', 'false');
}

function openMenu(wrapper, trigger) {
  const list = document.createElement('ul');
  list.className = 'context-menu-list';
  list.setAttribute('role', 'list');

  OPCIONES.forEach(({ label, href, external }) => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'context-menu-item';
    link.href = href;
    link.textContent = label;
    if (external) {
      link.target = '_blank';
      link.rel = 'noopener';
    }
    li.appendChild(link);
    list.appendChild(li);
  });

  wrapper.appendChild(list);
  trigger.setAttribute('aria-expanded', 'true');
  const firstLink = list.querySelector('a');
  if (firstLink) {
    firstLink.focus();
  }
}

function init() {
  const wrapper = document.getElementById('hub-account-menu');
  const trigger = document.getElementById('hub-account-trigger');
  if (!wrapper || !trigger) {
    return;
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = trigger.getAttribute('aria-expanded') === 'true';
    if (isOpen) {
      closeMenu(wrapper, trigger);
    } else {
      openMenu(wrapper, trigger);
    }
  });

  document.addEventListener('click', (event) => {
    if (!wrapper.contains(event.target)) {
      closeMenu(wrapper, trigger);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
      closeMenu(wrapper, trigger);
      trigger.focus();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);