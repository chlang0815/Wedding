import { GALLERY_CONFIG } from "./gallery.config.js";

const API_BASE_URL = GALLERY_CONFIG.apiBaseUrl.replace(/\/$/, "");
const MAX_PHOTO_SELECTION = 100;
const GALLERY_PAGE_SIZE = 50;
const MIME_BY_EXTENSION = Object.freeze({
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  heic: [
    "image/heic",
    "image/heif",
    "image/heic-sequence",
    "image/heif-sequence",
    "image/x-heic",
    "image/x-heif",
  ],
  heif: [
    "image/heif",
    "image/heic",
    "image/heif-sequence",
    "image/heic-sequence",
    "image/x-heif",
    "image/x-heic",
  ],
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
    "uploadCard",
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
    "paginationControls",
    "previousPageButton",
    "nextPageButton",
    "pageIndicator",
    "loadAllPhotosButton",
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
  pageCache: new Map(),
  currentPage: 1,
  showAllPhotos: false,
  loadingGallery: false,
  nextCursor: null,
  totalPhotos: null,
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
  const extension = file.name.split(".").pop()?.toLowerCase();
  const allowedTypes = MIME_BY_EXTENSION[extension];
  const reportedType = (file.type || "").toLowerCase();
  if (!reportedType && allowedTypes) return allowedTypes[0];
  return reportedType;
}

function validateFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const contentType = getContentType(file);
  if (!extension || !MIME_BY_EXTENSION[extension]) {
    return "Dateityp nicht unterstützt";
  }
  if (!MIME_BY_EXTENSION[extension].includes(contentType)) {
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
  const selectedCount = state.queue.filter((item) => item.status !== "invalid").length;
  elements.uploadButton.textContent = selectedCount
    ? `Auswahl hochladen (${selectedCount})`
    : "Auswahl hochladen";
  elements.uploadButton.disabled = !uploadable || !elements.uploadConsent.checked || uploading;
  elements.photoInput.disabled = uploading;
  elements.uploadConsent.disabled = uploading;
  elements.clearQueueButton.hidden = state.queue.length === 0 || uploading;
}

function renderQueue() {
  const fragment = document.createDocumentFragment();
  const problemItems = state.queue.filter((item) => ["invalid", "error"].includes(item.status));

  problemItems.forEach((item) => {
    const row = document.createElement("li");
    row.className = `queue-item is-${item.status}`;

    const name = document.createElement("span");
    name.className = "queue-item__name";
    name.textContent = item.file.name;
    name.title = item.file.name;

    const status = document.createElement("span");
    status.className = "queue-item__status";
    status.textContent = item.message;

    row.append(name, status);
    if (item.status === "error") {
      const retry = document.createElement("button");
      retry.className = "retry-button";
      retry.type = "button";
      retry.textContent = "Erneut versuchen";
      retry.addEventListener("click", () => retryUpload(item));
      row.append(retry);
    }
    fragment.append(row);
  });
  elements.uploadQueue.replaceChildren(fragment);
  elements.uploadCard.classList.toggle("is-empty", state.queue.length === 0);
  updateUploadControls();
  updateOverallProgress();
}

function updateOverallProgress() {
  if (state.queue.length === 0) {
    elements.overallProgress.hidden = true;
    return;
  }

  const trackedItems = state.queue.filter((item) => item.status !== "invalid");
  const totalBytes = trackedItems.reduce((total, item) => total + item.file.size, 0);
  const uploadedBytes = trackedItems.reduce(
    (total, item) => total + item.file.size * (item.progress / 100),
    0,
  );
  const percent = totalBytes ? Math.round((uploadedBytes / totalBytes) * 100) : 0;
  const successes = trackedItems.filter((item) => item.status === "success").length;
  const failures = trackedItems.filter((item) => item.status === "error").length;

  elements.overallProgress.hidden = state.activeUploads === 0 && successes === 0 && failures === 0;
  elements.overallProgressBar.value = percent;
  elements.overallProgressValue.textContent = `${percent} %`;
  elements.overallProgressLabel.textContent = state.activeUploads
    ? `${successes} von ${trackedItems.length} abgeschlossen`
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
  updatePaginationControls();
  if (state.totalPhotos === 0 || state.photos.length === 0) {
    elements.galleryMessage.textContent = "Noch sind keine Fotos da. Lade das erste hoch!";
  } else if (state.totalPhotos !== null) {
    const noun = state.totalPhotos === 1 ? "Foto" : "Fotos";
    elements.galleryMessage.textContent =
      `${state.photos.length} von ${state.totalPhotos} ${noun} geladen`;
  } else {
    elements.galleryMessage.textContent =
      `${state.photos.length} ${state.photos.length === 1 ? "Foto" : "Fotos"} geladen`;
  }
  updateSelectionControls();
}

function updatePaginationControls() {
  const knownTotal = state.totalPhotos ?? state.photos.length;
  const totalPages = state.totalPhotos === null
    ? null
    : Math.max(1, Math.ceil(state.totalPhotos / GALLERY_PAGE_SIZE));
  const hasMultiplePages = (totalPages ?? 1) > 1 || Boolean(state.nextCursor);

  elements.paginationControls.hidden = !hasMultiplePages;
  elements.previousPageButton.disabled =
    state.loadingGallery || state.showAllPhotos || state.currentPage <= 1;
  elements.nextPageButton.disabled =
    state.loadingGallery || state.showAllPhotos || !state.nextCursor;
  elements.loadAllPhotosButton.disabled = state.loadingGallery || state.showAllPhotos;
  elements.loadAllPhotosButton.textContent = state.showAllPhotos
    ? "Alle Fotos geladen"
    : "Alle Fotos laden";
  elements.pageIndicator.textContent = state.showAllPhotos
    ? `Alle ${knownTotal} Fotos`
    : totalPages === null
      ? `Seite ${state.currentPage}`
      : `Seite ${state.currentPage} von ${totalPages}`;
}

function updateSelectionControls() {
  const count = state.selectedPhotoIds.size;
  const allVisibleSelected =
    state.photos.length > 0 && state.photos.every((photo) => state.selectedPhotoIds.has(photo.id));
  elements.galleryView.classList.toggle("has-selection", count > 0);
  elements.selectAllPhotosButton.disabled =
    state.photos.length === 0 || allVisibleSelected || count >= MAX_PHOTO_SELECTION;
  elements.selectAllPhotosButton.textContent = count >= MAX_PHOTO_SELECTION
    ? `Maximal ${MAX_PHOTO_SELECTION} ausgewählt`
    : allVisibleSelected
      ? state.showAllPhotos
        ? "Alle ausgewählt"
        : "Seite ausgewählt"
      : state.showAllPhotos
        ? "Alle auswählen"
        : "Seite auswählen";
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

function selectAllPhotos() {
  if (state.photos.length === 0) return;
  const remaining = MAX_PHOTO_SELECTION - state.selectedPhotoIds.size;
  const unselectedPhotos = state.photos.filter(
    (photo) => !state.selectedPhotoIds.has(photo.id),
  );

  unselectedPhotos.slice(0, remaining).forEach((photo) => {
    state.selectedPhotoIds.add(photo.id);
  });
  renderPhotos(false);

  if (unselectedPhotos.length > remaining) {
    elements.galleryMessage.textContent =
      `Es können höchstens ${MAX_PHOTO_SELECTION} Fotos gleichzeitig ausgewählt werden.`;
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
  if (!reset) return loadGalleryPage(state.currentPage + 1);

  state.loadingGallery = true;
  state.showAllPhotos = false;
  state.currentPage = 1;
  state.pageCache.clear();
  state.selectedPhotoIds.clear();
  elements.refreshButton.disabled = true;
  elements.galleryMessage.textContent = "Fotos werden geladen …";
  updatePaginationControls();

  try {
    const page = await apiRequest(`/api/photos?limit=${GALLERY_PAGE_SIZE}`);
    state.totalPhotos = page.total_count ?? null;
    state.pageCache.set(1, {
      photos: page.photos,
      nextCursor: page.next_cursor,
    });
    showCachedPage(1);
  } catch (error) {
    if (error.status === 401) showAuthenticated(false);
    elements.galleryMessage.textContent = error.message || "Fotos konnten nicht geladen werden.";
  } finally {
    state.loadingGallery = false;
    elements.refreshButton.disabled = false;
    updatePaginationControls();
  }
}

function showCachedPage(pageNumber) {
  const page = state.pageCache.get(pageNumber);
  if (!page) return;
  state.currentPage = pageNumber;
  state.photos = page.photos;
  state.nextCursor = page.nextCursor;
  renderPhotos(false);
}

async function loadGalleryPage(pageNumber) {
  if (state.loadingGallery || state.showAllPhotos || pageNumber < 1) return;
  const totalPages = state.totalPhotos === null
    ? null
    : Math.max(1, Math.ceil(state.totalPhotos / GALLERY_PAGE_SIZE));
  if (totalPages !== null && pageNumber > totalPages) return;

  if (state.pageCache.has(pageNumber)) {
    showCachedPage(pageNumber);
    return;
  }
  if (pageNumber !== state.currentPage + 1 || !state.nextCursor) return;

  state.loadingGallery = true;
  elements.refreshButton.disabled = true;
  elements.galleryMessage.textContent = "Fotos werden geladen …";
  updatePaginationControls();
  try {
    const page = await apiRequest(
      `/api/photos?cursor=${encodeURIComponent(state.nextCursor)}&limit=${GALLERY_PAGE_SIZE}`,
    );
    state.pageCache.set(pageNumber, {
      photos: page.photos,
      nextCursor: page.next_cursor,
    });
    showCachedPage(pageNumber);
  } catch (error) {
    if (error.status === 401) showAuthenticated(false);
    elements.galleryMessage.textContent = error.message || "Fotos konnten nicht geladen werden.";
  } finally {
    state.loadingGallery = false;
    elements.refreshButton.disabled = false;
    updatePaginationControls();
  }
}

async function loadAllPhotos() {
  if (state.loadingGallery || state.showAllPhotos) return;
  state.loadingGallery = true;
  elements.refreshButton.disabled = true;
  elements.galleryMessage.textContent = "Alle Fotos werden geladen …";
  updatePaginationControls();

  const allPhotos = [];
  const seenCursors = new Set();
  let cursor = null;
  try {
    do {
      if (cursor && seenCursors.has(cursor)) {
        throw new Error("Die Galerie konnte nicht vollständig geladen werden.");
      }
      if (cursor) seenCursors.add(cursor);
      const query = cursor
        ? `?cursor=${encodeURIComponent(cursor)}&limit=100`
        : "?limit=100";
      const page = await apiRequest(`/api/photos${query}`);
      if (cursor === null) state.totalPhotos = page.total_count ?? null;
      allPhotos.push(...page.photos);
      cursor = page.next_cursor;
    } while (cursor);

    state.photos = allPhotos;
    state.nextCursor = null;
    state.showAllPhotos = true;
    state.totalPhotos ??= allPhotos.length;
    renderPhotos(false);
  } catch (error) {
    if (error.status === 401) showAuthenticated(false);
    elements.galleryMessage.textContent =
      error.message || "Nicht alle Fotos konnten geladen werden.";
  } finally {
    state.loadingGallery = false;
    elements.refreshButton.disabled = false;
    updatePaginationControls();
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
    state.totalPhotos = null;
    state.nextCursor = null;
    state.currentPage = 1;
    state.showAllPhotos = false;
    state.pageCache.clear();
    state.selectedPhotoIds.clear();
    renderQueue();
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
elements.previousPageButton.addEventListener("click", () => {
  loadGalleryPage(state.currentPage - 1);
});
elements.nextPageButton.addEventListener("click", () => {
  loadGalleryPage(state.currentPage + 1);
});
elements.loadAllPhotosButton.addEventListener("click", loadAllPhotos);
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
