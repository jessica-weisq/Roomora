// Google Maps key for the street view (Track C reads MAPS_API_KEY). Leave it empty and the street
// view shows the front-of-house photo instead. On the Veduta website the key comes from the
// VITE_GOOGLE_MAPS_KEY environment variable instead, so this file can stay empty.
// Restrict the key to your site's address in Google Cloud: a browser key is always visible.
// API_URL: the Veduta backend, for Reimagine with Fal when the tour is opened on its own (inside Veduta the
// website passes requests on, so leave it empty). For example "http://localhost:8000/api" or your Modal URL.
window.TOUR_CONFIG = {
  MAPS_API_KEY: "",
  API_URL: "",
};
