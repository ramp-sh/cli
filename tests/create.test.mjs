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

function makeTempDir(prefix = 'ramp-cli-create-test-') {
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

test('create command rejects selecting a non-active server', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');
  const capturePath = path.join(tempDir, 'capture.json');

  try {
    seedCredentials(homeDir, 'https://api.example.test');

    const result = runCli(
      ['create', '--source', 'upload', '--server', 'pretty-osmium', '--name', 'demo-app'],
      tempDir,
      {
        HOME: homeDir,
        RAMP_FETCH_CAPTURE: capturePath,
        RAMP_FETCH_FIXTURES: JSON.stringify([
          {
            url: 'https://api.example.test/api/v1/servers',
            method: 'GET',
            status: 200,
            body: {
              data: [
                {
                  id: 'srv_active',
                  name: 'magic-boron',
                  status: 'active',
                  cloud_provider_name: 'vultr',
                },
                {
                  id: 'srv_error',
                  name: 'pretty-osmium',
                  status: 'error',
                  cloud_provider_name: 'digitalocean',
                },
              ],
            },
          },
        ]),
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Server 'pretty-osmium' is not active yet\./);

    const captures = JSON.parse(readFileSync(capturePath, 'utf8'));
    assert.equal(captures[0].headers['x-ramp-workspace'], 'ws_personal');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('interactive create source cancellation stays cancelled', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { resolveInteractiveCreateSourceSelection } from ${JSON.stringify(path.join(rootDir, 'src', 'lib', 'create-source.ts'))};

    assert.equal(resolveInteractiveCreateSourceSelection('repo'), 'repo');
    assert.equal(resolveInteractiveCreateSourceSelection('upload'), 'upload');
    assert.equal(resolveInteractiveCreateSourceSelection(null), null);
  `;

  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script],
    {
      cwd: rootDir,
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
});
