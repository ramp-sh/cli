import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { resolveProjectContext } from '../lib/project-resolver.js';
import { askOrCancel, wireSigintToClose } from '../lib/prompt.js';

const execFileAsync = promisify(execFile);

type DeployCommandOptions = {
  app?: string;
  server?: string;
  apiUrl?: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  gitCheck: boolean;
};

type DeployResponse = {
  ok?: boolean;
  deploy?: {
    id: string;
    status: string;
    trigger: string;
  };
};

export async function runDeployCommand(options: DeployCommandOptions): Promise<number> {
  const resolved = await resolveProjectContext({
    app: options.app,
    server: options.server,
    apiUrl: options.apiUrl,
    json: options.json,
  });

  if (resolved.error !== null || resolved.context === null) {
    process.stderr.write(`${resolved.error ?? 'Unable to resolve project context.'}\n`);
    return 1;
  }

  // Upload apps must use `ramp upload`
  const appMeta = resolved.context.app as { deploy_mode?: string };
  if (appMeta.deploy_mode === 'upload') {
    process.stderr.write('This app uses upload deploys. Run `ramp upload` instead.\n');
    return 1;
  }

  if (options.gitCheck) {
    const proceed = await confirmGitStateBeforeDeploy(options);

    if (!proceed) {
      process.stderr.write('Deploy cancelled.\n');
      return 130;
    }
  }

  const response = await fetch(
    buildApiV1Endpoint(resolved.context.apiUrl, `/apps/${resolved.context.app.id}/deploy`),
    {
      method: 'POST',
      headers: buildApiHeaders({
        token: resolved.context.token,
        selectedWorkspaceId: resolved.context.selectedWorkspaceId,
      }),
    },
  );

  if (!response.ok) {
    process.stderr.write(`${await describeApiError(response, 'Failed to trigger deploy')}\n`);
    return 1;
  }

  const payload = (await response.json()) as DeployResponse;

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  if (options.quiet) {
    return 0;
  }

  if (options.verbose) {
    process.stdout.write(`Resolved via: ${resolved.context.source}\n`);
  }

  process.stdout.write(`Deploy queued for ${resolved.context.app.stack}.\n`);

  if (payload.deploy?.id) {
    process.stdout.write(`Deploy ID: ${payload.deploy.id}\n`);
  }

  return 0;
}

async function confirmGitStateBeforeDeploy(options: DeployCommandOptions): Promise<boolean> {
  if (!process.stdin.isTTY || options.json) {
    return true;
  }

  const state = await inspectGitState();

  if (state === null || (!state.hasUncommitted && state.aheadCount === 0)) {
    return true;
  }

  if (!options.quiet) {
    process.stdout.write('Your local git state differs from what remote deploy will pull.\n');

    if (state.hasUncommitted) {
      process.stdout.write('- Uncommitted changes detected.\n');
    }

    if (state.aheadCount > 0) {
      process.stdout.write(`- ${state.aheadCount} local commit(s) not pushed.\n`);
    }

    process.stdout.write('Deploy pulls from GitHub, not your local filesystem.\n');
    process.stdout.write('Tip: commit/push first if you want local changes included.\n');
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  wireSigintToClose(rl);

  try {
    const answer = (await askOrCancel(rl, 'Continue deploy anyway? [y/N]: '))?.trim().toLowerCase();

    if (!answer) {
      return false;
    }

    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function inspectGitState(): Promise<{
  hasUncommitted: boolean;
  aheadCount: number;
} | null> {
  try {
    await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
    });
  } catch {
    return null;
  }

  let hasUncommitted = false;
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: process.cwd(),
    });
    hasUncommitted = stdout.trim() !== '';
  } catch {
    hasUncommitted = false;
  }

  let aheadCount = 0;
  try {
    await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      {
        cwd: process.cwd(),
      },
    );

    const { stdout } = await execFileAsync('git', ['rev-list', '--count', '@{upstream}..HEAD'], {
      cwd: process.cwd(),
    });

    aheadCount = Number.parseInt(stdout.trim(), 10);

    if (Number.isNaN(aheadCount)) {
      aheadCount = 0;
    }
  } catch {
    aheadCount = 0;
  }

  return { hasUncommitted, aheadCount };
}
