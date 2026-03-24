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

function makeTempDir(prefix = 'ramp-cli-db-import-test-') {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function seedCredentials(
  homeDir,
  apiUrl = 'https://api.example.test',
  selectedWorkspaceId = 'ws_pro',
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

function writeDumpFile(dir, fileName, contents = 'select 1;\n') {
  const filePath = path.join(dir, fileName);
  writeFileSync(filePath, contents, 'utf8');

  return filePath;
}

test('db:import fails fast when the local dump file is missing', async () => {
  const tempDir = makeTempDir();

  try {
    const result = runCli(['db:import', '--file', path.join(tempDir, 'missing.sql')], tempDir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Cannot read import file:/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('db:import rejects unsupported local file extensions before any API call', async () => {
  const tempDir = makeTempDir();
  const filePath = writeDumpFile(tempDir, 'render-export.txt');

  try {
    const result = runCli(['db:import', '--file', filePath], tempDir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported dump file/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('db:import uploads multipart form data with the selected resource', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');
  const capturePath = path.join(tempDir, 'capture.json');
  const dumpPath = writeDumpFile(tempDir, 'render-export.sql');

  try {
    seedCredentials(homeDir);
    seedProjectLink(tempDir, 'app_123', 'go-api');

    const result = runCli(['db:import', '--file', dumpPath, '--json'], tempDir, {
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
            },
          },
        },
        {
          url: 'https://api.example.test/api/v1/apps/app_123',
          method: 'GET',
          status: 200,
          body: {
            data: {
              id: 'app_123',
              stack: 'go-api',
              sql_resources: [{ name: 'db', type: 'postgres' }],
            },
          },
        },
        {
          url: 'https://api.example.test/api/v1/apps/app_123/db/imports',
          method: 'POST',
          status: 202,
          body: {
            ok: true,
            import: {
              id: 'imp_123',
              status: 'pending',
              resource: 'db',
              restore_format: 'sql',
            },
          },
        },
      ]),
    });

    assert.equal(result.status, 0);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.import.id, 'imp_123');

    const captures = JSON.parse(readFileSync(capturePath, 'utf8'));
    assert.equal(captures[2].headers['x-ramp-workspace'], 'ws_pro');
    assert.equal(captures[2].body.__formData.resource, 'db');
    assert.equal(captures[2].body.__formData.dump.name, 'render-export.sql');
    assert.ok(captures[2].body.__formData.dump.size > 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('db:import requires --resource when the app has multiple sql resources', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');
  const dumpPath = writeDumpFile(tempDir, 'render-export.sql');

  try {
    seedCredentials(homeDir);
    seedProjectLink(tempDir, 'app_123', 'go-api');

    const result = runCli(['db:import', '--file', dumpPath], tempDir, {
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
        {
          url: 'https://api.example.test/api/v1/apps/app_123',
          method: 'GET',
          status: 200,
          body: {
            data: {
              id: 'app_123',
              stack: 'go-api',
              sql_resources: [
                { name: 'analytics', type: 'postgres' },
                { name: 'primary', type: 'mysql' },
              ],
            },
          },
        },
      ]),
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Provide --resource/);
    assert.match(result.stderr, /analytics/);
    assert.match(result.stderr, /primary/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('db:import returns JSON output for queued imports', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');
  const dumpPath = writeDumpFile(tempDir, 'render-export.sql.gz');

  try {
    seedCredentials(homeDir);
    seedProjectLink(tempDir, 'app_123', 'go-api');

    const result = runCli(
      ['db:import', '--file', dumpPath, '--resource', 'db', '--json'],
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
          {
            url: 'https://api.example.test/api/v1/apps/app_123',
            method: 'GET',
            status: 200,
            body: {
              data: {
                id: 'app_123',
                stack: 'go-api',
                sql_resources: [{ name: 'db', type: 'mysql' }],
              },
            },
          },
          {
            url: 'https://api.example.test/api/v1/apps/app_123/db/imports',
            method: 'POST',
            status: 202,
            body: {
              ok: true,
              import: {
                id: 'imp_456',
                status: 'pending',
                resource: 'db',
                restore_format: 'sql.gz',
              },
            },
          },
        ]),
      },
    );

    assert.equal(result.status, 0);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.import.id, 'imp_456');
    assert.equal(payload.import.restore_format, 'sql.gz');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
