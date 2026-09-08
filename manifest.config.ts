import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

// Note: host_permissions is hardcoded to the Testkube cloud control plane for the
// PoC. If you point the extension at a different API base URL in the options page,
// add the matching origin here and rebuild.
export default defineManifest({
  manifest_version: 3,
  name: 'Testkube for GitHub',
  description: 'Surfaces Testkube TestWorkflows on the GitHub repositories they test.',
  version: pkg.version,
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  permissions: ['storage'],
  host_permissions: ['https://api.testkube.io/*'],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://github.com/*'],
      js: ['src/content/content-script.ts'],
      run_at: 'document_idle',
    },
  ],
  options_page: 'src/options/index.html',
  action: {
    default_title: 'Testkube for GitHub',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
    },
  },
});
