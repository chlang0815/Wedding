/**
 * Public frontend configuration (never put secrets in this file).
 * Change apiBaseUrl to the HTTPS origin of the deployed FastAPI service before
 * publishing. The local default matches the backend README instructions.
 */
export const GALLERY_CONFIG = Object.freeze({
  apiBaseUrl: "http://localhost:8080",
  uploadConcurrency: 3,
});
