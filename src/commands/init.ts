import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process, { stdin, stdout } from 'node:process';
import readline from 'node:readline/promises';
import { parseDocument, stringify } from 'yaml';
import { askOrCancel, wireSigintToClose } from '../lib/prompt.js';
import { selectManyWithArrows, selectWithArrows } from '../lib/select.js';
import {
  box,
  isInteractiveUi,
  joinList,
  keyHint,
  paint,
  sectionHeader,
  stepper,
  statusLine,
} from '../lib/ui.js';

type InitOptions = {
  template?: string;
  yes: boolean;
  print: boolean;
  json: boolean;
  force: boolean;
  quiet: boolean;
  verbose: boolean;
};

type Template =
  | 'custom'
  | 'laravel'
  | 'laravel-octane'
  | 'node-api'
  | 'nextjs'
  | 'static'
  | 'worker'
  | 'adonis';
type Runtime = 'node' | 'php';
type ServiceKind = 'web' | 'worker' | 'cron';
type ResourceKind = 'postgres' | 'redis';
type ExistingFileMode = 'overwrite' | 'merge' | 'cancel';

type ResourceMap = Record<string, { type: string }>;
type ServiceMap = Record<string, Record<string, unknown>>;
type RampConfig = {
  stack: string;
  services: ServiceMap;
  resources?: ResourceMap;
  [key: string]: unknown;
};

type InitResult = {
  ok: true;
  template: Template;
  stack: string;
  mode: 'print' | 'write' | 'overwrite' | 'merge';
  path: string | null;
  services: string[];
  resources: string[];
  yaml: string;
  conflicts: string[];
};

export function withOptionalDomains(
  service: Record<string, unknown>,
  domains: string[],
): Record<string, unknown> {
  if (domains.length === 0) {
    return service;
  }

  return {
    ...service,
    domains,
  };
}

export async function runInitCommand(options: InitOptions): Promise<number> {
  const template = normalizeTemplate(options.template);

  if (options.template && template === null) {
    return outputError(
      'Unknown template. Use one of: custom, laravel, laravel-octane, node-api, nextjs, static, worker, adonis',
      options,
    );
  }

  const isInteractive = process.stdin.isTTY && process.stdout.isTTY;

  if (!isInteractive && !options.yes) {
    return outputError('Non-interactive init requires `--yes` to use defaults.', options);
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  wireSigintToClose(rl);

  try {
    if (isInteractiveUi() && !options.quiet && !options.print && !options.json) {
      process.stdout.write(
        `${sectionHeader(
          'Scaffold a ramp.yaml',
          'Pick a template, adjust the bits that matter, and Ramp fills the rest.',
        )}\n\n`,
      );
      process.stdout.write(
        `${stepper('Flow', [
          { label: 'Choose template', state: 'current' },
          { label: 'Tune services and resources', state: 'pending' },
          { label: 'Write ramp.yaml', state: 'pending' },
        ])}\n\n`,
      );
    }

    const selectedTemplate = template ?? (options.yes ? 'custom' : await chooseTemplate());

    if (selectedTemplate === null) {
      return outputError('Cancelled.', options, 130);
    }

    const defaultStack = suggestStackName();
    const stackInput = options.yes
      ? defaultStack
      : await askOrCancel(rl, `Stack name [${defaultStack}]: `);

    if (stackInput === null) {
      return outputError('Cancelled.', options, 130);
    }

    const stack = (stackInput.trim() || defaultStack).toLowerCase();

    const config = await buildTemplateConfig(selectedTemplate, stack, options, rl);

    if (config === null) {
      return outputError('Cancelled.', options, 130);
    }

    const targetPath = path.join(process.cwd(), 'ramp.yaml');
    const exists = await fileExists(targetPath);
    let finalConfig = config;
    let mode: InitResult['mode'] = options.print ? 'print' : 'write';
    let conflicts: string[] = [];

    if (!options.print && exists) {
      if (options.force) {
        mode = 'overwrite';
      } else {
        const fileMode = options.yes ? 'merge' : await chooseExistingFileMode();

        if (fileMode === null || fileMode === 'cancel') {
          return outputError('Cancelled.', options, 130);
        }

        if (fileMode === 'overwrite') {
          mode = 'overwrite';
        } else {
          const merged = await mergeWithExistingConfig(targetPath, config);

          if (merged === null) {
            return outputError(
              'Existing ramp.yaml is invalid and cannot be merged. Use `--force` to overwrite it.',
              options,
            );
          }

          finalConfig = merged.config;
          conflicts = merged.conflicts;
          mode = 'merge';
        }
      }
    }

    const yaml = `${stringify(finalConfig)}\n`;
    const result: InitResult = {
      ok: true,
      template: selectedTemplate,
      stack: finalConfig.stack,
      mode,
      path: options.print ? null : targetPath,
      services: Object.keys(finalConfig.services ?? {}),
      resources: Object.keys(finalConfig.resources ?? {}),
      yaml,
      conflicts,
    };

    if (options.print) {
      return outputInitResult(result, options);
    }

    await writeFile(targetPath, yaml, 'utf8');

    return outputInitResult(result, options);
  } finally {
    rl.close();
  }
}

async function chooseTemplate(): Promise<Template | null> {
  return selectWithArrows('Select template', [
    {
      label: 'Custom',
      description: 'Pick runtime, services, and resources yourself',
      value: 'custom' as const,
    },
    {
      label: 'Laravel',
      description: 'PHP web + queue worker + optional Postgres/Redis',
      value: 'laravel' as const,
    },
    {
      label: 'Laravel Octane',
      description: 'Laravel web + queue worker + FrankenPHP Octane defaults',
      value: 'laravel-octane' as const,
    },
    {
      label: 'Node API',
      description: 'Node web service with build, port, and health',
      value: 'node-api' as const,
    },
    {
      label: 'Next.js',
      description: 'Node web service with Next build/start defaults',
      value: 'nextjs' as const,
    },
    {
      label: 'Static',
      description: 'Static site build served from a single web service',
      value: 'static' as const,
    },
    {
      label: 'Worker',
      description: 'Background process without a public web entry',
      value: 'worker' as const,
    },
    {
      label: 'AdonisJS',
      description: 'Node web service with Adonis build/start defaults',
      value: 'adonis' as const,
    },
  ]);
}

async function chooseExistingFileMode(): Promise<ExistingFileMode | null> {
  return selectWithArrows('ramp.yaml already exists', [
    {
      label: 'Overwrite file',
      description: 'Replace the current ramp.yaml completely',
      value: 'overwrite' as const,
    },
    {
      label: 'Merge generated sections',
      description: 'Keep existing names, add missing ones',
      value: 'merge' as const,
    },
    {
      label: 'Cancel',
      description: 'Leave the current file untouched',
      value: 'cancel' as const,
    },
  ]);
}

async function buildTemplateConfig(
  template: Template,
  stack: string,
  options: InitOptions,
  rl: readline.Interface,
): Promise<RampConfig | null> {
  if (template === 'laravel') {
    return buildLaravelTemplate(stack, options, rl);
  }

  if (template === 'laravel-octane') {
    return buildLaravelOctaneTemplate(stack, options, rl);
  }

  if (template === 'node-api') {
    return buildNodeApiTemplate(stack, options, rl);
  }

  if (template === 'static') {
    return buildStaticTemplate(stack, options, rl);
  }

  if (template === 'nextjs') {
    return buildNextJsTemplate(stack, options, rl);
  }

  if (template === 'worker') {
    return buildWorkerTemplate(stack, options, rl);
  }

  if (template === 'adonis') {
    return buildAdonisTemplate(stack, options, rl);
  }

  return buildCustomTemplate(stack, options, rl);
}

async function buildCustomTemplate(
  stack: string,
  options: InitOptions,
  rl: readline.Interface,
): Promise<RampConfig | null> {
  const runtime = options.yes
    ? 'node'
    : await selectWithArrows('Select runtime', [
        {
          label: 'Node',
          description: 'node@24',
          value: 'node' as const,
        },
        {
          label: 'PHP',
          description: 'php@8.4',
          value: 'php' as const,
        },
      ]);

  if (runtime === null) {
    return null;
  }

  const services = options.yes
    ? (['web'] as ServiceKind[])
    : await selectManyWithArrows(
        'Select services',
        [
          { label: 'Web', value: 'web' as const },
          { label: 'Worker', value: 'worker' as const },
          { label: 'Cron', value: 'cron' as const },
        ],
        ['web'],
      );

  if (services === null) {
    return null;
  }

  const normalizedServices = services.length > 0 ? services : (['web'] as ServiceKind[]);

  const resources = options.yes
    ? ([] as ResourceKind[])
    : await selectManyWithArrows(
        'Select resources (optional)',
        [
          { label: 'Postgres', value: 'postgres' as const },
          { label: 'Redis', value: 'redis' as const },
        ],
        [],
      );

  if (resources === null) {
    return null;
  }

  const serviceMap: ServiceMap = {};

  for (const service of normalizedServices) {
    if (service === 'web') {
      serviceMap.web =
        runtime === 'node'
          ? {
              type: 'web',
              runtime: 'node@24',
              start: 'node server.js',
              port: 3000,
              health: '/health',
            }
          : {
              type: 'web',
              runtime: 'php@8.4',
              health: '/up',
            };
    }

    if (service === 'worker') {
      serviceMap.worker =
        runtime === 'node'
          ? {
              type: 'worker',
              runtime: 'node@24',
              start: 'node worker.js',
            }
          : {
              type: 'worker',
              runtime: 'php@8.4',
              start: 'php artisan queue:work',
            };
    }

    if (service === 'cron') {
      serviceMap.cron =
        runtime === 'node'
          ? {
              type: 'cron',
              runtime: 'node@24',
              schedule: '*/5 * * * *',
              start: 'node cron.js',
            }
          : {
              type: 'cron',
              runtime: 'php@8.4',
              schedule: '* * * * *',
              start: 'php artisan schedule:run',
            };
    }
  }

  const resourceMap = buildResourceMap(resources);
  const domains =
    'web' in serviceMap
      ? await askForOptionalDomains(rl, options, 'Custom domain (optional): ')
      : [];

  if (domains === null) {
    return null;
  }

  if (serviceMap.web) {
    serviceMap.web = withOptionalDomains(serviceMap.web, domains);
  }

  const config: RampConfig = {
    stack,
    services: serviceMap,
  };

  if (Object.keys(resourceMap).length > 0) {
    config.resources = resourceMap;
  }

  const includeExampleRefs = !options.yes
    ? await askOrCancel(rl, 'Add sample Ramp env mappings to the web service? [y/N]: ')
    : 'n';

  if (
    includeExampleRefs !== null &&
    ['y', 'yes'].includes(includeExampleRefs.trim().toLowerCase())
  ) {
    const webService = config.services.web;

    if (webService) {
      webService.env = {
        APP_URL: '${web.url}',
        ...(resourceMap.db ? { DATABASE_URL: '${db.url}' } : {}),
        ...(resourceMap.cache ? { REDIS_HOST: '${cache.host}' } : {}),
      };
    }
  }

  return config;
}

async function buildLaravelTemplate(
  stack: string,
  options: InitOptions,
  rl: readline.Interface,
): Promise<RampConfig | null> {
  const defaultResources: ResourceKind[] = ['postgres', 'redis'];
  const resources = options.yes
    ? defaultResources
    : await selectManyWithArrows(
        'Laravel resources',
        [
          { label: 'Postgres', value: 'postgres' as const },
          { label: 'Redis', value: 'redis' as const },
        ],
        defaultResources,
      );

  if (resources === null) {
    return null;
  }

  const resourceMap = buildResourceMap(resources);
  const webEnv: Record<string, string> = {
    APP_URL: '${web.url}',
  };

  if (resourceMap.db) {
    webEnv.DATABASE_URL = '${db.url}';
  }

  if (resourceMap.cache) {
    webEnv.REDIS_HOST = '${cache.host}';
  }

  const domains = await askForOptionalDomains(rl, options, 'Custom domain (optional): ');

  if (domains === null) {
    return null;
  }

  const config: RampConfig = {
    stack,
    services: {
      web: withOptionalDomains(
        {
          type: 'web',
          runtime: 'php@8.4',
          build: 'npm run build',
          migrate: 'php artisan migrate --force',
          health: '/up',
          env: webEnv,
        },
        domains,
      ),
      worker: {
        type: 'worker',
        runtime: 'php@8.4',
        start: 'php artisan queue:work',
      },
    },
  };

  if (Object.keys(resourceMap).length > 0) {
    config.resources = resourceMap;
  }

  return config;
}

async function buildLaravelOctaneTemplate(
  stack: string,
  options: InitOptions,
  rl: readline.Interface,
): Promise<RampConfig | null> {
  const config = await buildLaravelTemplate(stack, options, rl);

  if (config === null) {
    return null;
  }

  config.services.web = {
    ...config.services.web,
    port: 8000,
    octane: {
      server: 'frankenphp',
      workers: 2,
      max_requests: 250,
    },
  };

  return config;
}

async function buildNodeApiTemplate(
  stack: string,
  options: InitOptions,
  rl: readline.Interface,
): Promise<RampConfig | null> {
  const port = await askForPort(rl, options, 3000, 'Port [3000]: ');

  if (port === null) {
    return null;
  }

  const domains = await askForOptionalDomains(rl, options, 'Custom domain (optional): ');

  if (domains === null) {
    return null;
  }

  return {
    stack,
    services: {
      web: withOptionalDomains(
        {
          type: 'web',
          runtime: 'node@24',
          build: 'npm run build',
          start: 'node server.js',
          port,
          health: '/health',
        },
        domains,
      ),
    },
  };
}

async function buildStaticTemplate(
  stack: string,
  options: InitOptions,
  rl: readline.Interface,
): Promise<RampConfig | null> {
  const outputDirInput = options.yes
    ? 'dist'
    : await askOrCancel(rl, 'Build output directory [dist]: ');

  if (outputDirInput === null) {
    return null;
  }

  const outputDir = outputDirInput.trim() || 'dist';
  const domains = await askForOptionalDomains(rl, options, 'Custom domain (optional): ');

  if (domains === null) {
    return null;
  }

  return {
    stack,
    services: {
      web: withOptionalDomains(
        {
          type: 'web',
          runtime: 'node@24',
          build: 'npm run build',
          static: outputDir,
          health: '/',
        },
        domains,
      ),
    },
  };
}

async function buildNextJsTemplate(
  stack: string,
  options: InitOptions,
  rl: readline.Interface,
): Promise<RampConfig | null> {
  const port = await askForPort(rl, options, 3000, 'Port [3000]: ');

  if (port === null) {
    return null;
  }

  const domains = await askForOptionalDomains(rl, options, 'Custom domain (optional): ');

  if (domains === null) {
    return null;
  }

  return {
    stack,
    services: {
      web: withOptionalDomains(
        {
          type: 'web',
          runtime: 'node@24',
          build: 'pnpm build',
          start: `npx --yes next start --hostname 0.0.0.0 --port ${port}`,
          port,
          health: '/',
        },
        domains,
      ),
    },
  };
}

async function buildWorkerTemplate(
  stack: string,
  options: InitOptions,
  rl: readline.Interface,
): Promise<RampConfig | null> {
  const runtime = options.yes
    ? 'node'
    : await selectWithArrows('Worker runtime', [
        {
          label: 'Node',
          description: 'node@24',
          value: 'node' as const,
        },
        {
          label: 'PHP',
          description: 'php@8.4',
          value: 'php' as const,
        },
      ]);

  if (runtime === null) {
    return null;
  }

  return {
    stack,
    services: {
      worker: {
        type: 'worker',
        runtime: runtime === 'node' ? 'node@24' : 'php@8.4',
        start: runtime === 'node' ? 'node worker.js' : 'php artisan queue:work',
      },
    },
  };
}

async function buildAdonisTemplate(
  stack: string,
  options: InitOptions,
  rl: readline.Interface,
): Promise<RampConfig | null> {
  const port = await askForPort(rl, options, 3333, 'Port [3333]: ');

  if (port === null) {
    return null;
  }

  const defaultResources: ResourceKind[] = ['postgres', 'redis'];
  const resources = options.yes
    ? defaultResources
    : await selectManyWithArrows(
        'Adonis resources',
        [
          { label: 'Postgres', value: 'postgres' as const },
          { label: 'Redis', value: 'redis' as const },
        ],
        defaultResources,
      );

  if (resources === null) {
    return null;
  }

  const resourceMap = buildResourceMap(resources);
  const webEnv: Record<string, string> = {
    TZ: 'UTC',
    PORT: String(port),
    HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
    APP_KEY: 'input_yours',
    NODE_ENV: 'production',
    SESSION_DRIVER: 'cookie',
    APP_URL: '${web.url}',
  };

  if (resourceMap.db) {
    webEnv.DATABASE_URL = '${db.url}';
    webEnv.DB_HOST = '${db.host}';
    webEnv.DB_PORT = '${db.port}';
    webEnv.DB_USER = '${db.user}';
    webEnv.DB_PASSWORD = '${db.password}';
    webEnv.DB_DATABASE = '${db.name}';
  }

  if (resourceMap.cache) {
    webEnv.REDIS_HOST = '${cache.host}';
  }

  const domains = await askForOptionalDomains(rl, options, 'Custom domain (optional): ');

  if (domains === null) {
    return null;
  }

  const config: RampConfig = {
    stack,
    services: {
      web: withOptionalDomains(
        {
          type: 'web',
          runtime: 'node@24',
          build: 'node ace build --ignore-ts-errors',
          start: 'node build/bin/server.js',
          migrate: 'node ace.js migration:run --force',
          port,
          health: '/',
          env: webEnv,
        },
        domains,
      ),
    },
  };

  if (Object.keys(resourceMap).length > 0) {
    config.resources = resourceMap;
  }

  return config;
}

async function askForPort(
  rl: readline.Interface,
  options: InitOptions,
  defaultPort: number,
  prompt: string,
): Promise<number | null> {
  if (options.yes) {
    return defaultPort;
  }

  while (true) {
    const answer = await askOrCancel(rl, prompt);

    if (answer === null) {
      return null;
    }

    const trimmed = answer.trim();

    if (trimmed === '') {
      return defaultPort;
    }

    const port = Number.parseInt(trimmed, 10);

    if (Number.isInteger(port) && port >= 1000 && port <= 65535) {
      return port;
    }

    process.stderr.write('Port must be an integer between 1000 and 65535.\n');
  }
}

async function askForOptionalDomains(
  rl: readline.Interface,
  options: InitOptions,
  prompt: string,
): Promise<string[] | null> {
  if (options.yes) {
    return [];
  }

  while (true) {
    const answer = await askOrCancel(rl, prompt);

    if (answer === null) {
      return null;
    }

    const trimmed = answer.trim();

    if (trimmed === '') {
      return [];
    }

    if (isValidDomain(trimmed)) {
      return [trimmed];
    }

    process.stderr.write('Enter a bare domain like api.example.com, without http:// or paths.\n');
  }
}

function isValidDomain(value: string): boolean {
  return /^(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value);
}

function buildResourceMap(resources: ResourceKind[]): ResourceMap {
  const resourceMap: ResourceMap = {};

  if (resources.includes('postgres')) {
    resourceMap.db = { type: 'postgres@17' };
  }

  if (resources.includes('redis')) {
    resourceMap.cache = { type: 'redis@7' };
  }

  return resourceMap;
}

async function mergeWithExistingConfig(
  targetPath: string,
  generatedConfig: RampConfig,
): Promise<{ config: RampConfig; conflicts: string[] } | null> {
  const existingYaml = await readFile(targetPath, 'utf8');
  const document = parseDocument(existingYaml);

  if (document.errors.length > 0) {
    return null;
  }

  const existingConfig = document.toJSON() as RampConfig | null;

  if (
    existingConfig === null ||
    typeof existingConfig !== 'object' ||
    typeof existingConfig.stack !== 'string' ||
    typeof existingConfig.services !== 'object' ||
    existingConfig.services === null
  ) {
    return null;
  }

  const conflicts: string[] = [];
  const mergedServices = mergeNamedEntries(
    existingConfig.services,
    generatedConfig.services,
    'services',
    conflicts,
  );
  const mergedResources = mergeNamedEntries(
    existingConfig.resources ?? {},
    generatedConfig.resources ?? {},
    'resources',
    conflicts,
  );

  const mergedConfig: RampConfig = {
    ...generatedConfig,
    ...existingConfig,
    stack: existingConfig.stack || generatedConfig.stack,
    services: mergedServices,
  };

  if (Object.keys(mergedResources).length > 0) {
    mergedConfig.resources = mergedResources;
  } else {
    delete mergedConfig.resources;
  }

  return { config: mergedConfig, conflicts };
}

function mergeNamedEntries<T>(
  existingEntries: Record<string, T>,
  generatedEntries: Record<string, T>,
  label: 'services' | 'resources',
  conflicts: string[],
): Record<string, T> {
  const mergedEntries: Record<string, T> = { ...existingEntries };

  for (const [name, entry] of Object.entries(generatedEntries)) {
    if (name in mergedEntries) {
      conflicts.push(`${label}.${name}`);
      continue;
    }

    mergedEntries[name] = entry;
  }

  return mergedEntries;
}

function outputInitResult(result: InitResult, options: InitOptions): number {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  if (options.print) {
    process.stdout.write(result.yaml);
    return 0;
  }

  if (!options.quiet && result.path !== null) {
    const action =
      result.mode === 'merge' ? 'Merged' : result.mode === 'overwrite' ? 'Overwrote' : 'Created';

    process.stdout.write(
      `${box([
        statusLine('success', `${action} ${paint(result.path, 'bold')}`),
        keyHint(
          `template ${result.template}  |  services ${joinList(
            result.services,
          )}  |  resources ${joinList(result.resources)}`,
        ),
      ])}\n`,
    );

    if (result.conflicts.length > 0) {
      process.stdout.write(
        `${box([
          statusLine('info', `Preserved existing entries: ${result.conflicts.join(', ')}`),
        ])}\n`,
      );
    }

    process.stdout.write(`${keyHint('Next: ramp validate, then ramp deploy')}\n`);
  }

  return 0;
}

function outputError(message: string, options: InitOptions, code = 1): number {
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
  } else {
    process.stderr.write(`${statusLine('error', message)}\n`);
  }

  return code;
}

function suggestStackName(): string {
  const currentDir = path.basename(process.cwd());
  const slug = currentDir
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'my-app';
}

function normalizeTemplate(value: string | undefined): Template | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'custom') {
    return 'custom';
  }

  if (normalized === 'laravel') {
    return 'laravel';
  }

  if (
    normalized === 'laravel-octane' ||
    normalized === 'octane' ||
    normalized === 'laraveloctane'
  ) {
    return 'laravel-octane';
  }

  if (normalized === 'node-api' || normalized === 'node') {
    return 'node-api';
  }

  if (normalized === 'nextjs' || normalized === 'next' || normalized === 'next-js') {
    return 'nextjs';
  }

  if (normalized === 'static') {
    return 'static';
  }

  if (normalized === 'worker') {
    return 'worker';
  }

  if (normalized === 'adonis' || normalized === 'adonisjs') {
    return 'adonis';
  }

  return null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
