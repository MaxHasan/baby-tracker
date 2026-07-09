import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Activate a new build immediately instead of waiting for every tab to
      // close — otherwise the installed PWA keeps serving a stale bundle for
      // a long time (this is what made earlier fixes appear not to "take").
      workbox: { clientsClaim: true, skipWaiting: true },
      manifest: {
        name: 'Baby Tracker',
        short_name: 'Baby',
        description: 'Feeding, pumping, sleep & diaper tracking for your baby',
        theme_color: '#C75B7A',
        background_color: '#FFF7F9',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});
