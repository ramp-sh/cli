import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(rootDir, 'dist', 'bin.js');

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function makeTempDir(prefix = 'ramp-cli-init-test-') {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('init prints laravel template JSON metadata with YAML payload', async () => {
  const tempDir = makeTempDir();

  try {
    const result = runCli(['init', '--template', 'laravel', '--print', '--yes', '--json'], tempDir);

    assert.equal(result.status, 0);

    const payload = JSON.parse(result.stdout);

    assert.equal(payload.ok, true);
    assert.equal(payload.template, 'laravel');
    assert.equal(payload.mode, 'print');
    assert.equal(payload.path, null);
    assert.deepEqual(payload.services, ['web', 'worker']);
    assert.deepEqual(payload.resources, ['db', 'cache']);
    assert.match(payload.yaml, /runtime: php@8\.4/);
    assert.match(payload.yaml, /DATABASE_URL: \$\{db\.url\}/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('init laravel-octane template writes octane defaults', async () => {
  const tempDir = makeTempDir();

  try {
    const result = runCli(['init', '--template', 'laravel-octane', '--yes'], tempDir);

    assert.equal(result.status, 0);

    const yaml = readFileSync(path.join(tempDir, 'ramp.yaml'), 'utf8');

    assert.match(yaml, /runtime: php@8\.4/);
    assert.match(yaml, /port: 8000/);
    assert.match(yaml, /octane:\n      server: frankenphp/);
    assert.match(yaml, /workers: 2/);
    assert.match(yaml, /max_requests: 250/);
    assert.match(yaml, /start: php artisan queue:work/);
    assert.match(yaml, /DATABASE_URL: \$\{db\.url\}/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('init ruby template writes sane defaults', async () => {
  const tempDir = makeTempDir();

  try {
    const result = runCli(['init', '--template', 'ruby', '--yes'], tempDir);

    assert.equal(result.status, 0);

    const yaml = readFileSync(path.join(tempDir, 'ramp.yaml'), 'utf8');

    assert.match(yaml, /runtime: ruby@4\.0/);
    assert.match(yaml, /start: bundle exec ruby app\.rb -p 4567/);
    assert.match(yaml, /port: 4567/);
    assert.match(yaml, /RACK_ENV: production/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('init bun template writes sane defaults', async () => {
  const tempDir = makeTempDir();

  try {
    const result = runCli(['init', '--template', 'bun', '--yes'], tempDir);

    assert.equal(result.status, 0);

    const yaml = readFileSync(path.join(tempDir, 'ramp.yaml'), 'utf8');

    assert.match(yaml, /runtime: bun@1\.3/);
    assert.match(yaml, /start: bun run index\.ts/);
    assert.match(yaml, /port: 3000/);
    assert.match(yaml, /health: \//);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('init elysia template writes sane defaults', async () => {
  const tempDir = makeTempDir();

  try {
    const result = runCli(['init', '--template', 'elysia', '--yes'], tempDir);

    assert.equal(result.status, 0);

    const yaml = readFileSync(path.join(tempDir, 'ramp.yaml'), 'utf8');

    assert.match(yaml, /runtime: bun@1\.3/);
    assert.match(yaml, /start: bun run src\/index\.ts/);
    assert.match(yaml, /port: 3000/);
    assert.match(yaml, /health: \//);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('init rust template writes sane defaults', async () => {
  const tempDir = makeTempDir();

  try {
    const result = runCli(['init', '--template', 'rust', '--yes'], tempDir);

    assert.equal(result.status, 0);

    const yaml = readFileSync(path.join(tempDir, 'ramp.yaml'), 'utf8');

    assert.match(yaml, /runtime: rust@1\.94/);
    assert.match(yaml, /build: cargo build --release/);
    assert.match(yaml, /start: \.\/target\/release\/[a-z0-9-]+/);
    assert.match(yaml, /port: 3000/);
    assert.match(yaml, /health: \//);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('init axum template writes sane defaults', async () => {
  const tempDir = makeTempDir();

  try {
    const result = runCli(['init', '--template', 'axum', '--yes'], tempDir);

    assert.equal(result.status, 0);

    const yaml = readFileSync(path.join(tempDir, 'ramp.yaml'), 'utf8');

    assert.match(yaml, /runtime: rust@1\.94/);
    assert.match(yaml, /build: cargo build --release/);
    assert.match(yaml, /start: \.\/target\/release\/[a-z0-9-]+/);
    assert.match(yaml, /port: 3000/);
    assert.match(yaml, /health: \//);
    assert.match(yaml, /RUST_LOG: info/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('init rails template writes sane defaults', async () => {
  const tempDir = makeTempDir();

  try {
    const result = runCli(['init', '--template', 'rails', '--yes'], tempDir);

    assert.equal(result.status, 0);

    const yaml = readFileSync(path.join(tempDir, 'ramp.yaml'), 'utf8');

    assert.match(yaml, /runtime: ruby@4\.0/);
    assert.match(yaml, /build: bundle exec rails assets:precompile/);
    assert.match(yaml, /start: bundle exec puma -C config\/puma\.rb/);
    assert.match(yaml, /migrate: bundle exec rails db:migrate/);
    assert.match(yaml, /health: \/up/);
    assert.match(
      yaml,
      /worker:\n    type: worker\n    runtime: ruby@4\.0\n    start: bundle exec sidekiq/,
    );
    assert.match(yaml, /DATABASE_URL: \$\{db\.url\}/);
    assert.match(yaml, /REDIS_URL: \$\{cache\.url\}/);
    assert.match(yaml, /RAILS_ENV: production/);
    assert.match(yaml, /RACK_ENV: production/);
    assert.match(yaml, /RAILS_SERVE_STATIC_FILES: "1"/);
    assert.match(yaml, /SECRET_KEY_BASE: input_yours/);
    assert.match(yaml, /resources:\n  db:\n    type: postgres@17\n  cache:\n    type: redis@7/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('init reverb template writes sane defaults', async () => {
  const tempDir = makeTempDir();

  try {
    const result = runCli(['init', '--template', 'reverb', '--yes'], tempDir);

    assert.equal(result.status, 0);

    const yaml = readFileSync(path.join(tempDir, 'ramp.yaml'), 'utf8');

    assert.match(yaml, /reverb:\n    type: web/);
    assert.match(yaml, /runtime: php@8\.4/);
    assert.match(yaml, /start: php artisan reverb:start --host=127\.0\.0\.1 --port=8080/);
    assert.match(yaml, /port: 8080/);
    assert.match(yaml, /preview: false/);
    assert.match(yaml, /domains:\n      - ws\.example\.com/);
    assert.match(yaml, /REVERB_HOST: \$\{reverb\.domain\}/);
    assert.match(yaml, /REVERB_SCHEME: https/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('init returns a clear error in non-interactive mode without --yes', async () => {
  const tempDir = makeTempDir();

  try {
    const result = runCli(['init', '--template', 'laravel', '--print'], tempDir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Non-interactive init requires `--yes` to use defaults\./);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('init worker template generates a single worker service', async () => {
  const tempDir = makeTempDir();

  try {
    const result = runCli(['init', '--template', 'worker', '--print', '--yes'], tempDir);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /services:\n  worker:/);
    assert.match(result.stdout, /type: worker/);
    assert.match(result.stdout, /start: node worker\.js/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('init static template writes sane defaults', async () => {
  const tempDir = makeTempDir();

  try {
    const result = runCli(['init', '--template', 'static', '--yes'], tempDir);

    assert.equal(result.status, 0);

    const yaml = readFileSync(path.join(tempDir, 'ramp.yaml'), 'utf8');

    assert.match(yaml, /build: npm run build/);
    assert.match(yaml, /static: dist/);
    assert.match(yaml, /health: \/\n/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('init nextjs template writes sane defaults', async () => {
  const tempDir = makeTempDir();

  try {
    const result = runCli(['init', '--template', 'nextjs', '--yes'], tempDir);

    assert.equal(result.status, 0);

    const yaml = readFileSync(path.join(tempDir, 'ramp.yaml'), 'utf8');

    assert.match(yaml, /runtime: node@24/);
    assert.match(yaml, /build: pnpm build/);
    assert.match(yaml, /start: npx --yes next start --hostname 0\.0\.0\.0 --port 3000/);
    assert.match(yaml, /port: 3000/);
    assert.match(yaml, /health: \/\n/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('init adonis template writes sane defaults', async () => {
  const tempDir = makeTempDir();

  try {
    const result = runCli(['init', '--template', 'adonis', '--yes'], tempDir);

    assert.equal(result.status, 0);

    const yaml = readFileSync(path.join(tempDir, 'ramp.yaml'), 'utf8');

    assert.match(yaml, /runtime: node@24/);
    assert.match(yaml, /build: node ace build --ignore-ts-errors/);
    assert.match(yaml, /start: node build\/bin\/server\.js/);
    assert.match(yaml, /migrate: node ace\.js migration:run --force/);
    assert.match(yaml, /port: 3333/);
    assert.match(yaml, /TZ: UTC/);
    assert.match(yaml, /HOST: 0\.0\.0\.0/);
    assert.match(yaml, /LOG_LEVEL: info/);
    assert.match(yaml, /APP_KEY: input_yours/);
    assert.match(yaml, /NODE_ENV: production/);
    assert.match(yaml, /SESSION_DRIVER: cookie/);
    assert.match(yaml, /DATABASE_URL: \$\{db\.url\}/);
    assert.match(yaml, /DB_HOST: \$\{db\.host\}/);
    assert.match(yaml, /DB_PORT: \$\{db\.port\}/);
    assert.match(yaml, /DB_USER: \$\{db\.user\}/);
    assert.match(yaml, /DB_PASSWORD: \$\{db\.password\}/);
    assert.match(yaml, /DB_DATABASE: \$\{db\.name\}/);
    assert.match(yaml, /REDIS_HOST: \$\{cache\.host\}/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('init merges generated sections into an existing ramp.yaml by default with --yes', async () => {
  const tempDir = makeTempDir();

  try {
    writeFileSync(
      path.join(tempDir, 'ramp.yaml'),
      [
        'stack: existing-app',
        'services:',
        '  web:',
        '    type: web',
        '    runtime: node@24',
        '    start: node app.js',
        '    port: 4000',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = runCli(['init', '--template', 'laravel', '--yes', '--json'], tempDir);

    assert.equal(result.status, 0);

    const payload = JSON.parse(result.stdout);

    assert.equal(payload.mode, 'merge');
    assert.deepEqual(payload.conflicts, ['services.web']);

    const yaml = readFileSync(path.join(tempDir, 'ramp.yaml'), 'utf8');

    assert.match(yaml, /stack: existing-app/);
    assert.match(yaml, /start: node app\.js/);
    assert.match(yaml, /worker:\n    type: worker\n    runtime: php@8\.4/);
    assert.match(yaml, /resources:\n  db:/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
