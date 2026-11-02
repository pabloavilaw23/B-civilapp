/**
 * alertas.js
 * Ventana de confirmación compartida para acciones que requieren una
 * decisión explícita (archivar, eliminar...). La usan proyecto.js,
 * timeline.js, configuracion.js y papelera.js.
 *
 * Cambios de la versión de rediseño (la API no cambia):
 *  - Si la acción es destructiva (confirmClassName contiene
 *    "danger"), se muestra un ícono de advertencia en rojo arriba del
 *    título, para distinguirla de un vistazo.
 *  - Clase "modal-dialog--confirm" para darle un ancho más compacto
 *    en pantallas grandes (en el teléfono sigue siendo hoja inferior).
 *
 * El aviso breve (announce) vive en app-shell.js.
 */

/**
 * Muestra una ventana modal de confirmación y resuelve con "true" si
 * la persona confirma, o "false" si cancela, cierra la ventana o
 * presiona Escape.
 * @param {{
 *   titleText: string,
 *   message: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   confirmClassName?: string,
 *   restoreFocusTo?: HTMLElement|null
 * }} options
 * @returns {Promise<boolean>}
 */
export function confirmDialog({
  titleText,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  confirmClassName = 'btn btn-primary',
  restoreFocusTo = null,
}) {
  return new Promise((resolve) => {
    let settled = false;
    const isDanger = /danger/.test(confirmClassName);

    function handleKeydown(event) {
      if (event.key === 'Escape') {
        finish(false);
      }
    }

    function finish(result) {
      if (settled) {
        return;
      }
      settled = true;
      document.removeEventListener('keydown', handleKeydown);
      overlay.remove();
      if (restoreFocusTo && restoreFocusTo.isConnected) {
        restoreFocusTo.focus();
      }
      resolve(result);
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-dialog--confirm';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');

    const titleId = `confirm-dialog-titulo-${Math.random().toString(36).slice(2, 8)}`;
    const messageId = `${titleId}-mensaje`;
    dialog.setAttribute('aria-labelledby', titleId);
    dialog.setAttribute('aria-describedby', messageId);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-close';
    closeBtn.setAttribute('aria-label', 'Cerrar');
    closeBtn.textContent = 'Cerrar';
    closeBtn.addEventListener('click', () => finish(false));

    if (isDanger) {
      const icon = document.createElement('span');
      icon.className = 'confirm-icon confirm-icon--danger';
      icon.setAttribute('aria-hidden', 'true');
      dialog.appendChild(icon);
    }

    const heading = document.createElement('h2');
    heading.id = titleId;
    heading.className = 'modal-title';
    heading.textContent = titleText;

    const messageEl = document.createElement('p');
    messageEl.id = messageId;
    messageEl.className = 'modal-subtitle';
    messageEl.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = confirmClassName;
    confirmBtn.textContent = confirmLabel;
    confirmBtn.addEventListener('click', () => finish(true));

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = cancelLabel;
    cancelBtn.addEventListener('click', () => finish(false));

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);

    dialog.appendChild(closeBtn);
    dialog.appendChild(heading);
    dialog.appendChild(messageEl);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        finish(false);
      }
    });

    document.body.appendChild(overlay);
    document.addEventListener('keydown', handleKeydown);
    cancelBtn.focus();
  });
}