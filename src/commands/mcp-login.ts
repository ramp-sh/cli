import process from 'node:process';
import { readMcpConnection } from '../lib/mcp-connection.js';
import { box, keyHint, paint, statusLine } from '../lib/ui.js';

type McpLoginCommandOptions = {
    json: boolean;
    tokenOnly: boolean;
    apiUrl?: string;
    quiet: boolean;
    verbose: boolean;
};

export async function runMcpLoginCommand(
    options: McpLoginCommandOptions,
): Promise<number> {
    const result = await readMcpConnection(options.apiUrl);

    if (result.status === 'missing') {
        process.stderr.write('Not logged in. Run `ramp login` first.\n');
        return 1;
    }

    if (result.status === 'invalid') {
        process.stderr.write(`${statusLine('error', result.message)}\n`);
        return 1;
    }

    const { connection } = result;

    if (options.tokenOnly) {
        process.stdout.write(`${connection.token}\n`);
        return 0;
    }

    if (options.json) {
        process.stdout.write(
            `${JSON.stringify(
                {
                    ok: true,
                    ...connection,
                },
                null,
                2,
            )}\n`,
        );

        return 0;
    }

    process.stdout.write(
        `${box([
            statusLine(
                'success',
                `MCP ready for ${paint(connection.email ?? 'current account', 'bold')}`,
            ),
            `URL: ${paint(connection.url, 'bold')}`,
            `Authorization: ${connection.authorization}`,
            keyHint('Use this with a web MCP client that supports custom headers.'),
        ])}\n`,
    );

    if (options.verbose) {
        process.stdout.write(
            `${keyHint('Tip: `ramp mcp:login --token-only` prints just the token.')}\n`,
        );
    }

    return 0;
}
