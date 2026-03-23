import process from 'node:process';
import readline from 'node:readline/promises';
import { promptLabel } from './ui.js';

export async function askOrCancel(rl: readline.Interface, prompt: string): Promise<string | null> {
  try {
    // Arrow-key selectors pause stdin during cleanup; resume it before
    // handing control to readline questions or they can reject immediately.
    process.stdin.resume();

    const answer = await rl.question(promptLabel(prompt));
    const trimmed = answer.trim();

    if (trimmed === '\u001b') {
      return null;
    }

    return answer;
  } catch (error) {
    if (
      process.stdin.isTTY &&
      error instanceof Error &&
      'code' in error &&
      error.code === 'ERR_USE_AFTER_CLOSE'
    ) {
      return askWithStdin(prompt);
    }

    return null;
  }
}

export function wireSigintToClose(rl: readline.Interface): void {
  rl.on('SIGINT', () => {
    rl.close();
  });
}

async function askWithStdin(prompt: string): Promise<string | null> {
  const input = process.stdin;
  const output = process.stdout;

  if (input.isTTY) {
    input.setRawMode(false);
  }

  input.resume();
  output.write(promptLabel(prompt));

  return new Promise<string | null>((resolve) => {
    const onData = (chunk: string | Buffer): void => {
      cleanup();

      const answer = String(chunk).replace(/[\r\n]+$/, '');

      if (answer === '\u001b') {
        resolve(null);
        return;
      }

      resolve(answer);
    };

    const onSigint = (): void => {
      cleanup();
      output.write('\n');
      resolve(null);
    };

    const cleanup = (): void => {
      input.removeListener('data', onData);
      process.removeListener('SIGINT', onSigint);
      input.pause();
    };

    input.on('data', onData);
    process.once('SIGINT', onSigint);
  });
}
