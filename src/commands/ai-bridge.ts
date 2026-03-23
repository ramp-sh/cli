import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { buildApiV1Endpoint } from '../lib/api-url.js';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { readProjectLink, updateProjectLink } from '../lib/project-link.js';
import { resolveProjectContext } from '../lib/project-resolver.js';
import { paint, statusLine } from '../lib/ui.js';

type AiBridgeOptions = {
  tool: 'claude' | 'codex' | 'opencode' | 'gemini';
  app?: string;
  server?: string;
  identity?: string;
  apiUrl?: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
};

type SshContext = {
  ip: string | null;
  user: string | null;
  port: number | null;
  deploy_mode: string;
  working_directory: string;
};

type AppShowResponse = {
  data?: {
    id: string;
    stack: string;
    status: string;
    ssh?: SshContext;
  };
};

const TOOL_BINARY: Record<string, string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  gemini: 'gemini',
};

const INSTALL_GUIDANCE: Record<string, string> = {
  claude:
    'Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash\nThen authenticate: claude login',
  codex: 'Install Codex: npm install -g @openai/codex\nThen authenticate: codex login',
  opencode:
    'Install OpenCode: curl -fsSL https://opencode.ai/install | bash\nThen authenticate: opencode login',
  gemini: 'Install Gemini CLI: npm install -g @google/gemini-cli\nThen authenticate: gemini login',
};

export async function runAiBridgeCommand(options: AiBridgeOptions): Promise<number> {
  const resolved = await resolveProjectContext({
    app: options.app,
    server: options.server,
    apiUrl: options.apiUrl,
    json: options.json,
  });

  if (resolved.error || !resolved.context) {
    process.stderr.write(
      `${statusLine('error', resolved.error ?? 'Unable to resolve project context.')}\n`,
    );
    return 1;
  }

  // Fetch app with SSH context
  const response = await fetch(
    buildApiV1Endpoint(resolved.context.apiUrl, `/apps/${resolved.context.app.id}?context=cli`),
    {
      headers: buildApiHeaders({
        token: resolved.context.token,
        selectedWorkspaceId: resolved.context.selectedWorkspaceId,
      }),
    },
  );

  if (!response.ok) {
    process.stderr.write(
      `${statusLine('error', await describeApiError(response, 'Failed to fetch app context'))}\n`,
    );
    return 1;
  }

  const payload = (await response.json()) as AppShowResponse;
  const app = payload.data;
  const ssh = app?.ssh;

  if (!app || !ssh) {
    process.stderr.write(
      `${statusLine('error', 'API did not return SSH context for this app.')}\n`,
    );
    return 1;
  }

  if (!ssh.ip || !ssh.user) {
    process.stderr.write(
      `${statusLine('error', 'Server has no IP address or SSH user configured.')}\n`,
    );
    return 1;
  }

  const binary = TOOL_BINARY[options.tool];
  const sessionName = `ramp-${app.stack}-${options.tool}`;

  // Resolve SSH identity: explicit flag > saved in .ramp/config.json
  const link = await readProjectLink();
  const identity = options.identity ?? link?.value.ssh_identity;

  // Preflight: check SSH connectivity
  if (!options.quiet) {
    process.stderr.write(
      `${statusLine('info', `Connecting to ${paint(app.stack, 'bold')} on ${ssh.ip}...`)}\n`,
    );
  }

  const sshBase = buildSshArgs(ssh, identity);

  const preflight = spawnSync('ssh', [...sshBase, 'echo ok'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  });

  if (preflight.status !== 0) {
    const stderr = preflight.stderr?.toString().trim() ?? '';
    process.stderr.write(`${statusLine('error', 'SSH connection failed.')}\n`);
    if (stderr) {
      process.stderr.write(`${paint(stderr, 'gray')}\n`);
    }
    process.stderr.write(
      `\n${paint('Troubleshooting:', 'bold')}\n` +
        `  1. Ensure your SSH public key is added to your Ramp workspace\n` +
        `  2. Ensure the matching private key is available locally\n` +
        `  3. Try: ${paint(`ramp ${options.tool} --identity ~/.ssh/your-key`, 'cyan')}\n` +
        `  4. Or configure ${paint('~/.ssh/config', 'cyan')} for ${ssh.ip}\n`,
    );
    return 1;
  }

  // Save identity to .ramp/config.json for future use
  if (options.identity && link?.path && link.value.ssh_identity !== options.identity) {
    await updateProjectLink(link.path, { ssh_identity: options.identity });
  }

  // Preflight: check if tool binary exists on server
  const whichCheck = spawnSync('ssh', [...sshBase, `bash -lic 'command -v ${binary}'`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });

  if (whichCheck.status !== 0) {
    process.stderr.write(
      `${statusLine('error', `${paint(binary, 'bold')} is not installed on the server.`)}\n\n`,
    );
    process.stderr.write(`${INSTALL_GUIDANCE[options.tool]}\n`);
    return 1;
  }

  if (!options.quiet && options.verbose) {
    process.stderr.write(
      `${statusLine('info', `Found ${binary} on server. Starting tmux session ${paint(sessionName, 'cyan')}...`)}\n`,
    );
  }

  // Launch: ssh -t into tmux with the tool binary
  // Use bash -lic to ensure PATH includes nvm/pyenv/etc from .bashrc
  const remoteCmd = `tmux new-session -A -s ${sessionName} -c ${ssh.working_directory} "bash -lic ${binary}"`;

  const result = spawnSync('ssh', [...sshBase, '-t', remoteCmd], { stdio: 'inherit' });

  return result.status ?? 1;
}

function buildSshArgs(ssh: SshContext, identity?: string): string[] {
  const args: string[] = [];

  if (identity) {
    args.push('-i', identity);
  }

  args.push('-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10');

  if (ssh.port && ssh.port !== 22) {
    args.push('-p', String(ssh.port));
  }

  args.push(`${ssh.user}@${ssh.ip}`);

  return args;
}
