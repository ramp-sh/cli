import process from 'node:process';
import { readMcpConnection } from '../lib/mcp-connection.js';
import { box, keyHint, paint, statusLine } from '../lib/ui.js';

type McpCursorCommandOptions = {
  json: boolean;
  apiUrl?: string;
  quiet: boolean;
  verbose: boolean;
};

export async function runMcpCursorCommand(options: McpCursorCommandOptions): Promise<number> {
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

  const snippet = {
    mcpServers: {
      ramp: {
        url: connection.url,
        headers: {
          Authorization: connection.authorization,
        },
      },
    },
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(snippet, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(
    `${box([
      statusLine(
        'success',
        `Cursor MCP snippet for ${paint(connection.email ?? 'current account', 'bold')}`,
      ),
      keyHint('Copy this into your MCP client config:'),
    ])}\n`,
  );
  process.stdout.write(`${JSON.stringify(snippet, null, 2)}\n`);

  return 0;
}
