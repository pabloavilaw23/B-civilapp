/**
 * registro.js
 * Registro real de usuarios mediante Supabase Auth.
 */

import { initPasswordToggles } from '../app.js';
import {
  isValidEmail,
  setFieldError,
  clearFieldError,
  setFormStatus,
  clearFormStatus
} from '../utils/validaciones.js';

import { supabase } from '../config/supabase.js';

const PASSWORD_MIN_LENGTH = 8;

function validateRegistroForm(form) {
  let isValid = true;

  const nombreInput = form.querySelector('#registro-nombre');
  const emailInput = form.querySelector('#registro-email');
  const passwordInput = form.querySelector('#registro-password');
  const confirmInput = form.querySelector('#registro-password-confirm');
  const codigoInput = form.querySelector('#registro-codigo');
  const terminosInput = form.querySelector('#registro-terminos');

  [nombreInput, emailInput, passwordInput, confirmInput, codigoInput].forEach(clearFieldError);

  if (!nombreInput.value.trim()) {
    setFieldError(nombreInput, 'Ingresa tu nombre completo.');
    isValid = false;
  } else if (nombreInput.value.trim().length < 2) {
    setFieldError(nombreInput, 'El nombre ingresado es demasiado corto.');
    isValid = false;
  }

  if (!emailInput.value.trim()) {
    setFieldError(emailInput, 'Ingresa tu correo electrónico.');
    isValid = false;
  } else if (!isValidEmail(emailInput.value)) {
    setFieldError(emailInput, 'Ingresa un correo electrónico válido.');
    isValid = false;
  }

  if (!passwordInput.value) {
    setFieldError(passwordInput, 'Ingresa una contraseña.');
    isValid = false;
  } else if (passwordInput.value.length < PASSWORD_MIN_LENGTH) {
    setFieldError(
      passwordInput,
      `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`
    );
    isValid = false;
  }

  if (!confirmInput.value) {
    setFieldError(confirmInput, 'Confirma tu contraseña.');
    isValid = false;
  } else if (passwordInput.value && confirmInput.value !== passwordInput.value) {
    setFieldError(confirmInput, 'Las contraseñas no coinciden.');
    isValid = false;
  }

  if (!codigoInput.value.trim()) {
    setFieldError(codigoInput, 'Ingresa tu código de invitación.');
    isValid = false;
  }

  if (!terminosInput.checked) {
    setFormStatus(
      form,
      'Debes aceptar los términos y condiciones y la política de privacidad para continuar.',
      'error'
    );
    isValid = false;
  }

  return isValid;
}

async function requestRegistro(form, datos) {
  const submitButton = form.querySelector('button[type="submit"]');

  try {
    if (submitButton) {
      submitButton.disabled = true;
    }

    setFormStatus(form, 'Creando tu cuenta...', 'info');

    const { data, error } = await supabase.auth.signUp({
      email: datos.email,
      password: datos.password,
      options: {
        data: {
          full_name: datos.nombre,
          // Lo valida el hook "Before User Created" de Supabase
          // (función public.validar_invitacion). Si el código no es
          // válido, Supabase no crea la cuenta y devuelve un error.
          codigo_invitacion: datos.codigo
        }
      }
    });

    if (error) {
      throw error;
    }

    if (data.user && !data.session) {
      setFormStatus(
        form,
        'Cuenta creada correctamente. Revisa tu correo electrónico para confirmar tu cuenta.',
        'success'
      );

      form.reset();
      return;
    }

    if (data.session) {
      setFormStatus(
        form,
        'Cuenta creada correctamente. Redirigiendo...',
        'success'
      );

      window.location.href = './app/dashboard.html';
    }

  } catch (error) {
    console.error('Error al crear la cuenta:', error);

    const mensaje = error.message || '';

    if (/invitaci/i.test(mensaje)) {
      const codigoInput = form.querySelector('#registro-codigo');
      setFieldError(codigoInput, 'El código de invitación no es válido, ya fue usado o venció.');
      setFormStatus(form, 'No fue posible crear la cuenta: revisa el código de invitación.', 'error');
      return;
    }

    setFormStatus(
      form,
      error.message || 'No fue posible crear la cuenta. Inténtalo nuevamente.',
      'error'
    );
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;

  clearFormStatus(form);

  if (!validateRegistroForm(form)) {
    if (!form.querySelector('.form-status')) {
      setFormStatus(
        form,
        'Revisa los campos marcados antes de continuar.',
        'error'
      );
    }
    return;
  }

  await requestRegistro(form, {
    nombre: form.querySelector('#registro-nombre').value.trim(),
    email: form.querySelector('#registro-email').value.trim(),
    password: form.querySelector('#registro-password').value,
    codigo: form.querySelector('#registro-codigo').value.trim().toUpperCase()
  });
}

function init() {
  const form = document.getElementById('registro-form');

  if (!form) {
    return;
  }

  initPasswordToggles(form);

  form.addEventListener('submit', handleSubmit);

  [
    '#registro-nombre',
    '#registro-email',
    '#registro-password',
    '#registro-password-confirm',
    '#registro-codigo'
  ].forEach((selector) => {
    const input = form.querySelector(selector);

    if (input) {
      input.addEventListener('input', () => clearFieldError(input));
    }
  });

  const terminosInput = form.querySelector('#registro-terminos');

  if (terminosInput) {
    terminosInput.addEventListener('change', () => clearFormStatus(form));
  }
}

document.addEventListener('DOMContentLoaded', init);