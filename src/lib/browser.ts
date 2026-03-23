import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import process from 'node:process';

type SpawnSyncLike = (
  command: string,
  args?: readonly string[],
  options?: { stdio?: 'ignore' },
) => SpawnSyncReturns<Buffer>;

export function tryOpenBrowser(
  url: string,
  spawnSyncImpl: SpawnSyncLike = spawnSync,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (process.env.RAMP_DISABLE_BROWSER_OPEN === '1') {
    return false;
  }

  const command = browserOpenCommand(url, platform);

  if (!command) {
    return false;
  }

  const result = spawnSyncImpl(command.command, command.args, {
    stdio: 'ignore',
  });

  return !result.error && result.status === 0;
}

export function browserOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } | null {
  if (platform === 'darwin') {
    return { command: 'open', args: [url] };
  }

  if (platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', url] };
  }

  if (platform === 'linux') {
    return { command: 'xdg-open', args: [url] };
  }

  return null;
}
