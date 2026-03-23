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

function makeTempDir(prefix = 'ramp-cli-mcp-test-') {
    return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFetchMock(tempDir, responseInit, responseBody) {
    const mockPath = path.join(tempDir, 'mock-fetch.mjs');
    writeFileSync(
        mockPath,
        `globalThis.fetch = async () => new Response(${JSON.stringify(
            JSON.stringify(responseBody),
        )}, ${JSON.stringify({
            ...responseInit,
            headers: {
                'Content-Type': 'application/json',
            },
        })});\n`,
        'utf8',
    );

    return mockPath;
}

test('mcp:login prints MCP connection details from stored credentials', async () => {
    const tempDir = makeTempDir();

    try {
        const mockPath = writeFetchMock(
            tempDir,
            { status: 200 },
            {
                user: {
                    email: 'tiago@example.com',
                },
                current_workspace_id: 'ws_personal',
            },
        );
        const homeDir = path.join(tempDir, 'home');
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

        const result = runCli(['mcp:login', '--json'], tempDir, {
            HOME: homeDir,
            NODE_OPTIONS: `--import=${mockPath}`,
        });

        assert.equal(result.status, 0);

        const payload = JSON.parse(result.stdout);

        assert.equal(payload.ok, true);
        assert.equal(payload.url, 'https://api.ramp.sh/mcp/ramp');
        assert.equal(payload.authorization, 'Bearer rmp_cli_test_token');
        assert.equal(payload.token, 'rmp_cli_test_token');
        assert.equal(payload.email, 'tiago@example.com');
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test('mcp:cursor prints a ready-to-paste MCP config snippet', async () => {
    const tempDir = makeTempDir();

    try {
        const mockPath = writeFetchMock(
            tempDir,
            { status: 200 },
            {
                user: {
                    email: 'tiago@example.com',
                },
                current_workspace_id: 'ws_personal',
            },
        );
        const homeDir = path.join(tempDir, 'home');
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

        const result = runCli(['mcp:cursor', '--json'], tempDir, {
            HOME: homeDir,
            NODE_OPTIONS: `--import=${mockPath}`,
        });

        assert.equal(result.status, 0);

        const payload = JSON.parse(result.stdout);

        assert.deepEqual(payload, {
            mcpServers: {
                ramp: {
                    url: 'https://api.ramp.sh/mcp/ramp',
                    headers: {
                        Authorization: 'Bearer rmp_cli_test_token',
                    },
                },
            },
        });
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test('mcp:login rejects stale stored credentials', async () => {
    const tempDir = makeTempDir();

    try {
        const mockPath = writeFetchMock(
            tempDir,
            { status: 401 },
            {
                error: 'Unauthorized',
            },
        );
        const apiUrl = 'https://api.ramp.sh';
        const homeDir = path.join(tempDir, 'home');
        const configDir = path.join(homeDir, '.config', 'ramp');
        mkdirSync(configDir, { recursive: true });
        writeFileSync(
            path.join(configDir, 'credentials.json'),
            `${JSON.stringify(
                {
                    token: 'rmp_cli_test_token',
                    apiUrl,
                    email: 'tiago@example.com',
                    selectedWorkspaceId: 'ws_personal',
                    updatedAt: new Date().toISOString(),
                },
                null,
                2,
            )}\n`,
            'utf8',
        );

        const result = runCli(['mcp:login', '--json'], tempDir, {
            HOME: homeDir,
            NODE_OPTIONS: `--import=${mockPath}`,
        });

        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
        assert.match(result.stderr, /Authentication failed\. Run `ramp login` again\./);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test('mcp:cursor rejects stale stored credentials', async () => {
    const tempDir = makeTempDir();

    try {
        const mockPath = writeFetchMock(
            tempDir,
            { status: 401 },
            {
                error: 'Unauthorized',
            },
        );
        const apiUrl = 'https://api.ramp.sh';
        const homeDir = path.join(tempDir, 'home');
        const configDir = path.join(homeDir, '.config', 'ramp');
        mkdirSync(configDir, { recursive: true });
        writeFileSync(
            path.join(configDir, 'credentials.json'),
            `${JSON.stringify(
                {
                    token: 'rmp_cli_test_token',
                    apiUrl,
                    email: 'tiago@example.com',
                    selectedWorkspaceId: 'ws_personal',
                    updatedAt: new Date().toISOString(),
                },
                null,
                2,
            )}\n`,
            'utf8',
        );

        const result = runCli(['mcp:cursor', '--json'], tempDir, {
            HOME: homeDir,
            NODE_OPTIONS: `--import=${mockPath}`,
        });

        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
        assert.match(result.stderr, /Authentication failed\. Run `ramp login` again\./);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test('whoami --show-token prints stored token details without an API request', async () => {
    const tempDir = makeTempDir();

    try {
        const homeDir = path.join(tempDir, 'home');
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

        const result = runCli(['whoami', '--show-token', '--json'], tempDir, {
            HOME: homeDir,
        });

        assert.equal(result.status, 0);

        const payload = JSON.parse(result.stdout);

        assert.equal(payload.user.email, 'tiago@example.com');
        assert.equal(payload.apiUrl, 'https://api.ramp.sh');
        assert.equal(payload.token, 'rmp_cli_test_token');
        assert.equal(
            payload.authorization,
            'Bearer rmp_cli_test_token',
        );
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});
