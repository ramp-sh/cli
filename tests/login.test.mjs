import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(rootDir, 'dist', 'bin.js');
const browserModulePath = pathToFileURL(path.join(rootDir, 'dist', 'lib', 'browser.js')).href;

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

function makeTempDir(prefix = 'ramp-cli-login-test-') {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFetchMock(tempDir, script) {
  const mockPath = path.join(tempDir, 'mock-fetch.mjs');
  writeFileSync(mockPath, script, 'utf8');

  return mockPath;
}

test('browser helper chooses platform open commands and reports success', async () => {
  const browser = await import(`${browserModulePath}?v=${Date.now()}`);

  assert.deepEqual(browser.browserOpenCommand('https://ramp.sh', 'darwin'), {
    command: 'open',
    args: ['https://ramp.sh'],
  });
  assert.deepEqual(browser.browserOpenCommand('https://ramp.sh', 'linux'), {
    command: 'xdg-open',
    args: ['https://ramp.sh'],
  });
  assert.deepEqual(browser.browserOpenCommand('https://ramp.sh', 'win32'), {
    command: 'cmd',
    args: ['/c', 'start', '', 'https://ramp.sh'],
  });

  let invoked = null;

  const opened = browser.tryOpenBrowser(
    'https://ramp.sh',
    (command, args) => {
      invoked = { command, args };

      return { status: 0, error: undefined };
    },
    'linux',
  );

  assert.equal(opened, true);
  assert.deepEqual(invoked, {
    command: 'xdg-open',
    args: ['https://ramp.sh'],
  });
});

test('login stores credentials after browser approval', async () => {
  const tempDir = makeTempDir();

  try {
    const mockPath = writeFetchMock(
      tempDir,
      `
                let pollCount = 0;
                const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
                    status,
                    headers: { 'Content-Type': 'application/json' },
                });

                globalThis.fetch = async (input) => {
                    const url = typeof input === 'string' ? input : input.url;

                    if (url.endsWith('/api/v1/auth/cli-login/start')) {
                        return json({
                            device_code: 'd'.repeat(64),
                            user_code: 'ABCD-EFGH',
                            verification_url: 'https://api.ramp.sh/cli/login/ABCD-EFGH',
                            poll_interval_seconds: 0,
                            expires_at: '2027-01-01T00:00:00Z',
                        });
                    }

                    if (url.endsWith('/api/v1/auth/cli-login/poll')) {
                        pollCount += 1;

                        if (pollCount === 1) {
                            return json({ status: 'pending' });
                        }

                        return json({
                            status: 'approved',
                            token: 'rmp_cli_browser_token',
                            expires_at: '2027-01-01T00:00:00Z',
                            user: {
                                email: 'tiago@example.com',
                                name: 'Tiago',
                            },
                        });
                    }

                    if (url.endsWith('/api/v1/auth/me')) {
                        return json({
                            user: {
                                email: 'tiago@example.com',
                                name: 'Tiago',
                            },
                            current_workspace_id: 'ws_personal',
                        });
                    }

                    throw new Error('Unexpected fetch ' + url);
                };
            `,
    );
    const homeDir = path.join(tempDir, 'home');
    mkdirSync(path.join(homeDir, '.config', 'ramp'), { recursive: true });

    const result = runCli(['login', '--api-url', 'https://api.ramp.sh'], tempDir, {
      HOME: homeDir,
      RAMP_DISABLE_BROWSER_OPEN: '1',
      NODE_OPTIONS: `--import=${mockPath}`,
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Verification URL: https:\/\/api\.ramp\.sh\/cli\/login\/ABCD-EFGH/);
    assert.match(result.stdout, /Code: ABCD-EFGH/);
    assert.match(result.stdout, /Logged in as/);

    const credentials = JSON.parse(
      readFileSync(path.join(homeDir, '.config', 'ramp', 'credentials.json'), 'utf8'),
    );

    assert.equal(credentials.token, 'rmp_cli_browser_token');
    assert.equal(credentials.email, 'tiago@example.com');
    assert.equal(credentials.selectedWorkspaceId, 'ws_personal');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('login surfaces denied browser approvals', async () => {
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
                    const url = typeof input === 'string' ? input : input.url;

                    if (url.endsWith('/api/v1/auth/cli-login/start')) {
                        return json({
                            device_code: 'd'.repeat(64),
                            user_code: 'ABCD-EFGH',
                            verification_url: 'https://api.ramp.sh/cli/login/ABCD-EFGH',
                            poll_interval_seconds: 0,
                            expires_at: '2027-01-01T00:00:00Z',
                        });
                    }

                    if (url.endsWith('/api/v1/auth/cli-login/poll')) {
                        return json({ status: 'denied' });
                    }

                    throw new Error('Unexpected fetch ' + url);
                };
            `,
    );

    const result = runCli(['login', '--api-url', 'https://api.ramp.sh'], tempDir, {
      HOME: path.join(tempDir, 'home'),
      RAMP_DISABLE_BROWSER_OPEN: '1',
      NODE_OPTIONS: `--import=${mockPath}`,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /denied in the browser/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('login surfaces expired browser approvals', async () => {
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
                    const url = typeof input === 'string' ? input : input.url;

                    if (url.endsWith('/api/v1/auth/cli-login/start')) {
                        return json({
                            device_code: 'd'.repeat(64),
                            user_code: 'ABCD-EFGH',
                            verification_url: 'https://api.ramp.sh/cli/login/ABCD-EFGH',
                            poll_interval_seconds: 0,
                            expires_at: '2027-01-01T00:00:00Z',
                        });
                    }

                    if (url.endsWith('/api/v1/auth/cli-login/poll')) {
                        return json({ status: 'expired' });
                    }

                    throw new Error('Unexpected fetch ' + url);
                };
            `,
    );

    const result = runCli(['login', '--api-url', 'https://api.ramp.sh'], tempDir, {
      HOME: path.join(tempDir, 'home'),
      RAMP_DISABLE_BROWSER_OPEN: '1',
      NODE_OPTIONS: `--import=${mockPath}`,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /request expired/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
