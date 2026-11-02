/**
 * multimedia.js
 * Utilidades de captura multimedia reutilizables por el flujo de
 * registro rápido (js/bitacora/registro.js): selección visual de
 * fotografías con vista previa local, e interfaz de grabación de
 * audio cuando el navegador lo permite.
 *
 * No sube ningún archivo a un servidor. No transcribe audio. No
 * conecta con Supabase ni con ningún backend.
 */

const MAX_PHOTOS = 6;

/**
 * Construye un campo de selección de fotografías con vista previa
 * local generada en el propio navegador (URL.createObjectURL), sin
 * subir nada. Cada fotografía seleccionada puede quitarse antes de
 * guardar.
 * @returns {{element: HTMLElement, getFiles: () => File[], reset: () => void}}
 */
export function createPhotoField() {
  const wrapper = document.createElement('div');
  wrapper.className = 'capture-photo-field';

  const triggerRow = document.createElement('div');
  triggerRow.className = 'capture-photo-triggers';

  const cameraTrigger = document.createElement('button');
  cameraTrigger.type = 'button';
  cameraTrigger.className = 'btn btn-secondary';
  cameraTrigger.textContent = 'Tomar foto';

  const galleryTrigger = document.createElement('button');
  galleryTrigger.type = 'button';
  galleryTrigger.className = 'btn btn-secondary';
  galleryTrigger.textContent = 'Elegir de galería';

  const hint = document.createElement('p');
  hint.className = 'capture-field-hint';
  hint.textContent = `Selecciona hasta ${MAX_PHOTOS} fotografías. No se suben a ningún servidor hasta guardar.`;

  const cameraInput = document.createElement('input');
  cameraInput.type = 'file';
  cameraInput.accept = 'image/*';
  cameraInput.capture = 'environment';
  cameraInput.className = 'visually-hidden';
  cameraInput.setAttribute('aria-label', 'Tomar fotografía con la cámara');

  const galleryInput = document.createElement('input');
  galleryInput.type = 'file';
  galleryInput.accept = 'image/*';
  galleryInput.multiple = true;
  galleryInput.className = 'visually-hidden';
  galleryInput.setAttribute('aria-label', 'Elegir fotografías de la galería');

  const previewList = document.createElement('ul');
  previewList.className = 'capture-photo-preview';
  previewList.setAttribute('role', 'list');

  let files = [];
  let objectUrls = [];

  function revokeUrls() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];
  }

  function renderPreview() {
    previewList.innerHTML = '';
    revokeUrls();

    files.forEach((file, index) => {
      const url = URL.createObjectURL(file);
      objectUrls.push(url);

      const item = document.createElement('li');
      item.className = 'capture-photo-thumb';

      const img = document.createElement('img');
      img.src = url;
      img.alt = `Vista previa local ${index + 1}`;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'capture-photo-remove';
      removeBtn.setAttribute('aria-label', `Quitar fotografía ${index + 1}`);
      removeBtn.addEventListener('click', () => {
        files = files.filter((_, i) => i !== index);
        renderPreview();
      });

      item.appendChild(img);
      item.appendChild(removeBtn);
      previewList.appendChild(item);
    });

    hint.textContent = files.length
      ? `${files.length} de ${MAX_PHOTOS} fotografías seleccionadas.`
      : `Selecciona hasta ${MAX_PHOTOS} fotografías. No se suben a ningún servidor hasta guardar.`;
  }

  function handleNewFiles(input) {
    const selected = Array.from(input.files || []);
    files = files.concat(selected).slice(0, MAX_PHOTOS);
    renderPreview();
    input.value = '';
  }

  cameraInput.addEventListener('change', () => handleNewFiles(cameraInput));
  galleryInput.addEventListener('change', () => handleNewFiles(galleryInput));

  cameraTrigger.addEventListener('click', () => cameraInput.click());
  galleryTrigger.addEventListener('click', () => galleryInput.click());

  triggerRow.appendChild(cameraTrigger);
  triggerRow.appendChild(galleryTrigger);

  wrapper.appendChild(triggerRow);
  wrapper.appendChild(hint);
  wrapper.appendChild(cameraInput);
  wrapper.appendChild(galleryInput);
  wrapper.appendChild(previewList);

  return {
    element: wrapper,
    getFiles: () => files.slice(),
    reset: () => {
      files = [];
      revokeUrls();
      previewList.innerHTML = '';
      hint.textContent = `Selecciona hasta ${MAX_PHOTOS} fotografías. No se suben a ningún servidor hasta guardar.`;
    },
  };
}

/**
 * Construye una interfaz de grabación de audio usando la API nativa
 * MediaRecorder cuando el navegador la permite. Si no está disponible,
 * muestra un mensaje claro en lugar de fallar. Incluye vista previa
 * local de la grabación y permite cancelar o repetir la captura.
 * @returns {{
 *   element: HTMLElement,
 *   isSupported: boolean,
 *   getBlob: () => Blob|null,
 *   getDurationLabel: () => string,
 *   reset: () => void
 * }}
 */
export function createAudioField({ autoStart = false } = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'capture-audio-field';

  const supportsRecording = Boolean(
    navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function'
    && typeof window.MediaRecorder === 'function',
  );

  if (!supportsRecording) {
    const message = document.createElement('p');
    message.className = 'capture-field-hint';
    message.textContent = 'La grabación de audio no está disponible en este navegador.';
    wrapper.appendChild(message);

    return {
      element: wrapper,
      isSupported: false,
      getBlob: () => null,
      getDurationLabel: () => '0:00',
      reset: () => {},
    };
  }

  const recordBtn = document.createElement('button');
  recordBtn.type = 'button';
  recordBtn.className = 'btn btn-secondary';
  recordBtn.textContent = 'Empezar grabación';

  const status = document.createElement('p');
  status.className = 'capture-field-hint';
  status.setAttribute('role', 'status');
  status.textContent = '';

  const previewWrapper = document.createElement('div');
  previewWrapper.className = 'capture-audio-preview';
  previewWrapper.hidden = true;

  let mediaRecorder = null;
  let mediaStream = null;
  let chunks = [];
  let startedAt = 0;
  let timerId = null;
  let recordedBlob = null;
  let objectUrl = null;
  let durationLabel = '0:00';

  function formatDuration(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function stopStream() {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
  }

  function clearTimer() {
    if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  function revokePreview() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function renderPreview() {
    previewWrapper.innerHTML = '';

    if (!recordedBlob) {
      previewWrapper.hidden = true;
      return;
    }

    objectUrl = URL.createObjectURL(recordedBlob);

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = objectUrl;

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'link-secondary';
    retryBtn.textContent = 'Grabar de nuevo';
    retryBtn.addEventListener('click', () => {
      recordedBlob = null;
      durationLabel = '0:00';
      revokePreview();
      renderPreview();
      status.textContent = '';
      recordBtn.hidden = false;
    });

    previewWrapper.appendChild(audio);
    previewWrapper.appendChild(retryBtn);
    previewWrapper.hidden = false;
  }

  function getBestSupportedMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/aac',
      'audio/ogg;codecs=opus',
    ];
    if (typeof MediaRecorder.isTypeSupported !== 'function') {
      return '';
    }
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  async function startRecording() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      status.textContent = 'No se pudo acceder al micrófono. Verifica los permisos del navegador.';
      return;
    }

    mediaStream = stream;
    chunks = [];
    const mimeType = getBestSupportedMimeType();

    try {
      mediaRecorder = mimeType
        ? new MediaRecorder(mediaStream, { mimeType })
        : new MediaRecorder(mediaStream);
    } catch (error) {
      mediaRecorder = new MediaRecorder(mediaStream);
    }

    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener('stop', () => {
      const finalType = mediaRecorder.mimeType || mimeType || 'audio/webm';
      recordedBlob = chunks.length ? new Blob(chunks, { type: finalType }) : null;
      durationLabel = formatDuration((Date.now() - startedAt) / 1000);
      stopStream();
      clearTimer();
      renderPreview();
      recordBtn.hidden = Boolean(recordedBlob);
      if (!recordedBlob) {
        status.textContent = 'No se registró audio. Intenta grabar de nuevo.';
      }
    });

    mediaRecorder.start();
    startedAt = Date.now();
    status.textContent = 'Grabando… 0:00';
    recordBtn.textContent = 'Detener grabación';
    recordBtn.classList.add('is-recording');

    timerId = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      status.textContent = `Grabando… ${formatDuration(elapsed)}`;
    }, 250);
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    recordBtn.textContent = 'Empezar grabación';
    recordBtn.classList.remove('is-recording');
  }

  recordBtn.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      stopRecording();
    } else {
      startRecording();
    }
  });

  wrapper.appendChild(recordBtn);
  wrapper.appendChild(status);
  wrapper.appendChild(previewWrapper);

  if (autoStart) {
    startRecording();
  }

  return {
    element: wrapper,
    isSupported: true,
    getBlob: () => recordedBlob,
    getDurationLabel: () => durationLabel,
    reset: () => {
      clearTimer();
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        try {
          mediaRecorder.stop();
        } catch (error) {
          /* La grabación ya estaba detenida; no es necesario hacer nada. */
        }
      }
      stopStream();
      recordedBlob = null;
      durationLabel = '0:00';
      chunks = [];
      revokePreview();
      status.textContent = '';
      recordBtn.hidden = false;
      recordBtn.textContent = 'Empezar grabación';
      recordBtn.classList.remove('is-recording');
      previewWrapper.hidden = true;
      previewWrapper.innerHTML = '';
    },
  };
}