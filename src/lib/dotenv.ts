import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

export type DotEnvEntry = {
  key: string;
  value: string;
};

export type DotEnvFile = {
  path: string;
  displayPath: string;
  entries: DotEnvEntry[];
};

export const DEFAULT_DOTENV_FILENAMES = ['.env.example', '.env', '.env.local'] as const;

export function parseDotEnvContent(content: string): DotEnvEntry[] {
  const entries: DotEnvEntry[] = [];

  for (const rawLine of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);

    if (!match) {
      continue;
    }

    entries.push({
      key: match[1],
      value: parseDotEnvValue(match[2] ?? ''),
    });
  }

  return entries;
}

export async function discoverDotEnvFiles(
  cwd: string,
  explicitFile?: string,
): Promise<DotEnvFile[]> {
  const candidates = explicitFile
    ? [path.resolve(cwd, explicitFile)]
    : DEFAULT_DOTENV_FILENAMES.map((filename) => path.join(cwd, filename));

  const files: DotEnvFile[] = [];

  for (const candidate of candidates) {
    if (!(await canReadFile(candidate))) {
      continue;
    }

    const content = await readFile(candidate, 'utf8');
    const entries = parseDotEnvContent(content);

    files.push({
      path: candidate,
      displayPath: path.relative(cwd, candidate) || path.basename(candidate),
      entries,
    });
  }

  return files;
}

export function uniqueDotEnvKeys(files: DotEnvFile[]): string[] {
  const keys = new Set<string>();

  for (const file of files) {
    for (const entry of file.entries) {
      keys.add(entry.key);
    }
  }

  return [...keys].sort((a, b) => a.localeCompare(b));
}

async function canReadFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseDotEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();

  if (trimmed === '') {
    return '';
  }

  const quote = trimmed[0];

  if (quote === '"' || quote === "'") {
    const closingQuoteIndex = findClosingQuote(trimmed, quote);

    if (closingQuoteIndex > 0) {
      const inner = trimmed.slice(1, closingQuoteIndex);

      if (quote === '"') {
        return inner
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }

      return inner;
    }
  }

  return trimmed.replace(/\s+#.*$/, '');
}

function findClosingQuote(value: string, quote: '"' | "'"): number {
  let escaped = false;

  for (let index = 1; index < value.length; index++) {
    const character = value[index];

    if (quote === '"' && !escaped && character === '\\') {
      escaped = true;
      continue;
    }

    if (!escaped && character === quote) {
      return index;
    }

    escaped = false;
  }

  return -1;
}
