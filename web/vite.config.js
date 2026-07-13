import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
    plugins: [react()],
    build: {
        outDir: path.resolve(import.meta.dirname, 'dist'),
        emptyOutDir: true,
    },
    server: {
        host: '127.0.0.1',
        port: 4173,
        proxy: {
            '/api': 'http://127.0.0.1:3001',
        },
    },
});
