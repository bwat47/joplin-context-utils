import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['src/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.d.ts', 'src/index.ts', 'src/manifest.json'],
        },
    },
    resolve: {
        alias: {
            api: new URL('./api', import.meta.url).pathname,
        },
    },
});
