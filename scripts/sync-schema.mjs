import { cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..', '..', '..');

const source = path.join(rootDir, 'docs', 'ramp', 'ramp.schema.json');
const destination = path.join(rootDir, 'packages', 'cli', 'src', 'schema', 'ramp.schema.json');

await cp(source, destination);

process.stdout.write(`Synced schema to ${destination}\n`);
