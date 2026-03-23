import process from 'node:process';

const reset = '\u001b[0m';

type StreamName = 'stdout' | 'stderr';

type UiColor = 'cyan' | 'green' | 'yellow' | 'red' | 'gray' | 'white' | 'bold' | 'inverse';

const colorCodes: Record<UiColor, string> = {
  cyan: '\u001b[36m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  gray: '\u001b[90m',
  white: '\u001b[37m',
  bold: '\u001b[1m',
  inverse: '\u001b[7m',
};

export function isInteractiveUi(stream: StreamName = 'stdout'): boolean {
  const output = stream === 'stderr' ? process.stderr : process.stdout;

  return output.isTTY === true;
}

export function paint(
  value: string,
  colors: UiColor | UiColor[],
  stream: StreamName = 'stdout',
): string {
  if (!isInteractiveUi(stream)) {
    return value;
  }

  const sequence = (Array.isArray(colors) ? colors : [colors])
    .map((color) => colorCodes[color])
    .join('');

  return `${sequence}${value}${reset}`;
}

export function promptLabel(label: string): string {
  return `${paint('?', ['bold', 'cyan'])} ${paint(label, 'bold')}`;
}

export function appHeader(name: string, title: string, subtitle?: string): string {
  const lines = [paint(`◆ ${name}`, ['bold', 'white'])];

  lines.push(paint(title, ['bold', 'cyan']));

  if (subtitle) {
    lines.push(paint(subtitle, 'gray'));
  }

  return lines.join('\n');
}

export function sectionHeader(title: string, subtitle?: string): string {
  return appHeader('Ramp', title, subtitle);
}

export function statusLine(
  tone: 'success' | 'warning' | 'error' | 'info',
  message: string,
): string {
  const icon =
    tone === 'success'
      ? paint('▲', 'green')
      : tone === 'warning'
        ? paint('■', 'yellow')
        : tone === 'error'
          ? paint('■', 'red', 'stderr')
          : paint('●', 'cyan');

  return `${icon} ${message}`;
}

export function keyHint(message: string): string {
  return paint(message, 'gray');
}

export function joinList(items: string[]): string {
  if (items.length === 0) {
    return 'none';
  }

  return items.join(', ');
}

export function badge(
  value: string,
  tone: 'neutral' | 'success' | 'warning' | 'error' | 'info' = 'neutral',
): string {
  const styled =
    tone === 'success'
      ? paint(value, 'green')
      : tone === 'warning'
        ? paint(value, 'yellow')
        : tone === 'error'
          ? paint(value, 'red')
          : tone === 'info'
            ? paint(value, 'cyan')
            : paint(value, 'gray');

  return `[${styled}]`;
}

export function toneForStatus(
  status: string,
): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  const normalized = status.trim().toLowerCase();

  if (
    normalized === 'live' ||
    normalized === 'ready' ||
    normalized === 'running' ||
    normalized === 'active' ||
    normalized === 'success' ||
    normalized === 'completed'
  ) {
    return 'success';
  }

  if (normalized === 'failed' || normalized === 'error' || normalized === 'stopped') {
    return 'error';
  }

  if (
    normalized === 'deploying' ||
    normalized === 'building' ||
    normalized === 'pending' ||
    normalized === 'queued' ||
    normalized === 'provisioning'
  ) {
    return 'warning';
  }

  if (normalized === 'unknown') {
    return 'neutral';
  }

  return 'info';
}

export function box(lines: string[]): string {
  const visibleLines = lines.filter((line) => line.length > 0);

  if (!isInteractiveUi() || visibleLines.length === 0) {
    return visibleLines.join('\n');
  }

  const width = Math.max(...visibleLines.map((line) => stripAnsi(line).length));
  const top = paint(`┌${'─'.repeat(width + 2)}┐`, 'gray');
  const bottom = paint(`└${'─'.repeat(width + 2)}┘`, 'gray');
  const body = visibleLines.map((line) => {
    const padding = ' '.repeat(width - stripAnsi(line).length);

    return `${paint('│', 'gray')} ${line}${padding} ${paint('│', 'gray')}`;
  });

  return [top, ...body, bottom].join('\n');
}

export function stepper(
  title: string,
  steps: Array<{ label: string; state: 'done' | 'current' | 'pending' }>,
): string {
  const rows = [
    paint(title, ['bold', 'white']),
    ...steps.map((step) => {
      const marker =
        step.state === 'done'
          ? paint('●', 'green')
          : step.state === 'current'
            ? paint('◆', 'cyan')
            : paint('○', 'gray');
      const label =
        step.state === 'current'
          ? paint(step.label, ['bold', 'cyan'])
          : step.state === 'done'
            ? paint(step.label, 'white')
            : paint(step.label, 'gray');

      return `${marker} ${label}`;
    }),
  ];

  return box(rows);
}

export function kvTable(rows: Array<{ key: string; value: string }>): string {
  if (rows.length === 0) {
    return '';
  }

  const keyWidth = Math.max(...rows.map((row) => row.key.length));

  return rows.map((row) => `${paint(row.key.padEnd(keyWidth), 'gray')}  ${row.value}`).join('\n');
}

export function brandBanner(): string {
  const wordmark = [
    paint('██████╗  █████╗ ███╗   ███╗██████╗', ['bold', 'white']),
    paint('██╔══██╗██╔══██╗████╗ ████║██╔══██╗', ['bold', 'white']),
    paint('██████╔╝███████║██╔████╔██║██████╔╝', ['bold', 'white']),
    paint('██╔══██╗██╔══██║██║╚██╔╝██║██╔═══╝ ', ['bold', 'white']),
    paint('██║  ██║██║  ██║██║ ╚═╝ ██║██║     ', ['bold', 'white']),
    paint('╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝     ', ['bold', 'white']),
    '',
    `${paint('                 ', 'gray')}${paint('ramp.sh', ['bold', 'cyan'])}`,
  ];

  return wordmark.join('\n');
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}
