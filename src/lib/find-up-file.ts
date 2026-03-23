import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export async function findUpFile(
    fileName: string,
    startDir?: string,
): Promise<string | null> {
    let currentDirectory = startDir ? path.resolve(startDir) : process.cwd();

    while (true) {
        const candidate = path.join(currentDirectory, fileName);

        if (await exists(candidate)) {
            return candidate;
        }

        const parentDirectory = path.dirname(currentDirectory);

        if (parentDirectory === currentDirectory) {
            return null;
        }

        currentDirectory = parentDirectory;
    }
}

async function exists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}
