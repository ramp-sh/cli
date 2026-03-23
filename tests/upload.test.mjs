import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

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

function makeTempDir(prefix = 'ramp-cli-upload-test-') {
    return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function seedCredentials(
    homeDir,
    apiUrl = 'http://127.0.0.1:0',
    selectedWorkspaceId = 'ws_free',
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

test('upload fails fast when ramp.yaml enables octane but local project is not octane-ready', async () => {
    const tempDir = makeTempDir();

    try {
        writeFileSync(
            path.join(tempDir, 'ramp.yaml'),
            [
                'stack: octane-app',
                'services:',
                '  web:',
                '    type: web',
                '    runtime: php@8.4',
                '    port: 8000',
                '    octane:',
                '      server: frankenphp',
                '',
            ].join('\n'),
            'utf8',
        );

        const result = runCli(['upload'], tempDir);

        assert.equal(result.status, 1);
        assert.match(
            result.stderr,
            /Laravel Octane is configured in ramp\.yaml, but this project is not Octane-ready\./,
        );
        assert.match(
            result.stderr,
            /Missing `composer\.json` dependency `laravel\/octane`\./,
        );
        assert.match(result.stderr, /Missing `config\/octane\.php`\./);
        assert.doesNotMatch(result.stderr, /Not logged in/);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test('upload blocks when linked app belongs to another workspace', async () => {
    const tempDir = makeTempDir();
    const homeDir = path.join(tempDir, 'home');

    try {
        seedCredentials(homeDir, 'https://api.example.test', 'ws_free');
        seedProjectLink(tempDir);
        writeFileSync(
            path.join(tempDir, 'ramp.yaml'),
            ['stack: go-api', 'services:', '  web:', '    type: web', '    runtime: go@1.24', '    port: 8080'].join('\n'),
            'utf8',
        );

        const result = runCli(
            ['upload'],
            tempDir,
            {
                HOME: homeDir,
                RAMP_FETCH_FIXTURES: JSON.stringify([
                    {
                        url: 'https://api.example.test/api/v1/apps/app_123',
                        method: 'GET',
                        status: 200,
                        body: {
                            data: {
                                id: 'app_123',
                                workspace_id: 'ws_pro',
                                stack: 'go-api',
                                status: 'live',
                            },
                        },
                    },
                ]),
            },
        );

        assert.equal(result.status, 1);
        assert.match(
            result.stderr,
            /This linked project belongs to a different CLI workspace\./,
        );
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test('upload sends the selected workspace header on the action request', async () => {
    const tempDir = makeTempDir();
    const homeDir = path.join(tempDir, 'home');
    const capturePath = path.join(tempDir, 'capture.json');

    try {
        seedCredentials(homeDir, 'https://api.example.test', 'ws_pro');
        seedProjectLink(tempDir);
        writeFileSync(
            path.join(tempDir, 'ramp.yaml'),
            ['stack: go-api', 'services:', '  web:', '    type: web', '    runtime: go@1.24', '    port: 8080'].join('\n'),
            'utf8',
        );
        writeFileSync(path.join(tempDir, 'main.go'), 'package main\nfunc main() {}\n', 'utf8');

        const result = runCli(
            ['upload'],
            tempDir,
            {
                HOME: homeDir,
                RAMP_FETCH_CAPTURE: capturePath,
                RAMP_FETCH_FIXTURES: JSON.stringify([
                    {
                        url: 'https://api.example.test/api/v1/apps/app_123',
                        method: 'GET',
                        status: 200,
                        body: {
                            data: {
                                id: 'app_123',
                                workspace_id: 'ws_pro',
                                stack: 'go-api',
                                status: 'live',
                                deploy_mode: 'upload',
                            },
                        },
                    },
                    {
                        url: 'https://api.example.test/api/v1/apps/app_123/upload',
                        method: 'POST',
                        status: 200,
                        body: {
                            ok: true,
                            deploy: {
                                id: 'dep_123',
                                release_id: 'upl_123',
                                status: 'pending',
                                trigger: 'cli_upload',
                                config_synced: false,
                            },
                        },
                    },
                ]),
            },
        );

        assert.equal(result.status, 0);

        const captures = JSON.parse(readFileSync(capturePath, 'utf8'));
        assert.equal(captures[0].headers['x-ramp-workspace'], 'ws_pro');
        assert.equal(captures[1].headers['x-ramp-workspace'], 'ws_pro');
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});
