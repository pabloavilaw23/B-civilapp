/**
 * app.js
 * Utilidades compartidas por los formularios de autenticación
 * (index.html y registro.html).
 *
 * La navegación móvil, el resaltado de secciones y la elevación de
 * cabecera de la antigua landing se eliminaron junto con ella. La
 * elevación de cabecera en las pantallas de acceso la maneja
 * js/auth-header-elevation.js.
 *
 * Las validaciones de formulario compartidas viven en
 * js/utils/validaciones.js.
 */

/**
 * Habilita los botones "Mostrar/Ocultar contraseña" presentes en el
 * contenedor indicado. Cada botón debe declarar aria-controls apuntando
 * al id del input de contraseña correspondiente.
 * @param {ParentNode} root
 */
export function initPasswordToggles(root = document) {
  const toggles = root.querySelectorAll('.toggle-password');

  toggles.forEach((button) => {
    const targetId = button.getAttribute('aria-controls');
    const input = targetId ? document.getElementById(targetId) : null;

    if (!input) {
      return;
    }

    button.addEventListener('click', () => {
      const isCurrentlyVisible = input.type === 'text';
      input.type = isCurrentlyVisible ? 'password' : 'text';
      button.setAttribute('aria-pressed', String(!isCurrentlyVisible));
      button.textContent = isCurrentlyVisible ? 'Mostrar contraseña' : 'Ocultar contraseña';
    });
  });
}