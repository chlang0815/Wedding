import { GALLERY_CONFIG } from "./gallery.config.js";

const API_BASE_URL = GALLERY_CONFIG.apiBaseUrl.replace(/\/$/, "");
const MAX_PHOTO_SELECTION = 100;
const MIME_BY_EXTENSION = Object.freeze({
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
});

const elements = Object.fromEntries(
  [
    "authView",
    "galleryView",
    "loginForm",
    "password",
    "loginMessage",
    "logoutButton",
    "photoInput",
    "uploadConsent",
    "uploadButton",
    "clearQueueButton",
    "uploadQueue",
    "overallProgress",
    "overallProgressLabel",
    "overallProgressValue",
    "overallProgressBar",
    "fileLimit",
    "retentionDate",
    "refreshButton",
    "galleryMessage",
    "selectionBar",
    "selectAllPhotosButton",
    "downloadSelectedButton",
    "clearSelectionButton",
    "photoGrid",
    "loadMoreButton",
    "lightbox",
    "lightboxClose",
    "lightboxCounter",
    "lightboxImage",
    "lightboxLoader",
    "lightboxStage",
    "previousPhoto",
    "nextPhoto",
    "downloadButton",
  ].map((id) => [id, document.getElementById(id)]),
);

const state = {
  csrfToken: null,
  queue: [],
  activeUploads: 0,
  photos: [],
  selectedPhotoIds: new Set(),
  loadingAllPhotos: false,
  nextCursor: null,
  lightboxIndex: -1,
  lightboxRequest: 0,
  maxUploadBytes: 25 * 1024 * 1024,
};

function getErrorMessage(payload, fallback) {
  if (typeof payload?.detail === "string") return payload.detail;
  if (Array.isArray(payload?.detail)) {
    return payload.detail.map((item) => item.msg).filter(Boolean).join(" ") || fallback;
  }
  return fallback;
}

async function apiFetch(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && state.csrfToken) {
    headers.set("X-CSRF-Token", state.csrfToken);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    method,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // A network intermediary may return a non-JSON error page.
    }
    const error = new Error(getErrorMessage(payload, "Die Anfrage ist fehlgeschlagen."));
    error.status = response.status;
    throw error;
  }

  return response;
}

async function apiRequest(path, options = {}) {
  const response = await apiFetch(path, options);
  if (response.status === 204) return null;
  return response.json();
}

function showAuthenticated(authenticated) {
  elements.authView.hidden = authenticated;
  elements.galleryView.hidden = !authenticated;
  if (!authenticated) {
    state.csrfToken = null;
    elements.password.focus();
  }
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getContentType(file) {
  if (file.type) return file.type.toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase();
  return MIME_BY_EXTENSION[extension] || "";
}

function validateFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const contentType = getContentType(file);
  if (!extension || !MIME_BY_EXTENSION[extension]) {
    return "Dateityp nicht unterstützt";
  }
  if (MIME_BY_EXTENSION[extension] !== contentType) {
    return "Dateiendung und Dateityp passen nicht zusammen";
  }
  if (file.size <= 0) return "Die Datei ist leer";
  if (file.size > state.maxUploadBytes) {
    return `Größer als ${formatBytes(state.maxUploadBytes)}`;
  }
  return null;
}

function makeQueueItem(file) {
  const validationError = validateFile(file);
  return {
    id: crypto.randomUUID(),
    file,
    contentType: getContentType(file),
    progress: 0,
    status: validationError ? "invalid" : "queued",
    message: validationError || "Bereit",
  };
}

function updateUploadControls() {
  const uploadable = state.queue.some((item) => item.status === "queued");
  const uploading = state.activeUploads > 0;
  elements.uploadButton.disabled = !uploadable || !elements.uploadConsent.checked || uploading;
  elements.photoInput.disabled = uploading;
  elements.uploadConsent.disabled = uploading;
  elements.clearQueueButton.hidden = state.queue.length === 0 || uploading;
}

function renderQueue() {
  const fragment = document.createDocumentFragment();
  state.queue.forEach((item) => {
    const row = document.createElement("li");
    row.className = `queue-item is-${item.status}`;

    const name = document.createElement("span");
    name.className = "queue-item__name";
    name.textContent = item.file.name;
    name.title = item.file.name;

    const status = document.createElement("span");
    status.className = "queue-item__status";
    status.textContent = item.message;

    const progress = document.createElement("progress");
    progress.max = 100;
    progress.value = item.progress;
    progress.setAttribute("aria-label", `Upload-Fortschritt für ${item.file.name}`);

    row.append(name, status);
    if (item.status === "error") {
      const retry = document.createElement("button");
      retry.className = "retry-button";
      retry.type = "button";
      retry.textContent = "Erneut versuchen";
      retry.addEventListener("click", () => retryUpload(item));
      row.append(retry);
    }
    row.append(progress);
    fragment.append(row);
  });
  elements.uploadQueue.replaceChildren(fragment);
  updateUploadControls();
  updateOverallProgress();
}

function updateOverallProgress() {
  if (state.queue.length === 0) {
    elements.overallProgress.hidden = true;
    return;
  }

  const totalBytes = state.queue.reduce((total, item) => total + item.file.size, 0);
  const uploadedBytes = state.queue.reduce(
    (total, item) => total + item.file.size * (item.progress / 100),
    0,
  );
  const percent = totalBytes ? Math.round((uploadedBytes / totalBytes) * 100) : 0;
  const successes = state.queue.filter((item) => item.status === "success").length;
  const failures = state.queue.filter((item) => item.status === "error").length;

  elements.overallProgress.hidden = state.activeUploads === 0 && successes === 0 && failures === 0;
  elements.overallProgressBar.value = percent;
  elements.overallProgressValue.textContent = `${percent} %`;
  elements.overallProgressLabel.textContent = state.activeUploads
    ? `${successes} von ${state.queue.length} abgeschlossen`
    : failures
      ? `${successes} erfolgreich, ${failures} fehlgeschlagen`
      : `${successes} Fotos erfolgreich hochgeladen`;
}

function putFile(url, headers, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    Object.entries(headers).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Objektspeicher meldet HTTP ${request.status}.`));
    });
    request.addEventListener("error", () => reject(new Error("Direkter Upload fehlgeschlagen.")));
    request.addEventListener("abort", () => reject(new Error("Upload abgebrochen.")));
    request.send(file);
  });
}

async function uploadOne(item) {
  state.activeUploads += 1;
  item.status = "uploading";
  item.message = "Upload wird vorbereitet …";
  item.progress = 0;
  renderQueue();

  try {
    const target = await apiRequest("/api/photos/upload-url", {
      method: "POST",
      body: JSON.stringify({
        filename: item.file.name,
        content_type: item.contentType,
        size_bytes: item.file.size,
        consent_confirmed: elements.uploadConsent.checked,
      }),
    });
    item.message = "Wird hochgeladen …";
    renderQueue();

    await putFile(target.upload_url, target.required_headers, item.file, (progress) => {
      item.progress = Math.min(99, Math.round(progress));
      renderQueue();
    });

    item.message = "Vorschau wird erstellt …";
    item.progress = 99;
    renderQueue();
    await apiRequest(`/api/photos/${encodeURIComponent(target.photo_id)}/complete`, {
      method: "POST",
      body: JSON.stringify({ photo_id: target.photo_id }),
    });

    item.status = "success";
    item.message = "Erfolgreich hochgeladen";
    item.progress = 100;
  } catch (error) {
    if (error.status === 401) showAuthenticated(false);
    item.status = "error";
    item.message = error.message || "Upload fehlgeschlagen";
  } finally {
    state.activeUploads -= 1;
    renderQueue();
  }
}

async function uploadQueue() {
  const pending = state.queue.filter((item) => item.status === "queued");
  const nextIndex = { value: 0 };
  const workerCount = Math.min(GALLERY_CONFIG.uploadConcurrency, pending.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex.value < pending.length) {
      const item = pending[nextIndex.value];
      nextIndex.value += 1;
      await uploadOne(item);
    }
  });
  await Promise.all(workers);
  if (pending.some((item) => item.status === "success")) await loadPhotos(true);
}

async function retryUpload(item) {
  item.status = "queued";
  item.message = "Bereit";
  item.progress = 0;
  renderQueue();
  await uploadOne(item);
  if (item.status === "success") await loadPhotos(true);
}

function renderPhotos(append = false) {
  const fragment = document.createDocumentFragment();
  const startIndex = append ? elements.photoGrid.children.length : 0;
  state.photos.slice(startIndex).forEach((photo, offset) => {
    const index = startIndex + offset;
    const card = document.createElement("div");
    card.className = "photo-card";

    const button = document.createElement("button");
    button.className = "photo-tile";
    button.type = "button";
    const selected = state.selectedPhotoIds.has(photo.id);
    card.classList.toggle("is-selected", selected);
    button.setAttribute("aria-label", `Hochzeitsfoto ${index + 1} öffnen`);

    const image = document.createElement("img");
    image.src = photo.thumbnail_url;
    image.alt = `Hochzeitsfoto ${index + 1}`;
    image.loading = "lazy";
    image.decoding = "async";

    const selectButton = document.createElement("button");
    selectButton.className = "photo-select-button";
    selectButton.type = "button";
    selectButton.setAttribute("aria-pressed", String(selected));
    selectButton.setAttribute(
      "aria-label",
      `Hochzeitsfoto ${index + 1} ${selected ? "aus Auswahl entfernen" : "auswählen"}`,
    );
    selectButton.textContent = selected ? "✓" : "";

    button.append(image);
    button.addEventListener("click", () => openLightbox(index));
    selectButton.addEventListener("click", () => togglePhotoSelection(photo.id));
    card.append(button, selectButton);
    fragment.append(card);
  });

  if (!append) elements.photoGrid.replaceChildren();
  elements.photoGrid.append(fragment);
  elements.loadMoreButton.hidden = !state.nextCursor;
  elements.galleryMessage.textContent = state.photos.length
    ? `${state.photos.length} ${state.photos.length === 1 ? "Foto" : "Fotos"}`
    : "Noch sind keine Fotos da. Lade das erste hoch!";
  updateSelectionControls();
}

function updateSelectionControls() {
  const count = state.selectedPhotoIds.size;
  const allLoadedSelected =
    !state.nextCursor && state.photos.length > 0 && state.photos.every((photo) => state.selectedPhotoIds.has(photo.id));
  elements.galleryView.classList.toggle("has-selection", count > 0);
  elements.selectAllPhotosButton.disabled =
    state.loadingAllPhotos || state.photos.length === 0 || allLoadedSelected || count >= MAX_PHOTO_SELECTION;
  elements.selectAllPhotosButton.textContent = state.loadingAllPhotos
    ? "Alle werden geladen …"
    : count >= MAX_PHOTO_SELECTION && state.nextCursor
      ? `Maximal ${MAX_PHOTO_SELECTION} ausgewählt`
      : allLoadedSelected
        ? "Alle ausgewählt"
        : "Alle auswählen";
  elements.selectionBar.hidden = count === 0;
  elements.downloadSelectedButton.hidden = count === 0;
  elements.clearSelectionButton.hidden = count === 0;
  elements.downloadSelectedButton.disabled = count === 0;
  elements.downloadSelectedButton.textContent = count
    ? `${count} ${count === 1 ? "Foto" : "Fotos"} herunterladen`
    : "Auswahl herunterladen";
}

function clearPhotoSelection() {
  state.selectedPhotoIds.clear();
  renderPhotos(false);
}

async function selectAllPhotos() {
  if (state.loadingAllPhotos || state.photos.length === 0) return;
  state.loadingAllPhotos = true;
  elements.galleryMessage.textContent = "Alle Fotos werden geladen …";
  updateSelectionControls();

  let cursor = state.nextCursor;
  let failed = false;
  const seenCursors = new Set();
  try {
    while (cursor && state.photos.length < MAX_PHOTO_SELECTION) {
      if (seenCursors.has(cursor)) throw new Error("Die Galerie konnte nicht vollständig geladen werden.");
      seenCursors.add(cursor);
      const remaining = MAX_PHOTO_SELECTION - state.photos.length;
      const page = await apiRequest(
        `/api/photos?cursor=${encodeURIComponent(cursor)}&limit=${Math.min(100, remaining)}`,
      );
      state.photos.push(...page.photos);
      cursor = page.next_cursor;
      state.nextCursor = cursor;
    }

    state.selectedPhotoIds = new Set(
      state.photos.slice(0, MAX_PHOTO_SELECTION).map((photo) => photo.id),
    );
    renderPhotos(false);
  } catch (error) {
    failed = true;
    if (error.status === 401) showAuthenticated(false);
    elements.galleryMessage.textContent =
      error.message || "Nicht alle Fotos konnten ausgewählt werden.";
  } finally {
    state.loadingAllPhotos = false;
    updateSelectionControls();
    if (cursor && !failed) {
      elements.galleryMessage.textContent =
        `Es können höchstens ${MAX_PHOTO_SELECTION} Fotos pro ZIP ausgewählt werden.`;
    }
  }
}

function togglePhotoSelection(photoId) {
  if (state.selectedPhotoIds.has(photoId)) {
    state.selectedPhotoIds.delete(photoId);
  } else if (state.selectedPhotoIds.size < MAX_PHOTO_SELECTION) {
    state.selectedPhotoIds.add(photoId);
  } else {
    elements.galleryMessage.textContent =
      `Es können höchstens ${MAX_PHOTO_SELECTION} Fotos gleichzeitig ausgewählt werden.`;
    return;
  }
  renderPhotos(false);
}

async function loadPhotos(reset = false) {
  elements.refreshButton.disabled = true;
  elements.loadMoreButton.disabled = true;
  elements.galleryMessage.textContent = "Fotos werden geladen …";
  try {
    const cursor = reset ? null : state.nextCursor;
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const page = await apiRequest(`/api/photos${query}`);
    state.photos = reset ? page.photos : [...state.photos, ...page.photos];
    state.nextCursor = page.next_cursor;
    if (reset) {
      state.selectedPhotoIds.clear();
    }
    renderPhotos(!reset);
  } catch (error) {
    if (error.status === 401) showAuthenticated(false);
    elements.galleryMessage.textContent = error.message || "Fotos konnten nicht geladen werden.";
  } finally {
    elements.refreshButton.disabled = false;
    elements.loadMoreButton.disabled = false;
  }
}

async function loadRuntimeConfig() {
  const config = await apiRequest("/api/config");
  state.maxUploadBytes = config.max_upload_size;
  elements.fileLimit.textContent = `Max. ${formatBytes(state.maxUploadBytes)} pro Foto`;
  const retentionDate = new Date(`${config.retention_until}T12:00:00`);
  elements.retentionDate.dateTime = config.retention_until;
  elements.retentionDate.textContent = retentionDate.toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

async function showLightboxPhoto(index) {
  if (index < 0 || index >= state.photos.length) return;
  state.lightboxIndex = index;
  state.lightboxRequest += 1;
  const requestId = state.lightboxRequest;
  const photo = state.photos[index];

  elements.lightboxCounter.textContent = `${index + 1} / ${state.photos.length}`;
  elements.previousPhoto.disabled = index === 0;
  elements.nextPhoto.disabled = index === state.photos.length - 1;
  elements.lightboxLoader.hidden = false;
  elements.lightboxLoader.textContent = "Original wird geladen …";
  elements.lightboxImage.src = photo.thumbnail_url;

  try {
    const result = await apiRequest(
      `/api/photos/${encodeURIComponent(photo.id)}/download-url?disposition=inline`,
    );
    if (requestId === state.lightboxRequest) {
      elements.lightboxImage.addEventListener(
        "load",
        () => {
          if (requestId === state.lightboxRequest) elements.lightboxLoader.hidden = true;
        },
        { once: true },
      );
      elements.lightboxImage.src = result.download_url;
    }
  } catch (error) {
    if (requestId === state.lightboxRequest) {
      elements.lightboxLoader.textContent = error.message || "Original konnte nicht geladen werden.";
    }
  }
}

function openLightbox(index) {
  elements.lightbox.showModal();
  showLightboxPhoto(index);
}

async function downloadCurrentPhoto() {
  const photo = state.photos[state.lightboxIndex];
  if (!photo) return;
  elements.downloadButton.disabled = true;
  try {
    const result = await apiRequest(
      `/api/photos/${encodeURIComponent(photo.id)}/download-url?disposition=attachment`,
    );
    triggerDownload(result.download_url);
  } catch (error) {
    elements.lightboxLoader.hidden = false;
    elements.lightboxLoader.textContent = error.message || "Download konnte nicht gestartet werden.";
  } finally {
    elements.downloadButton.disabled = false;
  }
}

function triggerDownload(url, filename = "") {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener noreferrer";
  document.body.append(link);
  link.click();
  link.remove();
}

async function downloadSelectedPhotos() {
  const photoIds = [...state.selectedPhotoIds];
  if (!photoIds.length) return;

  elements.downloadSelectedButton.disabled = true;
  elements.downloadSelectedButton.textContent =
    photoIds.length === 1 ? "Download wird vorbereitet …" : "ZIP-Datei wird vorbereitet …";
  try {
    if (photoIds.length === 1) {
      const result = await apiRequest(
        `/api/photos/${encodeURIComponent(photoIds[0])}/download-url?disposition=attachment`,
      );
      triggerDownload(result.download_url);
    } else {
      const response = await apiFetch("/api/photos/download", {
        method: "POST",
        body: JSON.stringify({ photo_ids: photoIds }),
      });
      const archiveUrl = URL.createObjectURL(await response.blob());
      triggerDownload(archiveUrl, "hochzeitsfotos.zip");
      setTimeout(() => URL.revokeObjectURL(archiveUrl), 60_000);
    }
    clearPhotoSelection();
  } catch (error) {
    if (error.status === 401) showAuthenticated(false);
    elements.galleryMessage.textContent =
      error.message || "Download konnte nicht gestartet werden.";
    updateSelectionControls();
  }
}

async function initialize() {
  elements.fileLimit.textContent = `Max. ${formatBytes(state.maxUploadBytes)} pro Foto`;
  try {
    const status = await apiRequest("/api/auth/status");
    if (status.authenticated) {
      state.csrfToken = status.csrf_token;
      showAuthenticated(true);
      await loadRuntimeConfig();
      await loadPhotos(true);
    } else {
      showAuthenticated(false);
    }
  } catch {
    showAuthenticated(false);
    elements.loginMessage.textContent = "Die Galerie ist gerade nicht erreichbar. Bitte später erneut versuchen.";
  }
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.loginMessage.textContent = "Anmeldung wird geprüft …";
  const submitButton = elements.loginForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    const result = await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: elements.password.value }),
    });
    state.csrfToken = result.csrf_token;
    elements.password.value = "";
    elements.loginMessage.textContent = "";
    showAuthenticated(true);
    await loadRuntimeConfig();
    await loadPhotos(true);
  } catch (error) {
    elements.loginMessage.textContent = error.message || "Anmeldung fehlgeschlagen.";
  } finally {
    submitButton.disabled = false;
  }
});

elements.logoutButton.addEventListener("click", async () => {
  try {
    await apiRequest("/api/auth/logout", { method: "POST" });
  } catch {
    // A locally expired session should still return the UI to the login view.
  } finally {
    state.photos = [];
    state.queue = [];
    state.selectedPhotoIds.clear();
    showAuthenticated(false);
  }
});

elements.photoInput.addEventListener("change", () => {
  const newItems = [...elements.photoInput.files].map(makeQueueItem);
  state.queue.push(...newItems);
  elements.photoInput.value = "";
  renderQueue();
});

elements.uploadConsent.addEventListener("change", updateUploadControls);
elements.uploadButton.addEventListener("click", uploadQueue);
elements.clearQueueButton.addEventListener("click", () => {
  state.queue = [];
  renderQueue();
});
elements.refreshButton.addEventListener("click", () => loadPhotos(true));
elements.loadMoreButton.addEventListener("click", () => loadPhotos(false));
elements.selectAllPhotosButton.addEventListener("click", selectAllPhotos);
elements.clearSelectionButton.addEventListener("click", clearPhotoSelection);
elements.downloadSelectedButton.addEventListener("click", downloadSelectedPhotos);

elements.lightboxClose.addEventListener("click", () => elements.lightbox.close());
elements.previousPhoto.addEventListener("click", () => showLightboxPhoto(state.lightboxIndex - 1));
elements.nextPhoto.addEventListener("click", () => showLightboxPhoto(state.lightboxIndex + 1));
elements.downloadButton.addEventListener("click", downloadCurrentPhoto);
elements.lightbox.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") showLightboxPhoto(state.lightboxIndex - 1);
  if (event.key === "ArrowRight") showLightboxPhoto(state.lightboxIndex + 1);
});

let touchStartX = null;
elements.lightboxStage.addEventListener(
  "touchstart",
  (event) => {
    touchStartX = event.changedTouches[0]?.clientX ?? null;
  },
  { passive: true },
);
elements.lightboxStage.addEventListener(
  "touchend",
  (event) => {
    if (touchStartX === null) return;
    const distance = (event.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
    touchStartX = null;
    if (Math.abs(distance) < 55) return;
    showLightboxPhoto(state.lightboxIndex + (distance < 0 ? 1 : -1));
  },
  { passive: true },
);

initialize();
