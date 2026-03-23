import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(rootDir, 'dist', 'bin.js');

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  });
}

test('top-level help groups commands into clearer sections', () => {
  const result = runCli(['--help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Getting started:/);
  assert.match(result.stdout, /Project workflow:/);
  assert.match(result.stdout, /Account & access:/);
  assert.match(result.stdout, /AI & MCP:/);
  assert.match(result.stdout, /Examples:/);

  const projectWorkflowIndex = result.stdout.indexOf('Project workflow:');
  const accountIndex = result.stdout.indexOf('Account & access:');
  const aiIndex = result.stdout.indexOf('AI & MCP:');

  assert.notEqual(projectWorkflowIndex, -1);
  assert.notEqual(accountIndex, -1);
  assert.notEqual(aiIndex, -1);
  assert.ok(projectWorkflowIndex < accountIndex);
  assert.ok(projectWorkflowIndex < aiIndex);

  assert.match(result.stdout, /open\|browser \[options\]/);
  assert.match(result.stdout, /dashboard \[options\]/);
  assert.match(result.stdout, /claude \[options\]/);
  assert.match(result.stdout, /mcp:cursor \[options\]/);
});
