import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: {
            bin: 'src/bin.ts',
        },
        outDir: 'dist',
        format: ['esm'],
        platform: 'node',
        target: 'node24',
        clean: true,
        banner: {
            js: '#!/usr/bin/env node',
        },
    },
    {
        entry: {
            'lib/browser': 'src/lib/browser.ts',
            'lib/ai-bridge-shell': 'src/lib/ai-bridge-shell.ts',
        },
        outDir: 'dist',
        format: ['esm'],
        platform: 'node',
        target: 'node24',
        clean: false,
    },
]);
