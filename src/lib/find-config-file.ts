import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { findUpFile } from './find-up-file.js';

export async function findConfigFile(file?: string): Promise<string | null> {
    if (typeof file === 'string' && file.trim() !== '') {
        const directPath = path.resolve(process.cwd(), file);

        if (await exists(directPath)) {
            return directPath;
        }

        return null;
    }

    return findUpFile('ramp.yaml');
}

async function exists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);

        return true;
    } catch {
        return false;
    }
}
