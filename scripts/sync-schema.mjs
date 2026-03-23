import { cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..');
const sourceOverride = process.env.RAMP_SCHEMA_SOURCE?.trim();
const destination = path.join(rootDir, 'src', 'schema', 'ramp.schema.json');

if (!sourceOverride) {
  process.stdout.write(
    `Schema already lives in this repo at ${destination}.\nSet RAMP_SCHEMA_SOURCE to sync from an external schema file.\n`,
  );
  process.exit(0);
}

const source = path.resolve(process.cwd(), sourceOverride);

if (source === destination) {
  process.stdout.write(`Schema is already up to date at ${destination}\n`);
  process.exit(0);
}

await cp(source, destination);

process.stdout.write(`Synced schema to ${destination}\n`);
