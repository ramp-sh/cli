import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

const rootDir = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(rootDir, 'dist', 'bin.js');

function runCli(args, cwd, env = {}, input) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: `--import=${path.join(rootDir, 'tests', 'support', 'mock-fetch.mjs')}`,
      ...env,
    },
    input,
  });
}

function makeTempDir(prefix = 'ramp-cli-import-test-') {
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

test('import render writes ramp.yaml from a local file', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');
  const capturePath = path.join(tempDir, 'capture.json');

  try {
    seedCredentials(homeDir, 'https://api.example.test');
    writeFileSync(
      path.join(tempDir, 'render.yaml'),
      'services:\n  - type: web\n    name: api\n    runtime: node\n',
      'utf8',
    );

    const result = runCli(['import', 'render', 'render.yaml'], tempDir, {
      HOME: homeDir,
      RAMP_FETCH_CAPTURE: capturePath,
      RAMP_FETCH_FIXTURES: JSON.stringify([
        {
          url: 'https://api.example.test/api/v1/blueprints/import',
          method: 'POST',
          status: 200,
          body: {
            ok: true,
            data: {
              provider: 'render',
              source_type: 'raw',
              ramp_yaml:
                'stack: imported\nservices:\n  api:\n    type: web\n    runtime: node@24\n    start: node server.js\n    port: 3000\n',
              warnings: ['Defaulted node version to 24.'],
              unsupported: [],
              detected: {
                stack: 'imported',
                services: [{ name: 'api' }],
                resources: [],
              },
            },
          },
        },
      ]),
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Wrote ramp\.yaml/);
    assert.match(readFileSync(path.join(tempDir, 'ramp.yaml'), 'utf8'), /stack: imported/);
    const captures = JSON.parse(readFileSync(capturePath, 'utf8'));
    assert.equal(captures[0].headers.authorization, 'Bearer rmp_cli_test_token');
    assert.equal(captures[0].body.provider, 'render');
    assert.equal(captures[0].body.source_type, 'raw');
    assert.match(captures[0].body.content, /services:/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('import render supports stdin mode', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');
  const capturePath = path.join(tempDir, 'capture.json');

  try {
    seedCredentials(homeDir, 'https://api.example.test');

    const result = runCli(
      ['import', 'render', '--stdin'],
      tempDir,
      {
        HOME: homeDir,
        RAMP_FETCH_CAPTURE: capturePath,
        RAMP_FETCH_FIXTURES: JSON.stringify([
          {
            url: 'https://api.example.test/api/v1/blueprints/import',
            method: 'POST',
            status: 200,
            body: {
              ok: true,
              data: {
                provider: 'render',
                source_type: 'raw',
                ramp_yaml:
                  'stack: stdin-app\nservices:\n  api:\n    type: worker\n    runtime: python@3.14\n    start: python worker.py\n',
                warnings: [],
                unsupported: [],
                detected: {
                  stack: 'stdin-app',
                  services: [{ name: 'api' }],
                  resources: [],
                },
              },
            },
          },
        ]),
      },
      'services:\n  - type: worker\n    name: from stdin\n',
    );

    assert.equal(result.status, 0);
    assert.match(readFileSync(path.join(tempDir, 'ramp.yaml'), 'utf8'), /stack: stdin-app/);
    const captures = JSON.parse(readFileSync(capturePath, 'utf8'));
    assert.equal(captures[0].body.source_type, 'raw');
    assert.match(captures[0].body.content, /from stdin/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('import render refuses to overwrite ramp.yaml without --force', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');

  try {
    seedCredentials(homeDir, 'https://api.example.test');
    writeFileSync(path.join(tempDir, 'render.yaml'), 'services: []\n', 'utf8');
    writeFileSync(path.join(tempDir, 'ramp.yaml'), 'stack: existing\n', 'utf8');

    const result = runCli(['import', 'render', 'render.yaml'], tempDir, {
      HOME: homeDir,
      RAMP_FETCH_FIXTURES: JSON.stringify([
        {
          url: 'https://api.example.test/api/v1/blueprints/import',
          method: 'POST',
          status: 200,
          body: {
            ok: true,
            data: {
              provider: 'render',
              source_type: 'raw',
              ramp_yaml:
                'stack: imported\nservices:\n  api:\n    type: web\n    runtime: node@24\n    start: node server.js\n    port: 3000\n',
              warnings: [],
              unsupported: [],
              detected: {
                stack: 'imported',
                services: [{ name: 'api' }],
                resources: [],
              },
            },
          },
        },
      ]),
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /already exists/);
    assert.equal(readFileSync(path.join(tempDir, 'ramp.yaml'), 'utf8'), 'stack: existing\n');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('import render supports repo mode and json output', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');
  const capturePath = path.join(tempDir, 'capture.json');

  try {
    seedCredentials(homeDir, 'https://api.example.test');

    const result = runCli(
      [
        'import',
        'render',
        '--repo',
        'acme/demo',
        '--branch',
        'main',
        '--path',
        'render.yaml',
        '--json',
      ],
      tempDir,
      {
        HOME: homeDir,
        RAMP_FETCH_CAPTURE: capturePath,
        RAMP_FETCH_FIXTURES: JSON.stringify([
          {
            url: 'https://api.example.test/api/v1/blueprints/import',
            method: 'POST',
            status: 200,
            body: {
              ok: true,
              data: {
                provider: 'render',
                source_type: 'github',
                ramp_yaml:
                  'stack: repo-app\nservices:\n  api:\n    type: web\n    runtime: go@1.26\n    start: ./api\n    port: 3000\n',
                warnings: ['Normalized Go version.'],
                unsupported: [],
                source_meta: { path: 'render.yaml' },
                detected: {
                  stack: 'repo-app',
                  services: [{ name: 'api' }],
                  resources: [],
                },
              },
            },
          },
        ]),
      },
    );

    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.ok, true);
    assert.equal(payload.output, 'ramp.yaml');
    assert.equal(payload.data.source_type, 'github');
    assert.equal(payload.data.detected.stack, 'repo-app');
    const captures = JSON.parse(readFileSync(capturePath, 'utf8'));
    assert.equal(captures[0].body.repo, 'acme/demo');
    assert.equal(captures[0].body.branch, 'main');
    assert.equal(captures[0].body.path, 'render.yaml');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('import render supports stdout mode', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');

  try {
    seedCredentials(homeDir, 'https://api.example.test');
    writeFileSync(path.join(tempDir, 'render.yaml'), 'services: []\n', 'utf8');

    const result = runCli(['import', 'render', 'render.yaml', '--stdout'], tempDir, {
      HOME: homeDir,
      RAMP_FETCH_FIXTURES: JSON.stringify([
        {
          url: 'https://api.example.test/api/v1/blueprints/import',
          method: 'POST',
          status: 200,
          body: {
            ok: true,
            data: {
              provider: 'render',
              source_type: 'raw',
              ramp_yaml:
                'stack: stdout-app\nservices:\n  api:\n    type: web\n    runtime: node@24\n    start: node server.js\n    port: 3000\n',
              warnings: [],
              unsupported: [],
              detected: {
                stack: 'stdout-app',
                services: [{ name: 'api' }],
                resources: [],
              },
            },
          },
        },
      ]),
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /stack: stdout-app/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
