import process from 'node:process';
import readline from 'node:readline';
import { keyHint, paint, promptLabel } from './ui.js';

export type SelectChoice<T> = {
  label: string;
  description?: string;
  value: T;
};

export async function selectManyWithArrows<T>(
  prompt: string,
  choices: SelectChoice<T>[],
  defaults: T[] = [],
): Promise<T[] | null> {
  if (!process.stdin.isTTY || choices.length === 0) {
    return null;
  }

  const input = process.stdin;
  const output = process.stdout;
  let index = 0;
  let linesPrinted = 0;
  const selected = new Set<number>();

  defaults.forEach((value) => {
    const idx = choices.findIndex((choice) => choice.value === value);

    if (idx >= 0) {
      selected.add(idx);
    }
  });

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  return new Promise<T[] | null>((resolve) => {
    const cleanup = (): void => {
      input.removeListener('keypress', onKeypress);

      if (input.isTTY) {
        input.setRawMode(false);
      }

      input.pause();
    };

    const finish = (value: T[] | null): void => {
      cleanup();
      output.write('\n');
      resolve(value);
    };

    const render = (): void => {
      if (linesPrinted > 0) {
        for (let i = 0; i < linesPrinted; i++) {
          output.write('\u001b[2K\r');

          if (i < linesPrinted - 1) {
            output.write('\u001b[1A');
          }
        }
      }

      const lines = [
        promptLabel(fitTerminalLine(prompt, output.columns)),
        keyHint(
          fitTerminalLine('↑/↓ move, Space toggle, Enter confirm, Esc cancel', output.columns),
        ),
        ...choices.map((choice, choiceIndex) => {
          const visibleWidth =
            typeof output.columns === 'number' ? Math.max(output.columns - 6, 12) : undefined;
          const pointer = choiceIndex === index ? paint('›', ['bold', 'cyan']) : paint('·', 'gray');
          const mark = selected.has(choiceIndex) ? paint('●', 'green') : paint('○', 'gray');
          const label = fitTerminalLine(choice.label, visibleWidth);
          const description =
            choice.description && choice.description.trim() !== ''
              ? ` ${paint(
                  fitTerminalLine(
                    choice.description,
                    Math.max((visibleWidth ?? 80) - label.length - 1, 12),
                  ),
                  'gray',
                )}`
              : '';

          return choiceIndex === index
            ? `${paint(`${pointer} ${mark} ${label}`, 'bold')}${description}`
            : `${pointer} ${mark} ${label}${description}`;
        }),
      ];

      output.write(lines.join('\n'));
      linesPrinted = lines.length;
    };

    const onKeypress = (str: string, key: readline.Key): void => {
      if (key.name === 'up') {
        index = (index - 1 + choices.length) % choices.length;
        render();

        return;
      }

      if (key.name === 'down') {
        index = (index + 1) % choices.length;
        render();

        return;
      }

      if (key.name === 'space' || str === ' ') {
        if (selected.has(index)) {
          selected.delete(index);
        } else {
          selected.add(index);
        }

        render();

        return;
      }

      if (key.name === 'return') {
        const values = [...selected]
          .sort((a, b) => a - b)
          .map((selectedIndex) => choices[selectedIndex]?.value)
          .filter((value): value is T => value !== undefined);

        finish(values);

        return;
      }

      if (key.name === 'escape' || (key.ctrl === true && key.name === 'c')) {
        finish(null);
      }
    };

    input.on('keypress', onKeypress);
    render();
  });
}

export async function selectWithArrows<T>(
  prompt: string,
  choices: SelectChoice<T>[],
): Promise<T | null> {
  if (!process.stdin.isTTY || choices.length === 0) {
    return null;
  }

  const input = process.stdin;
  const output = process.stdout;
  let index = 0;
  let linesPrinted = 0;

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  return new Promise<T | null>((resolve) => {
    const cleanup = (): void => {
      input.removeListener('keypress', onKeypress);
      if (input.isTTY) {
        input.setRawMode(false);
      }

      input.pause();
    };

    const finish = (value: T | null): void => {
      cleanup();
      output.write('\n');
      resolve(value);
    };

    const render = (): void => {
      if (linesPrinted > 0) {
        for (let i = 0; i < linesPrinted; i++) {
          output.write('\u001b[2K\r');

          if (i < linesPrinted - 1) {
            output.write('\u001b[1A');
          }
        }
      }

      const lines = [
        promptLabel(fitTerminalLine(prompt, output.columns)),
        keyHint(fitTerminalLine('↑/↓ move, Enter confirm, Esc cancel', output.columns)),
        ...choices.map((choice, choiceIndex) => {
          const visibleWidth =
            typeof output.columns === 'number' ? Math.max(output.columns - 4, 12) : undefined;
          const marker = choiceIndex === index ? paint('›', ['bold', 'cyan']) : paint('·', 'gray');
          const label = fitTerminalLine(choice.label, visibleWidth);
          const description =
            choice.description && choice.description.trim() !== ''
              ? ` ${paint(
                  fitTerminalLine(
                    choice.description,
                    Math.max((visibleWidth ?? 80) - label.length - 1, 12),
                  ),
                  'gray',
                )}`
              : '';

          return choiceIndex === index
            ? `${paint(`${marker} ${label}`, 'bold')}${description}`
            : `${marker} ${label}${description}`;
        }),
      ];

      output.write(lines.join('\n'));
      linesPrinted = lines.length;
    };

    const onKeypress = (_str: string, key: readline.Key): void => {
      if (key.name === 'up') {
        index = (index - 1 + choices.length) % choices.length;
        render();

        return;
      }

      if (key.name === 'down') {
        index = (index + 1) % choices.length;
        render();

        return;
      }

      if (key.name === 'return') {
        finish(choices[index]?.value ?? null);

        return;
      }

      if (key.name === 'escape' || (key.ctrl === true && key.name === 'c')) {
        finish(null);
      }
    };

    input.on('keypress', onKeypress);
    render();
  });
}

function fitTerminalLine(line: string, columns?: number): string {
  const width =
    typeof columns === 'number' && Number.isInteger(columns) && columns > 4 ? columns : 80;

  if (line.length < width) {
    return line;
  }

  return `${line.slice(0, width - 3)}...`;
}
