import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { findConfigFile } from './find-config-file.js';

type OctaneReadinessResult =
    | { ok: true }
    | { ok: false; message: string; details: string[] };

export async function ensureLocalOctaneReady(): Promise<OctaneReadinessResult> {
    const configPath = await findConfigFile();

    if (configPath === null) {
        return { ok: true };
    }

    const yaml = await readFile(configPath, 'utf8');
    const document = parseDocument(yaml);

    if (document.errors.length > 0) {
        return { ok: true };
    }

    const parsed = document.toJSON() as {
        services?: Record<string, unknown>;
    } | null;

    if (
        parsed === null ||
        typeof parsed !== 'object' ||
        parsed.services === null ||
        typeof parsed.services !== 'object'
    ) {
        return { ok: true };
    }

    const usesOctane = Object.values(parsed.services).some((service) => {
        if (service === null || typeof service !== 'object') {
            return false;
        }

        const octane = (service as { octane?: unknown }).octane;

        return octane !== null && octane !== undefined;
    });

    if (!usesOctane) {
        return { ok: true };
    }

    const projectRoot = path.dirname(configPath);
    const composerCheck = await checkComposerForOctane(
        path.join(projectRoot, 'composer.json'),
    );
    const hasOctaneConfig = await fileExists(
        path.join(projectRoot, 'config', 'octane.php'),
    );
    const details: string[] = [];

    if (!composerCheck.ok) {
        details.push(composerCheck.detail);
    }

    if (!hasOctaneConfig) {
        details.push('Missing `config/octane.php`.');
    }

    if (details.length === 0) {
        return { ok: true };
    }

    details.push(
        'Run `composer require laravel/octane` and `php artisan octane:install --server=frankenphp` locally.',
    );

    return {
        ok: false,
        message:
            'Laravel Octane is configured in ramp.yaml, but this project is not Octane-ready.',
        details,
    };
}

async function checkComposerForOctane(
    composerPath: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
    if (!(await fileExists(composerPath))) {
        return {
            ok: false,
            detail: 'Missing `composer.json` dependency `laravel/octane`.',
        };
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(await readFile(composerPath, 'utf8')) as unknown;
    } catch {
        return {
            ok: false,
            detail: 'Unable to parse `composer.json` while checking for `laravel/octane`.',
        };
    }

    if (parsed === null || typeof parsed !== 'object') {
        return {
            ok: false,
            detail: 'Unable to read `composer.json` while checking for `laravel/octane`.',
        };
    }

    const requireMap = (parsed as { require?: Record<string, unknown> })
        .require;

    if (
        requireMap !== null &&
        typeof requireMap === 'object' &&
        typeof requireMap['laravel/octane'] === 'string' &&
        requireMap['laravel/octane'].trim() !== ''
    ) {
        return { ok: true };
    }

    return {
        ok: false,
        detail: 'Missing `composer.json` dependency `laravel/octane`.',
    };
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}
