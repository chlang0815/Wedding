import { GALLERY_CONFIG } from "./gallery.config.js";

const API_BASE_URL = GALLERY_CONFIG.apiBaseUrl.replace(/\/$/, "");
const MAX_PHOTO_SELECTION = 100;

const elements = Object.fromEntries(
  [
    "adminAuthView",
    "adminView",
    "adminLoginForm",
    "adminPassword",
    "adminLoginMessage",
    "adminLogoutButton",
    "adminRefreshButton",
    "adminMessage",
    "adminSelectionCount",
    "selectAllButton",
    "clearAdminSelectionButton",
    "deleteSelectedButton",
    "adminPhotoGrid",
    "adminLoadMoreButton",
  ].map((id) => [id, document.getElementById(id)]),
);

const state = {
  csrfToken: null,
  photos: [],
  selectedPhotoIds: new Set(),
  nextCursor: null,
  deleting: false,
};

function getErrorMessage(payload, fallback) {
  if (typeof payload?.detail === "string") return payload.detail;
  if (Array.isArray(payload?.detail)) {
    return payload.detail.map((item) => item.msg).filter(Boolean).join(" ") || fallback;
  }
  return fallback;
}

async function apiRequest(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
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
      // Proxies may answer with a non-JSON error page.
    }
    const error = new Error(getErrorMessage(payload, "Die Anfrage ist fehlgeschlagen."));
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

function showAuthenticated(authenticated) {
  elements.adminAuthView.hidden = authenticated;
  elements.adminView.hidden = !authenticated;
  if (!authenticated) {
    state.csrfToken = null;
    state.photos = [];
    state.selectedPhotoIds.clear();
    elements.adminPassword.focus();
  }
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function updateSelectionControls() {
  const count = state.selectedPhotoIds.size;
  elements.adminSelectionCount.textContent = count
    ? `${count} ${count === 1 ? "Foto ausgewählt" : "Fotos ausgewählt"}`
    : "Keine Fotos ausgewählt";
  elements.clearAdminSelectionButton.disabled = count === 0 || state.deleting;
  elements.deleteSelectedButton.disabled = count === 0 || state.deleting;
  elements.deleteSelectedButton.textContent = state.deleting
    ? "Wird gelöscht …"
    : count
      ? `${count} ${count === 1 ? "Foto" : "Fotos"} löschen`
      : "Auswahl löschen";
  elements.selectAllButton.disabled = state.photos.length === 0 || state.deleting;
}

function renderPhotos(append = false) {
  const fragment = document.createDocumentFragment();
  const startIndex = append ? elements.adminPhotoGrid.children.length : 0;
  state.photos.slice(startIndex).forEach((photo, offset) => {
    const index = startIndex + offset;
    const selected = state.selectedPhotoIds.has(photo.id);
    const button = document.createElement("button");
    button.className = "photo-tile admin-photo is-selecting";
    button.classList.toggle("is-selected", selected);
    button.type = "button";
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute(
      "aria-label",
      `Hochzeitsfoto ${index + 1} ${selected ? "aus Auswahl entfernen" : "auswählen"}`,
    );

    const image = document.createElement("img");
    image.src = photo.thumbnail_url;
    image.alt = `Hochzeitsfoto ${index + 1}`;
    image.loading = "lazy";
    image.decoding = "async";

    const marker = document.createElement("span");
    marker.className = "photo-tile__selection";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = selected ? "✓" : "";

    const date = document.createElement("span");
    date.className = "admin-photo__date";
    date.textContent = formatDate(photo.uploaded_at);

    button.append(image, marker, date);
    button.addEventListener("click", () => toggleSelection(photo.id));
    fragment.append(button);
  });

  if (!append) elements.adminPhotoGrid.replaceChildren();
  elements.adminPhotoGrid.append(fragment);
  elements.adminLoadMoreButton.hidden = !state.nextCursor;
  elements.adminMessage.textContent = state.photos.length
    ? `${state.photos.length} ${state.photos.length === 1 ? "Foto geladen" : "Fotos geladen"}`
    : "Die Galerie enthält keine Fotos.";
  updateSelectionControls();
}

function toggleSelection(photoId) {
  if (state.selectedPhotoIds.has(photoId)) {
    state.selectedPhotoIds.delete(photoId);
  } else if (state.selectedPhotoIds.size < MAX_PHOTO_SELECTION) {
    state.selectedPhotoIds.add(photoId);
  } else {
    elements.adminMessage.textContent =
      `Es können höchstens ${MAX_PHOTO_SELECTION} Fotos gleichzeitig gelöscht werden.`;
    return;
  }
  renderPhotos(false);
}

async function loadPhotos(reset = false) {
  elements.adminRefreshButton.disabled = true;
  elements.adminLoadMoreButton.disabled = true;
  elements.adminMessage.textContent = "Fotos werden geladen …";
  try {
    const cursor = reset ? null : state.nextCursor;
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const page = await apiRequest(`/api/admin/photos${query}`);
    state.photos = reset ? page.photos : [...state.photos, ...page.photos];
    state.nextCursor = page.next_cursor;
    if (reset) state.selectedPhotoIds.clear();
    renderPhotos(!reset);
  } catch (error) {
    if (error.status === 401) showAuthenticated(false);
    elements.adminMessage.textContent = error.message || "Fotos konnten nicht geladen werden.";
  } finally {
    elements.adminRefreshButton.disabled = false;
    elements.adminLoadMoreButton.disabled = false;
  }
}

async function deleteSelectedPhotos() {
  const photoIds = [...state.selectedPhotoIds];
  if (!photoIds.length || state.deleting) return;
  const label = photoIds.length === 1 ? "dieses Foto" : `diese ${photoIds.length} Fotos`;
  if (!window.confirm(`Möchtet ihr ${label} wirklich dauerhaft löschen?`)) return;

  state.deleting = true;
  updateSelectionControls();
  elements.adminMessage.textContent = "Auswahl wird gelöscht …";
  try {
    const result = await apiRequest("/api/admin/photos/selection", {
      method: "DELETE",
      body: JSON.stringify({ photo_ids: photoIds }),
    });
    state.selectedPhotoIds.clear();
    await loadPhotos(true);
    elements.adminMessage.textContent = `${result.deleted} ${result.deleted === 1 ? "Foto wurde" : "Fotos wurden"} gelöscht.`;
  } catch (error) {
    if (error.status === 401) showAuthenticated(false);
    elements.adminMessage.textContent = error.message || "Die Auswahl konnte nicht gelöscht werden.";
  } finally {
    state.deleting = false;
    updateSelectionControls();
  }
}

async function initialize() {
  try {
    const status = await apiRequest("/api/admin/auth/status");
    if (status.authenticated) {
      state.csrfToken = status.csrf_token;
      showAuthenticated(true);
      await loadPhotos(true);
    } else {
      showAuthenticated(false);
    }
  } catch {
    showAuthenticated(false);
    elements.adminLoginMessage.textContent =
      "Die Galerie ist gerade nicht erreichbar. Bitte später erneut versuchen.";
  }
}

elements.adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = elements.adminLoginForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  elements.adminLoginMessage.textContent = "Anmeldung wird geprüft …";
  try {
    const result = await apiRequest("/api/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: elements.adminPassword.value }),
    });
    state.csrfToken = result.csrf_token;
    elements.adminPassword.value = "";
    elements.adminLoginMessage.textContent = "";
    showAuthenticated(true);
    await loadPhotos(true);
  } catch (error) {
    elements.adminLoginMessage.textContent = error.message || "Anmeldung fehlgeschlagen.";
  } finally {
    submitButton.disabled = false;
  }
});

elements.adminLogoutButton.addEventListener("click", async () => {
  try {
    await apiRequest("/api/admin/auth/logout", { method: "POST" });
  } catch {
    // The local view must still close when the session already expired.
  } finally {
    showAuthenticated(false);
  }
});

elements.adminRefreshButton.addEventListener("click", () => loadPhotos(true));
elements.adminLoadMoreButton.addEventListener("click", () => loadPhotos(false));
elements.selectAllButton.addEventListener("click", () => {
  state.selectedPhotoIds = new Set(
    state.photos.slice(0, MAX_PHOTO_SELECTION).map((photo) => photo.id),
  );
  renderPhotos(false);
});
elements.clearAdminSelectionButton.addEventListener("click", () => {
  state.selectedPhotoIds.clear();
  renderPhotos(false);
});
elements.deleteSelectedButton.addEventListener("click", deleteSelectedPhotos);

initialize();
