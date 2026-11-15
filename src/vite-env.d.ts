/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "false" to use the real backend (see README) */
  readonly VITE_USE_MOCK?: string
  /** The backend's base URL, e.g. https://<workspace>--photos-to-3d-api.modal.run */
  readonly VITE_API_URL?: string
  /** Google Maps browser key for the street view in the walk-through (restrict it to your site's address) */
  readonly VITE_GOOGLE_MAPS_KEY?: string
}
