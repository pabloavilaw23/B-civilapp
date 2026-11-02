/**
 * recuperar-password.js
 * Flujo visual de recuperación de contraseña, presentado como panel
 * dentro de la pantalla de acceso (index.html). No crea una página nueva.
 *
 * No envía correos reales. No conecta con Supabase todavía.
 * Este módulo se autoinicializa: basta con importarlo para que quede
 * activo (ver js/auth/login.js).
 *
 * Cambio respecto a la versión anterior: los estilos en línea se
 * reemplazaron por clases (.auth-dialog-overlay, .auth-dialog,
 * .auth-dialog-close, .auth-dialog-message), definidas en css/auth.css.
 * El comportamiento (abrir, cerrar, Escape, foco atrapado, validación)
 * es el mismo.
 */

import { isValidEmail, setFieldError, clearFieldError } from '../utils/validaciones.js';

let overlayEl = null;
let triggerEl = null;

function handleKeydown(event) {
  if (event.key === 'Escape') {
    closePanel();
  }

  if (event.key === 'Tab' && overlayEl) {
    trapFocus(event);
  }
}

function trapFocus(event) {
  const focusable = overlayEl.querySelectorAll('button, input, a[href]');
  if (!focusable.length) {
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function closePanel() {
  if (!overlayEl) {
    return;
  }

  overlayEl.remove();
  overlayEl = null;
  document.removeEventListener('keydown', handleKeydown);

  if (triggerEl) {
    triggerEl.setAttribute('aria-expanded', 'false');
    triggerEl.focus();
  }
}

function buildField() {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';

  const label = document.createElement('label');
  label.setAttribute('for', 'recuperar-email');
  label.textContent = 'Correo electrónico';

  const input = document.createElement('input');
  input.type = 'email';
  input.id = 'recuperar-email';
  input.name = 'email';
  input.autocomplete = 'email';
  input.inputMode = 'email';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'off');
  input.required = true;
  input.setAttribute('aria-required', 'true');

  // Si la persona ya escribió su correo en el acceso, se reutiliza
  const loginEmail = document.getElementById('login-email');
  if (loginEmail && loginEmail.value.trim()) {
    input.value = loginEmail.value.trim();
  }

  wrapper.appendChild(label);
  wrapper.appendChild(input);

  return { wrapper, input };
}

function buildConfirmation(email) {
  const message = document.createElement('p');
  message.className = 'auth-dialog-message';
  message.setAttribute('role', 'status');
  message.textContent =
    `Cuando esta función esté conectada, si ${email} corresponde a una cuenta registrada, ` +
    'recibirás allí las instrucciones para restablecer tu contraseña.';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-secondary btn-block';
  closeBtn.textContent = 'Cerrar';
  closeBtn.addEventListener('click', closePanel);

  return { message, closeBtn };
}

function buildPanel() {
  const overlay = document.createElement('div');
  overlay.className = 'auth-dialog-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'auth-card auth-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'recuperar-titulo');

  const closeCorner = document.createElement('button');
  closeCorner.type = 'button';
  closeCorner.className = 'auth-dialog-close';
  closeCorner.setAttribute('aria-label', 'Cerrar');
  closeCorner.textContent = 'Cerrar';
  closeCorner.addEventListener('click', closePanel);

  const heading = document.createElement('h2');
  heading.id = 'recuperar-titulo';
  heading.textContent = 'Recuperar contraseña';

  const description = document.createElement('p');
  description.className = 'auth-subtitle';
  description.textContent = 'Ingresa el correo asociado a tu cuenta para solicitar instrucciones de recuperación.';

  const form = document.createElement('form');
  form.className = 'auth-form';
  form.noValidate = true;

  const { wrapper: fieldWrapper, input: emailInput } = buildField();

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'btn btn-primary btn-block';
  submitBtn.textContent = 'Enviar instrucciones';

  form.appendChild(fieldWrapper);
  form.appendChild(submitBtn);

  emailInput.addEventListener('input', () => clearFieldError(emailInput));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldError(emailInput);

    if (!emailInput.value.trim()) {
      setFieldError(emailInput, 'Ingresa tu correo electrónico.');
      return;
    }

    if (!isValidEmail(emailInput.value)) {
      setFieldError(emailInput, 'Ingresa un correo electrónico válido.');
      return;
    }

    // No se envía ningún correo real todavía.
    // TODO (etapa futura): conectar con supabase.auth.resetPasswordForEmail.
    const { message, closeBtn } = buildConfirmation(emailInput.value.trim());
    dialog.removeChild(form);
    dialog.appendChild(message);
    dialog.appendChild(closeBtn);
    closeBtn.focus();
  });

  dialog.appendChild(closeCorner);
  dialog.appendChild(heading);
  dialog.appendChild(description);
  dialog.appendChild(form);

  overlay.appendChild(dialog);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closePanel();
    }
  });

  return { overlay, emailInput };
}

function openPanel() {
  if (overlayEl) {
    return;
  }

  const { overlay, emailInput } = buildPanel();
  overlayEl = overlay;
  document.body.appendChild(overlay);
  document.addEventListener('keydown', handleKeydown);

  if (triggerEl) {
    triggerEl.setAttribute('aria-expanded', 'true');
  }

  emailInput.focus();
}

function init() {
  triggerEl = document.getElementById('link-recuperar-contrasena');
  if (!triggerEl) {
    return;
  }

  triggerEl.setAttribute('aria-haspopup', 'dialog');
  triggerEl.setAttribute('aria-expanded', 'false');

  triggerEl.addEventListener('click', (event) => {
    event.preventDefault();
    openPanel();
  });
}

document.addEventListener('DOMContentLoaded', init);