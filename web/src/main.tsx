import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setWorkerUrl } from 'maplibre-gl';
// MapLibre 6 looks for its worker next to its own module, which Vite does not copy. Bundling
// it as a worker gives a hashed same-origin file that the service worker also precaches.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { registerAspectProtocol } from './lib/aspect';
import { registerBasemapProtocol } from './lib/basemap';
import { registerPmtilesProtocol } from './lib/vegsource';
import './app.css';

// Worker URL and protocols are global in MapLibre and must be set before the first map loads.
setWorkerUrl(maplibreWorkerUrl);
registerBasemapProtocol();
registerAspectProtocol();
registerPmtilesProtocol();
registerSW({ immediate: true });

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing in index.html');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
