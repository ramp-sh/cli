import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

const rootDir = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(rootDir, 'dist', 'bin.js');
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

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

function makeTempDir(prefix = 'ramp-cli-audit-test-') {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function seedCredentials(
  homeDir,
  apiUrl = 'https://api.example.test',
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

test('validate defaults to the production API host', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');

  try {
    seedCredentials(homeDir, 'https://api.example.test');
    writeFileSync(path.join(tempDir, 'ramp.yaml'), 'stack: audit-test\n', 'utf8');

    const result = runCli(['validate', '--json'], tempDir, {
      HOME: homeDir,
      RAMP_FETCH_FIXTURES: JSON.stringify([
        {
          url: 'https://api.ramp.sh/api/v1/validate',
          method: 'POST',
          status: 200,
          body: {
            valid: true,
            errors: [],
            warnings: [],
          },
        },
      ]),
    });

    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: true,
      errors: [],
      warnings: [],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('exec prints API validation messages instead of a generic fallback', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');

  try {
    seedCredentials(homeDir);
    seedProjectLink(tempDir);

    const result = runCli(['exec', 'php artisan about'], tempDir, {
      HOME: homeDir,
      RAMP_FETCH_FIXTURES: JSON.stringify([
        {
          url: 'https://api.example.test/api/v1/apps/app_123',
          method: 'GET',
          status: 200,
          body: {
            data: {
              id: 'app_123',
              workspace_id: 'ws_personal',
              stack: 'linked-app',
              status: 'ready',
            },
          },
        },
        {
          url: 'https://api.example.test/api/v1/apps/app_123/commands/exec',
          method: 'POST',
          status: 422,
          body: {
            message: 'Saved command is not allowed on this service.',
          },
        },
      ]),
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Saved command is not allowed on this service\./);
    assert.doesNotMatch(result.stderr, /Failed to run command \(HTTP 422\)/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('env pull writes .env files with private permissions', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');
  const outputPath = path.join(tempDir, '.env');

  try {
    seedCredentials(homeDir);
    seedProjectLink(tempDir);

    const result = runCli(['env', 'pull', '--output', outputPath], tempDir, {
      HOME: homeDir,
      RAMP_FETCH_FIXTURES: JSON.stringify([
        {
          url: 'https://api.example.test/api/v1/apps/app_123',
          method: 'GET',
          status: 200,
          body: {
            data: {
              id: 'app_123',
              workspace_id: 'ws_personal',
              stack: 'linked-app',
              status: 'ready',
            },
          },
        },
        {
          url: 'https://api.example.test/api/v1/apps/app_123/env/export',
          method: 'GET',
          status: 200,
          body: {
            content: 'APP_ENV=production',
          },
        },
      ]),
    });

    assert.equal(result.status, 0);
    assert.equal(readFileSync(outputPath, 'utf8'), 'APP_ENV=production\n');
    assert.equal(statSync(outputPath).mode & 0o777, 0o600);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('env push reports a missing file clearly', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');

  try {
    seedCredentials(homeDir);
    seedProjectLink(tempDir);

    const result = runCli(['env', 'push', '--file', 'missing.env'], tempDir, {
      HOME: homeDir,
      RAMP_FETCH_FIXTURES: JSON.stringify([
        {
          url: 'https://api.example.test/api/v1/apps/app_123',
          method: 'GET',
          status: 200,
          body: {
            data: {
              id: 'app_123',
              workspace_id: 'ws_personal',
              stack: 'linked-app',
              status: 'ready',
            },
          },
        },
      ]),
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Env file not found: missing\.env/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('ai bridge escapes tmux session names and remote paths', async () => {
  const shell = await import(path.join(rootDir, 'dist', 'lib', 'ai-bridge-shell.js'));

  assert.equal(
    shell.toSafeTmuxSessionName('ramp-my app && rm -rf /-claude'),
    'ramp-my-app-rm-rf-claude',
  );
  assert.equal(shell.buildBashLoginCommand('command -v codex'), "bash -lic 'command -v codex'");
  assert.equal(
    shell.buildRemoteTmuxCommand("ramp-my'app-codex", "/srv/www/my app's", 'codex'),
    "tmux new-session -A -s 'ramp-my'\\''app-codex' -c '/srv/www/my app'\\''s' 'bash -lic '\\''codex'\\'''",
  );
  assert.throws(() => shell.buildRemoteTmuxCommand('ramp-app-codex', 'bad\npath', 'codex'));
});

test('cli version output matches package.json', async () => {
  const tempDir = makeTempDir();

  try {
    const result = runCli(['--version'], tempDir);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), packageJson.version);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('build artifacts keep the shebang only on the executable entry', () => {
  const binOutput = readFileSync(path.join(rootDir, 'dist', 'bin.js'), 'utf8');
  const browserOutput = readFileSync(path.join(rootDir, 'dist', 'lib', 'browser.js'), 'utf8');

  assert.match(binOutput, /^#!\/usr\/bin\/env node/);
  assert.doesNotMatch(browserOutput, /^#!\/usr\/bin\/env node/);
});

test('sync-schema exits cleanly without legacy monorepo paths', () => {
  const result = spawnSync(process.execPath, [path.join(rootDir, 'scripts', 'sync-schema.mjs')], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Schema already lives in this repo/);
});
