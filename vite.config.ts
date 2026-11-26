import { defineConfig } from 'vite';
import plugin from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
    base: './',
    plugins: [plugin()],
    define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(process.env.VITE_BUILD_ID || new Date().toISOString()) },
    preview: { port: 51115, strictPort: true },
    server: {
        port: 51114,
        watch: {
            ignored: ['**/.vs/**'],
        },
    },
});
