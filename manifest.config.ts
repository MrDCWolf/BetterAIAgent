import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Better AI Agents',
  version: '0.1.0',
  description: 'A Better AI Agent',
  permissions: ['storage', 'scripting', 'tabs', 'activeTab', 'sidePanel'],
  host_permissions: ['<all_urls>'],
  background: { 
    service_worker: 'src/background/main.ts',
    type: 'module'
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/content.ts']
    }
  ],
  action: { 
    default_icon: 'icon.png' // Make sure you have an icon.png or update this
  }, 
  side_panel: { 
    default_path: 'src/panel/sidepanel.html' 
  }
}) 