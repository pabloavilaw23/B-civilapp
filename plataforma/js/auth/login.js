/**
 * login.js
 * Inicio de sesión real mediante Supabase Auth.
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

// Carga el flujo visual de recuperación de contraseña.
// Todavía revisaremos y conectaremos este módulo posteriormente.
import './recuperar-password.js';

function validateLoginForm(form) {
  let isValid = true;

  const emailInput = form.querySelector('#login-email');
  const passwordInput = form.querySelector('#login-password');

  clearFieldError(emailInput);
  clearFieldError(passwordInput);

  if (!emailInput.value.trim()) {
    setFieldError(emailInput, 'Ingresa tu correo electrónico.');
    isValid = false;
  } else if (!isValidEmail(emailInput.value)) {
    setFieldError(
      emailInput,
      'Ingresa un correo electrónico válido.'
    );
    isValid = false;
  }

  if (!passwordInput.value) {
    setFieldError(
      passwordInput,
      'Ingresa tu contraseña.'
    );
    isValid = false;
  }

  return isValid;
}

async function requestLogin(form, credentials) {
  const submitButton = form.querySelector('button[type="submit"]');

  try {
    if (submitButton) {
      submitButton.disabled = true;
    }

    setFormStatus(
      form,
      'Iniciando sesión...',
      'info'
    );

    const { data, error } = await supabase.auth.signInWithPassword({
      email: credentials.email,
      password: credentials.password
    });

    if (error) {
      throw error;
    }

    if (!data.session || !data.user) {
      throw new Error(
        'No fue posible iniciar la sesión.'
      );
    }

    setFormStatus(
      form,
      'Inicio de sesión correcto. Redirigiendo...',
      'success'
    );

    window.location.href = './app/dashboard.html';

  } catch (error) {
    console.error(
      'Error al iniciar sesión:',
      error
    );

    let message = 'No fue posible iniciar sesión. Verifica tus datos e inténtalo nuevamente.';

    if (error.message === 'Invalid login credentials') {
      message = 'El correo electrónico o la contraseña son incorrectos.';
    }

    if (error.message === 'Email not confirmed') {
      message = 'Debes confirmar tu correo electrónico antes de iniciar sesión.';
    }

    setFormStatus(
      form,
      message,
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

  if (!validateLoginForm(form)) {
    setFormStatus(
      form,
      'Revisa los campos marcados antes de continuar.',
      'error'
    );
    return;
  }

  await requestLogin(form, {
    email: form.querySelector('#login-email').value.trim(),
    password: form.querySelector('#login-password').value
  });
}

function init() {
  const form = document.getElementById('login-form');

  if (!form) {
    return;
  }

  initPasswordToggles(form);

  form.addEventListener(
    'submit',
    handleSubmit
  );

  [
    '#login-email',
    '#login-password'
  ].forEach((selector) => {
    const input = form.querySelector(selector);

    if (input) {
      input.addEventListener(
        'input',
        () => clearFieldError(input)
      );
    }
  });
}

document.addEventListener(
  'DOMContentLoaded',
  init
);