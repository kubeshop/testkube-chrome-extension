import {defineManifest} from '@crxjs/vite-plugin';

import pkg from './package.json';

// The Testkube Cloud API is allowed up front. Any other API base URL (a
// self-managed control plane) is covered by optional_host_permissions and is
// granted at runtime from the options page, so no rebuild is needed.
export default defineManifest({
  manifest_version: 3,
  name: 'Testkube for GitHub',
  description: 'Surfaces Testkube TestWorkflow Results on the GitHub repositories and Pull Requests they test.',
  version: pkg.version,
  homepage_url: 'https://github.com/kubeshop/testkube-chrome-extension',
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  permissions: ['storage'],
  host_permissions: ['https://api.testkube.io/*'],
  optional_host_permissions: ['https://*/*', 'http://*/*'],
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
