import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import sodium from 'libsodium-wrappers-sumo';

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

test('env set error messages do not double the command label', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');

  try {
    seedCredentials(homeDir);
    seedProjectLink(tempDir);

    const result = runCli(['env', 'set', 'APP_ENV', '${web.url}'], tempDir, {
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
          url: 'https://api.example.test/api/v1/apps/app_123/env',
          method: 'GET',
          status: 200,
          body: {
            recipient: {
              available: false,
            },
          },
        },
        {
          url: 'https://api.example.test/api/v1/apps/app_123/env/set',
          method: 'POST',
          status: 422,
          body: {
            message: 'Invalid env var name.',
          },
        },
      ]),
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid env var name\./);
    assert.doesNotMatch(result.stderr, /Failed to set env var: Failed to set env var/);
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

test('env sync uploads dotenv entries through the bulk import endpoint', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');
  const capturePath = path.join(tempDir, 'fetch-capture.json');

  try {
    seedCredentials(homeDir);
    seedProjectLink(tempDir);
    writeFileSync(path.join(tempDir, '.env.local'), 'APP_URL=${web.url}\n', 'utf8');

    const result = runCli(['env', 'sync', '--from', '.env.local', '--service', 'web'], tempDir, {
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
              workspace_id: 'ws_personal',
              stack: 'linked-app',
              status: 'ready',
            },
          },
        },
        {
          url: 'https://api.example.test/api/v1/apps/app_123/env?service=web',
          method: 'GET',
          status: 200,
          body: {
            recipient: {
              available: false,
            },
          },
        },
        {
          url: 'https://api.example.test/api/v1/apps/app_123/env/import',
          method: 'POST',
          status: 200,
          body: {
            imported: 1,
            created: 1,
            updated: 0,
            changed: 0,
            unchanged: 0,
            refreshed: 0,
            created_keys: ['APP_URL'],
            updated_keys: [],
            changed_keys: [],
            unchanged_keys: [],
            refreshed_keys: [],
          },
        },
      ]),
    });

    assert.equal(result.status, 0);
    assert.match(
      result.stdout,
      /Synced 1 env var from \.env\.local \(1 created, 0 readable changed, 0 sealed written, 0 unchanged\)\./,
    );

    const requests = JSON.parse(readFileSync(capturePath, 'utf8'));
    const importRequest = requests.at(-1);

    assert.equal(importRequest.method, 'POST');
    assert.deepEqual(importRequest.body, {
      service: 'web',
      entries: [
        {
          key: 'APP_URL',
          value: '${web.url}',
        },
      ],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('env sync fingerprints sealed values without sending plaintext', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');
  const capturePath = path.join(tempDir, 'fetch-capture.json');

  try {
    await sodium.ready;
    const keyPair = sodium.crypto_box_keypair();
    const publicKey = sodium.to_base64(keyPair.publicKey, sodium.base64_variants.ORIGINAL);

    seedCredentials(homeDir);
    seedProjectLink(tempDir);
    writeFileSync(path.join(tempDir, '.env'), 'API_KEY=secret\n', 'utf8');

    const result = runCli(['env', 'sync'], tempDir, {
      HOME: homeDir,
      RAMP_ENV_FINGERPRINT_KEY: 'local-secret',
      RAMP_FETCH_CAPTURE: capturePath,
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
          url: 'https://api.example.test/api/v1/apps/app_123/env',
          method: 'GET',
          status: 200,
          body: {
            recipient: {
              available: true,
              key_id: 'key-1',
              algorithm: 'libsodium-crypto-box-seal',
              public_key: publicKey,
            },
          },
        },
        {
          url: 'https://api.example.test/api/v1/apps/app_123/env/import',
          method: 'POST',
          status: 200,
          body: {
            imported: 1,
            created: 0,
            updated: 0,
            changed: 0,
            unchanged: 1,
            refreshed: 0,
            sealed_written: 0,
            unchanged_keys: ['API_KEY'],
          },
        },
      ]),
    });

    assert.equal(result.status, 0);
    assert.match(
      result.stdout,
      /Synced 1 env var from \.env \(0 created, 0 readable changed, 0 sealed written, 1 unchanged\)\./,
    );

    const requests = JSON.parse(readFileSync(capturePath, 'utf8'));
    const importRequest = requests.at(-1);
    const expectedFingerprint = createHmac('sha256', 'local-secret')
      .update(['ramp-env-v1', 'app_123', 'API_KEY', 'secret'].join('\0'))
      .digest('hex');

    assert.deepEqual(importRequest.body.service, undefined);
    assert.equal(importRequest.body.entries[0].key, 'API_KEY');
    assert.equal(importRequest.body.entries[0].value, undefined);
    assert.equal(importRequest.body.entries[0].sealed.key_id, 'key-1');
    assert.equal(importRequest.body.entries[0].sealed.algorithm, 'libsodium-crypto-box-seal');
    assert.equal(importRequest.body.entries[0].sealed.fingerprint, expectedFingerprint);
    assert.equal(
      importRequest.body.entries[0].sealed.fingerprint_algorithm,
      'hmac-sha256-local-v1',
    );
    assert.notEqual(importRequest.body.entries[0].sealed.ciphertext, 'secret');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('env sync returns JSON metadata when requested', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');

  try {
    seedCredentials(homeDir);
    seedProjectLink(tempDir);
    writeFileSync(path.join(tempDir, '.env'), 'APP_URL=${web.url}\n', 'utf8');

    const result = runCli(['env', 'sync', '--json'], tempDir, {
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
          url: 'https://api.example.test/api/v1/apps/app_123/env',
          method: 'GET',
          status: 200,
          body: {
            recipient: {
              available: false,
            },
          },
        },
        {
          url: 'https://api.example.test/api/v1/apps/app_123/env/import',
          method: 'POST',
          status: 200,
          body: {
            imported: 1,
            created: 0,
            updated: 1,
            changed: 0,
            unchanged: 0,
            refreshed: 1,
            sealed_written: 1,
            created_keys: [],
            updated_keys: ['APP_URL'],
            changed_keys: [],
            unchanged_keys: [],
            refreshed_keys: ['APP_URL'],
            sealed_written_keys: ['APP_URL'],
            readable_diffs: [],
            omitted_reference_keys: ['DATABASE_URL'],
          },
        },
      ]),
    });

    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      action: 'sync',
      file: '.env',
      service: null,
      imported: 1,
      created: 0,
      updated: 1,
      changed: 0,
      unchanged: 0,
      refreshed: 1,
      sealed_written: 1,
      created_keys: [],
      updated_keys: ['APP_URL'],
      changed_keys: [],
      unchanged_keys: [],
      refreshed_keys: ['APP_URL'],
      sealed_written_keys: ['APP_URL'],
      readable_diffs: [],
      omitted_reference_keys: ['DATABASE_URL'],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('env sync explains when every writable key already existed', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');

  try {
    seedCredentials(homeDir);
    seedProjectLink(tempDir);
    writeFileSync(path.join(tempDir, '.env'), 'APP_URL=${web.url}\n', 'utf8');

    const result = runCli(['env', 'sync'], tempDir, {
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
          url: 'https://api.example.test/api/v1/apps/app_123/env',
          method: 'GET',
          status: 200,
          body: {
            recipient: {
              available: false,
            },
          },
        },
        {
          url: 'https://api.example.test/api/v1/apps/app_123/env/import',
          method: 'POST',
          status: 200,
          body: {
            imported: 1,
            created: 0,
            updated: 1,
            changed: 0,
            unchanged: 0,
            refreshed: 1,
          },
        },
      ]),
    });

    assert.equal(result.status, 0);
    assert.match(
      result.stdout,
      /Synced 1 env var from \.env \(0 created, 0 readable changed, 1 sealed written, 0 unchanged\)\./,
    );
    assert.match(result.stdout, /No new env vars or readable value changes were detected/);
    assert.match(result.stdout, /Sealed written means no matching local fingerprint was found/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('env sync prints readable diffs for changed reference values', async () => {
  const tempDir = makeTempDir();
  const homeDir = path.join(tempDir, 'home');

  try {
    seedCredentials(homeDir);
    seedProjectLink(tempDir);
    writeFileSync(path.join(tempDir, '.env'), 'APP_URL=${web.url}\n', 'utf8');

    const result = runCli(['env', 'sync'], tempDir, {
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
          url: 'https://api.example.test/api/v1/apps/app_123/env',
          method: 'GET',
          status: 200,
          body: {
            recipient: {
              available: false,
            },
          },
        },
        {
          url: 'https://api.example.test/api/v1/apps/app_123/env/import',
          method: 'POST',
          status: 200,
          body: {
            imported: 1,
            created: 0,
            updated: 1,
            changed: 1,
            unchanged: 0,
            refreshed: 0,
            sealed_written: 0,
            readable_diffs: [
              {
                key: 'APP_URL',
                before: '${old.url}',
                after: '${web.url}',
              },
            ],
          },
        },
      ]),
    });

    assert.equal(result.status, 0);
    assert.match(
      result.stdout,
      /Synced 1 env var from \.env \(0 created, 1 readable changed, 0 sealed written, 0 unchanged\)\./,
    );
    assert.match(result.stdout, /Readable changes:/);
    assert.match(result.stdout, /APP_URL\n  - \$\{old\.url\}\n  \+ \$\{web\.url\}/);
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
