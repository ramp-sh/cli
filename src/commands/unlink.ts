import process from 'node:process';
import { findUpFile } from '../lib/find-up-file.js';
import { removeProjectLink } from '../lib/project-link.js';

type UnlinkCommandOptions = {
    json: boolean;
    quiet: boolean;
    verbose: boolean;
};

export async function runUnlinkCommand(
    options: UnlinkCommandOptions,
): Promise<number> {
    const linkPath = await findUpFile('.ramp/config.json');

    if (linkPath === null) {
        if (options.json) {
            process.stdout.write(
                `${JSON.stringify({ removed: false, reason: 'not-linked' }, null, 2)}\n`,
            );
        } else if (!options.quiet) {
            process.stdout.write(
                'No .ramp/config.json found for this directory.\n',
            );
        }

        return 0;
    }

    await removeProjectLink(linkPath);

    if (options.json) {
        process.stdout.write(
            `${JSON.stringify({ removed: true, path: linkPath }, null, 2)}\n`,
        );
    } else if (!options.quiet) {
        process.stdout.write(`Removed ${linkPath}\n`);
    }

    return 0;
}
