import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(rootDir, 'dist', 'bin.js');

function runCli(args, cwd, env = {}) {
    return spawnSync(process.execPath, [cliPath, ...args], {
        cwd,
        encoding: 'utf8',
        env: {
            ...process.env,
            ...env,
        },
    });
}

function makeTempDir(prefix = 'ramp-cli-open-test-') {
    return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFetchMock(tempDir, script) {
    const mockPath = path.join(tempDir, 'mock-fetch.mjs');
    writeFileSync(mockPath, script, 'utf8');

    return mockPath;
}

function writeCredentials(homeDir) {
    const configDir = path.join(homeDir, '.config', 'ramp');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
        path.join(configDir, 'credentials.json'),
        `${JSON.stringify(
            {
                token: 'rmp_cli_test_token',
                apiUrl: 'https://api.ramp.sh',
                email: 'tiago@example.com',
                selectedWorkspaceId: 'ws_personal',
                updatedAt: new Date().toISOString(),
            },
            null,
            2,
        )}\n`,
        'utf8',
    );
}

test('open prefers the deployed app url inside a project', async () => {
    const tempDir = makeTempDir();

    try {
        const mockPath = writeFetchMock(
            tempDir,
            `
                const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
                    status,
                    headers: { 'Content-Type': 'application/json' },
                });

                globalThis.fetch = async (input) => {
                    const url = typeof input === 'string'
                        ? input
                        : input instanceof URL
                          ? input.href
                          : input.url;

                    if (url.includes('/api/v1/apps?') && url.includes('stack=demo-app')) {
                        return json({
                            data: [
                                {
                                    id: 'app_123',
                                    workspace_id: 'ws_personal',
                                    stack: 'demo-app',
                                    status: 'live',
                                    server: { id: 'srv_123', name: 'demo-server' },
                                },
                            ],
                        });
                    }

                    if (url.endsWith('/api/v1/apps/app_123')) {
                        return json({
                            data: {
                                id: 'app_123',
                                stack: 'demo-app',
                                browser_url: 'https://demo-app.onramp.sh',
                                dashboard_url: 'https://ramp.sh/servers/srv_123/apps/app_123',
                            },
                        });
                    }

                    throw new Error('Unexpected fetch ' + url);
                };
            `,
        );

        const homeDir = path.join(tempDir, 'home');
        writeCredentials(homeDir);
        writeFileSync(path.join(tempDir, 'ramp.yaml'), 'stack: demo-app\n', 'utf8');

        const result = runCli(['open'], tempDir, {
            HOME: homeDir,
            NODE_OPTIONS: `--import=${mockPath}`,
            RAMP_DISABLE_BROWSER_OPEN: '1',
        });

        assert.equal(result.status, 0);
        assert.match(result.stdout, /URL: https:\/\/demo-app\.onramp\.sh/);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test('open falls back to the app dashboard when no deployed app url exists yet', async () => {
    const tempDir = makeTempDir();

    try {
        const mockPath = writeFetchMock(
            tempDir,
            `
                const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
                    status,
                    headers: { 'Content-Type': 'application/json' },
                });

                globalThis.fetch = async (input) => {
                    const url = typeof input === 'string'
                        ? input
                        : input instanceof URL
                          ? input.href
                          : input.url;

                    if (url.includes('/api/v1/apps?') && url.includes('stack=demo-app')) {
                        return json({
                            data: [
                                {
                                    id: 'app_123',
                                    workspace_id: 'ws_personal',
                                    stack: 'demo-app',
                                    status: 'pending',
                                    server: { id: 'srv_123', name: 'demo-server' },
                                },
                            ],
                        });
                    }

                    if (url.endsWith('/api/v1/apps/app_123')) {
                        return json({
                            data: {
                                id: 'app_123',
                                stack: 'demo-app',
                                browser_url: null,
                                dashboard_url: 'https://ramp.sh/servers/srv_123/apps/app_123',
                            },
                        });
                    }

                    throw new Error('Unexpected fetch ' + url);
                };
            `,
        );

        const homeDir = path.join(tempDir, 'home');
        writeCredentials(homeDir);
        writeFileSync(path.join(tempDir, 'ramp.yaml'), 'stack: demo-app\n', 'utf8');

        const result = runCli(['open'], tempDir, {
            HOME: homeDir,
            NODE_OPTIONS: `--import=${mockPath}`,
            RAMP_DISABLE_BROWSER_OPEN: '1',
        });

        assert.equal(result.status, 0);
        assert.match(result.stdout, /URL: https:\/\/ramp\.sh\/servers\/srv_123\/apps\/app_123/);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test('open falls back to the main dashboard when outside a project', async () => {
    const tempDir = makeTempDir();

    try {
        const mockPath = writeFetchMock(
            tempDir,
            `
                const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
                    status,
                    headers: { 'Content-Type': 'application/json' },
                });

                globalThis.fetch = async (input) => {
                    const url = typeof input === 'string'
                        ? input
                        : input instanceof URL
                          ? input.href
                          : input.url;

                    if (url.endsWith('/api/v1/auth/me')) {
                        return json({
                            user: {
                                email: 'tiago@example.com',
                                name: 'Tiago',
                            },
                            current_workspace_id: 'ws_personal',
                            dashboard_url: 'https://ramp.sh/dashboard',
                        });
                    }

                    throw new Error('Unexpected fetch ' + url);
                };
            `,
        );

        const homeDir = path.join(tempDir, 'home');
        writeCredentials(homeDir);

        const result = runCli(['open'], tempDir, {
            HOME: homeDir,
            NODE_OPTIONS: `--import=${mockPath}`,
            RAMP_DISABLE_BROWSER_OPEN: '1',
        });

        assert.equal(result.status, 0);
        assert.match(result.stdout, /URL: https:\/\/ramp\.sh\/dashboard/);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test('dashboard opens the app dashboard inside a project', async () => {
    const tempDir = makeTempDir();

    try {
        const mockPath = writeFetchMock(
            tempDir,
            `
                const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
                    status,
                    headers: { 'Content-Type': 'application/json' },
                });

                globalThis.fetch = async (input) => {
                    const url = typeof input === 'string'
                        ? input
                        : input instanceof URL
                          ? input.href
                          : input.url;

                    if (url.includes('/api/v1/apps?') && url.includes('stack=demo-app')) {
                        return json({
                            data: [
                                {
                                    id: 'app_123',
                                    workspace_id: 'ws_personal',
                                    stack: 'demo-app',
                                    status: 'live',
                                    server: { id: 'srv_123', name: 'demo-server' },
                                },
                            ],
                        });
                    }

                    if (url.endsWith('/api/v1/apps/app_123')) {
                        return json({
                            data: {
                                id: 'app_123',
                                stack: 'demo-app',
                                browser_url: 'https://demo-app.onramp.sh',
                                dashboard_url: 'https://ramp.sh/servers/srv_123/apps/app_123',
                            },
                        });
                    }

                    throw new Error('Unexpected fetch ' + url);
                };
            `,
        );

        const homeDir = path.join(tempDir, 'home');
        writeCredentials(homeDir);
        writeFileSync(path.join(tempDir, 'ramp.yaml'), 'stack: demo-app\n', 'utf8');

        const result = runCli(['dashboard'], tempDir, {
            HOME: homeDir,
            NODE_OPTIONS: `--import=${mockPath}`,
            RAMP_DISABLE_BROWSER_OPEN: '1',
        });

        assert.equal(result.status, 0);
        assert.match(result.stdout, /URL: https:\/\/ramp\.sh\/servers\/srv_123\/apps\/app_123/);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});
