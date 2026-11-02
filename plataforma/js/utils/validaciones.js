/**
 * validaciones.js
 * Validaciones de formulario reutilizables y utilidades para mostrar
 * mensajes de error/estado accesibles bajo un campo o al inicio de un
 * formulario.
 *
 * Las usan los formularios de autenticación, el formulario de creación
 * de proyecto y el flujo de registro rápido de la bitácora.
 *
 * Cambio respecto a la versión anterior (compatible hacia atrás):
 * setFormStatus añade la clase .form-status-info | -error | -success
 * según el tono, para que cada pantalla pueda darle su propio estilo.
 * Los estilos en línea se conservan para que las páginas que no tienen
 * CSS propio para estos mensajes se sigan viendo igual.
 */

const STATUS_TONES = ['info', 'error', 'success'];

/**
 * Valida el formato básico de un correo electrónico.
 * @param {string} value
 * @returns {boolean}
 */
export function isValidEmail(value) {
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return pattern.test(String(value).trim());
}

function getFieldWrapper(inputEl) {
  return inputEl.closest('.form-field');
}

/**
 * Muestra un mensaje de error visual y accesible bajo un campo.
 * @param {HTMLInputElement} inputEl
 * @param {string} message
 */
export function setFieldError(inputEl, message) {
  const wrapper = getFieldWrapper(inputEl);
  if (!wrapper) {
    return;
  }

  inputEl.setAttribute('aria-invalid', 'true');

  let errorEl = wrapper.querySelector('.field-error');
  if (!errorEl) {
    errorEl = document.createElement('p');
    errorEl.className = 'field-error';
    errorEl.id = `${inputEl.id}-error`;
    errorEl.setAttribute('role', 'alert');
    errorEl.style.fontSize = 'var(--text-xs)';
    errorEl.style.color = 'var(--color-danger)';
    errorEl.style.marginTop = 'var(--space-1)';
    wrapper.appendChild(errorEl);
  }

  errorEl.textContent = message;
  inputEl.setAttribute('aria-describedby', errorEl.id);
}

/**
 * Elimina el mensaje de error visual de un campo, si existe.
 * @param {HTMLInputElement} inputEl
 */
export function clearFieldError(inputEl) {
  if (!inputEl) {
    return;
  }

  inputEl.removeAttribute('aria-invalid');
  inputEl.removeAttribute('aria-describedby');

  const wrapper = getFieldWrapper(inputEl);
  if (!wrapper) {
    return;
  }

  const errorEl = wrapper.querySelector('.field-error');
  if (errorEl) {
    errorEl.remove();
  }
}

/**
 * Muestra un mensaje de estado general del formulario, insertado al
 * inicio del formulario.
 * @param {HTMLFormElement} formEl
 * @param {string} message
 * @param {'info'|'error'|'success'} tone
 */
export function setFormStatus(formEl, message, tone = 'info') {
  const safeTone = STATUS_TONES.includes(tone) ? tone : 'info';
  let statusEl = formEl.querySelector('.form-status');

  if (!statusEl) {
    statusEl = document.createElement('p');
    statusEl.className = 'form-status';
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    statusEl.style.fontSize = 'var(--text-sm)';
    statusEl.style.marginBottom = 'var(--space-4)';
    formEl.insertBefore(statusEl, formEl.firstElementChild);
  }

  STATUS_TONES.forEach((t) => statusEl.classList.remove(`form-status-${t}`));
  statusEl.classList.add(`form-status-${safeTone}`);

  statusEl.textContent = message;
  statusEl.style.color = safeTone === 'error' ? 'var(--color-danger)' : 'var(--color-ink-soft)';
}

/**
 * Elimina el mensaje de estado general del formulario, si existe.
 * @param {HTMLFormElement} formEl
 */
export function clearFormStatus(formEl) {
  const statusEl = formEl.querySelector('.form-status');
  if (statusEl) {
    statusEl.remove();
  }
}