import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/bin.ts', 'src/lib/browser.ts'],
    outDir: 'dist',
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    clean: true,
    banner: {
        js: '#!/usr/bin/env node',
    },
});
