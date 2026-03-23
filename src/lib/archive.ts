import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileExists } from './file-exists.js';
import { formatFileSize } from './format-size.js';

const execFileAsync = promisify(execFile);

const BUILT_IN_EXCLUDES = ['.git', '.ramp', '.DS_Store', 'Thumbs.db'];

const DEFAULT_EXCLUDES = ['node_modules', 'vendor', '.env'];

/**
 * Package the project directory into a .tar.gz archive, respecting
 * .gitignore, .rampignore, and built-in excludes.
 *
 * Returns the absolute path to the created archive.
 */
export async function createProjectArchive(
  projectRoot: string,
): Promise<{ archivePath: string; error: string | null }> {
  const excludePatterns: string[] = [];

  // Built-in excludes (always applied)
  excludePatterns.push(...BUILT_IN_EXCLUDES);

  // Default excludes (overridable via !negation in .rampignore)
  excludePatterns.push(...DEFAULT_EXCLUDES);

  // .gitignore (honored even without .git/)
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (await fileExists(gitignorePath)) {
    const content = await readFile(gitignorePath, 'utf8');
    const patterns = parseIgnoreFile(content);
    excludePatterns.push(...patterns);
  }

  // .rampignore (applied on top)
  const rampignorePath = path.join(projectRoot, '.rampignore');
  if (await fileExists(rampignorePath)) {
    const content = await readFile(rampignorePath, 'utf8');
    const patterns = parseIgnoreFile(content);

    // !negation patterns re-include previously excluded entries
    for (const pattern of patterns) {
      if (pattern.startsWith('!')) {
        const negated = pattern.slice(1);
        const idx = excludePatterns.indexOf(negated);
        if (idx !== -1) {
          excludePatterns.splice(idx, 1);
        }
      } else {
        excludePatterns.push(pattern);
      }
    }
  }

  const archiveName = `ramp-upload-${Date.now()}.tar.gz`;
  const archivePath = path.join(projectRoot, archiveName);

  // Also exclude the archive itself
  excludePatterns.push(archiveName);

  // Build tar --exclude args
  const excludeArgs: string[] = [];
  for (const pattern of excludePatterns) {
    excludeArgs.push('--exclude', pattern);
  }

  try {
    await execFileAsync('tar', ['-czf', archivePath, ...excludeArgs, '-C', projectRoot, '.'], {
      cwd: projectRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      archivePath: '',
      error: `Failed to create archive: ${message}`,
    };
  }

  // Check archive size (500 MB cap)
  const archiveStat = await stat(archivePath);
  const maxSize = 500 * 1024 * 1024;

  if (archiveStat.size > maxSize) {
    const archiveSize = formatFileSize(archiveStat.size);
    return {
      archivePath,
      error: `Archive is ${archiveSize}, exceeding the 500 MB limit.`,
    };
  }

  return { archivePath, error: null };
}

/**
 * Parse a .gitignore/.rampignore file into an array of patterns.
 * Strips comments and empty lines.
 */
function parseIgnoreFile(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}
