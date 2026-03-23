import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

const rootDir = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(rootDir, 'dist', 'bin.js');

function runCli(args, cwd, env = {}) {
    return spawnSync(process.execPath, [cliPath, ...args], {
        cwd,
        encoding: 'utf8',
        env: {
            ...process.env,
            NODE_OPTIONS: `--import=${path.join(rootDir, 'tests', 'support', 'mock-fetch.mjs')}`,
            ...env,
        },
    });
}

function makeTempDir(prefix = 'ramp-cli-workspace-test-') {
    return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function seedCredentials(
    homeDir,
    apiUrl = 'http://127.0.0.1:0',
    selectedWorkspaceId = 'ws_personal',
) {
    const configDir = path.join(homeDir, '.config', 'ramp');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
        path.join(configDir, 'credentials.json'),
        `${JSON.stringify(
            {
                token: 'rmp_cli_test_token',
                apiUrl,
                email: 'tiago@example.com',
                selectedWorkspaceId,
                updatedAt: new Date().toISOString(),
            },
            null,
            2,
        )}\n`,
        'utf8',
    );
}

function seedProjectLink(cwd, appId = 'app_123', stack = 'linked-app') {
    const linkDir = path.join(cwd, '.ramp');
    mkdirSync(linkDir, { recursive: true });
    writeFileSync(
        path.join(linkDir, 'config.json'),
        `${JSON.stringify(
            {
                app_id: appId,
                server_id: 'srv_123',
                stack,
                linked_at: new Date().toISOString(),
            },
            null,
            2,
        )}\n`,
        'utf8',
    );
}

test('workspace command lists accessible workspaces as json', async () => {
    const tempDir = makeTempDir();
    const homeDir = path.join(tempDir, 'home');

    try {
        seedCredentials(homeDir, 'https://api.example.test');

        const result = runCli(
            ['workspace', '--json'],
            tempDir,
            {
                HOME: homeDir,
                RAMP_FETCH_FIXTURES: JSON.stringify([
                    {
                        url: 'https://api.example.test/api/v1/workspaces',
                        method: 'GET',
                        status: 200,
                        body: {
                            data: [
                                {
                                    id: 'ws_personal',
                                    name: 'Personal',
                                    is_personal: true,
                                    is_current: true,
                                    role: 'owner',
                                    plan: 'solo',
                                },
                                {
                                    id: 'ws_agency',
                                    name: 'Agency',
                                    is_personal: false,
                                    is_current: false,
                                    role: 'owner',
                                    plan: 'team',
                                },
                            ],
                        },
                    },
                ]),
            },
        );

        assert.equal(result.status, 0);
        assert.deepEqual(JSON.parse(result.stdout), {
            data: [
                {
                    id: 'ws_personal',
                    name: 'Personal',
                    is_personal: true,
                    is_current: true,
                    role: 'owner',
                    plan: 'solo',
                },
                {
                    id: 'ws_agency',
                    name: 'Agency',
                    is_personal: false,
                    is_current: false,
                    role: 'owner',
                    plan: 'team',
                },
            ],
        });
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test('workspace command switches by name', async () => {
    const tempDir = makeTempDir();
    const homeDir = path.join(tempDir, 'home');
    const capturePath = path.join(tempDir, 'capture.json');

    try {
        seedCredentials(homeDir, 'https://api.example.test');

        const result = runCli(
            ['workspace', 'Agency'],
            tempDir,
            {
                HOME: homeDir,
                RAMP_FETCH_CAPTURE: capturePath,
                RAMP_FETCH_FIXTURES: JSON.stringify([
                    {
                        url: 'https://api.example.test/api/v1/workspaces',
                        method: 'GET',
                        status: 200,
                        body: {
                            data: [
                                {
                                    id: 'ws_personal',
                                    name: 'Personal',
                                    is_personal: true,
                                    is_current: true,
                                    role: 'owner',
                                    plan: 'solo',
                                },
                                {
                                    id: 'ws_agency',
                                    name: 'Agency',
                                    is_personal: false,
                                    is_current: false,
                                    role: 'owner',
                                    plan: 'team',
                                },
                            ],
                        },
                    },
                    {
                        url: 'https://api.example.test/api/v1/workspaces/ws_agency/switch',
                        method: 'POST',
                        status: 200,
                        body: {
                            data: {
                                id: 'ws_agency',
                                name: 'Agency',
                                is_personal: false,
                                role: 'owner',
                                plan: 'team',
                            },
                        },
                    },
                ]),
            },
        );

        assert.equal(result.status, 0);
        assert.match(result.stdout, /Current workspace: Agency/);

        const captures = JSON.parse(readFileSync(capturePath, 'utf8'));
        assert.equal(captures[1].url, 'https://api.example.test/api/v1/workspaces/ws_agency/switch');
        assert.equal(captures[1].method, 'POST');
        assert.equal(captures[1].headers.authorization, 'Bearer rmp_cli_test_token');
        assert.equal(captures[0].headers['x-ramp-workspace'], 'ws_personal');
        assert.equal(captures[1].headers['x-ramp-workspace'], 'ws_personal');

        const savedCredentials = JSON.parse(
            readFileSync(
                path.join(homeDir, '.config', 'ramp', 'credentials.json'),
                'utf8',
            ),
        );

        assert.equal(savedCredentials.selectedWorkspaceId, 'ws_agency');
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test('login seeds the selected workspace from the api profile', async () => {
    const tempDir = makeTempDir();
    const homeDir = path.join(tempDir, 'home');

    try {
        const result = runCli(
            ['login', '--token', 'rmp_login_token', '--api-url', 'https://api.example.test'],
            tempDir,
            {
                HOME: homeDir,
                RAMP_FETCH_FIXTURES: JSON.stringify([
                    {
                        url: 'https://api.example.test/api/v1/auth/me',
                        method: 'GET',
                        status: 200,
                        body: {
                            user: {
                                email: 'tiago@example.com',
                                name: 'Tiago',
                            },
                            current_workspace_id: 'ws_seeded',
                        },
                    },
                ]),
            },
        );

        assert.equal(result.status, 0);

        const savedCredentials = JSON.parse(
            readFileSync(
                path.join(homeDir, '.config', 'ramp', 'credentials.json'),
                'utf8',
            ),
        );

        assert.equal(savedCredentials.selectedWorkspaceId, 'ws_seeded');
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test('apps command prints a friendly auth error', async () => {
    const tempDir = makeTempDir();
    const homeDir = path.join(tempDir, 'home');

    try {
        seedCredentials(homeDir, 'https://api.example.test');

        const result = runCli(
            ['apps'],
            tempDir,
            {
                HOME: homeDir,
                RAMP_FETCH_FIXTURES: JSON.stringify([
                    {
                        url: 'https://api.example.test/api/v1/apps',
                        method: 'GET',
                        status: 401,
                        body: {
                            message: 'Unauthenticated.',
                        },
                    },
                ]),
            },
        );

        assert.equal(result.status, 1);
        assert.match(
            result.stderr,
            /Authentication failed\. Run `ramp login` again\./,
        );
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test('status command prints a friendly subscription error for linked apps', async () => {
    const tempDir = makeTempDir();
    const homeDir = path.join(tempDir, 'home');

    try {
        seedCredentials(homeDir, 'https://api.example.test');
        seedProjectLink(tempDir);

        const result = runCli(
            ['status'],
            tempDir,
            {
                HOME: homeDir,
                RAMP_FETCH_FIXTURES: JSON.stringify([
                    {
                        url: 'https://api.example.test/api/v1/apps/app_123',
                        method: 'GET',
                        status: 402,
                        body: {
                            error: 'subscription_required',
                            message: 'This workspace requires an active subscription',
                        },
                    },
                ]),
            },
        );

        assert.equal(result.status, 1);
        assert.match(
            result.stderr,
            /Use `ramp workspace` to switch workspaces or visit your dashboard to subscribe\./,
        );
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});
