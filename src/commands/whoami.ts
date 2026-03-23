import process from 'node:process';
import { buildApiHeaders } from '../lib/api-headers.js';
import { describeApiError } from '../lib/api-errors.js';
import { buildEndpoint } from '../lib/api-url.js';
import { requireAuth } from '../lib/require-auth.js';
import { box, keyHint, paint, statusLine } from '../lib/ui.js';

type WhoAmICommandOptions = {
  json: boolean;
  showToken: boolean;
  apiUrl?: string;
  quiet: boolean;
  verbose: boolean;
};

type MeResponse = {
  user?: {
    id?: string;
    email?: string;
    name?: string;
  };
};

export async function runWhoAmICommand(options: WhoAmICommandOptions): Promise<number> {
  const auth = await requireAuth(options.apiUrl);

  if (auth.error || !auth.context) {
    process.stderr.write('Not logged in. Run `ramp login` first.\n');
    return 1;
  }

  if (options.showToken) {
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            user: {
              email: auth.context.credentials.email ?? null,
            },
            apiUrl: auth.context.apiUrl,
            token: auth.context.credentials.token,
            authorization: `Bearer ${auth.context.credentials.token}`,
          },
          null,
          2,
        )}\n`,
      );
    } else if (!options.quiet) {
      process.stdout.write(
        `${box([
          statusLine(
            'success',
            `Logged in as ${paint(auth.context.credentials.email ?? 'unknown', 'bold')}`,
          ),
          `Authorization: Bearer ${auth.context.credentials.token}`,
          keyHint('Use `ramp mcp:cursor` for a ready-to-paste MCP snippet.'),
        ])}\n`,
      );
    }

    return 0;
  }

  try {
    const response = await fetch(buildEndpoint(auth.context.apiUrl, '/api/v1/auth/me'), {
      headers: buildApiHeaders({
        token: auth.context.credentials.token,
        selectedWorkspaceId: auth.context.credentials.selectedWorkspaceId,
      }),
    });

    if (!response.ok) {
      process.stderr.write(
        `${statusLine('error', await describeApiError(response, 'Failed to fetch profile'))}\n`,
      );
      return 1;
    }

    const payload = (await response.json()) as MeResponse;
    const user = payload.user;

    if (!user?.email) {
      process.stderr.write('Unexpected response from API.\n');
      return 1;
    }

    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            user,
            apiUrl: auth.context.apiUrl,
          },
          null,
          2,
        )}\n`,
      );
    } else if (!options.quiet) {
      process.stdout.write(`Logged in as ${user.email} (${user.name ?? 'unknown'}).\n`);

      if (options.verbose) {
        process.stdout.write(`API: ${auth.context.apiUrl}\n`);
      }
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    process.stderr.write(`Failed to fetch profile: ${message}\n`);
    return 1;
  }
}
