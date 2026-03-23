export function buildBashLoginCommand(command: string): string {
  return `bash -lic ${shellEscape(command)}`;
}

export function buildRemoteTmuxCommand(
  sessionName: string,
  workingDirectory: string,
  binary: string,
): string {
  const safeWorkingDirectory = assertSafeWorkingDirectory(workingDirectory);
  const launchCommand = buildBashLoginCommand(binary);

  return `tmux new-session -A -s ${shellEscape(sessionName)} -c ${shellEscape(safeWorkingDirectory)} ${shellEscape(launchCommand)}`;
}

export function toSafeTmuxSessionName(value: string): string {
  const safeValue = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return safeValue === '' ? 'ramp-session' : safeValue;
}

function assertSafeWorkingDirectory(value: string): string {
  if (value.trim() === '' || /[\0\r\n]/.test(value)) {
    throw new Error('Server returned an invalid SSH working directory.');
  }

  return value;
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
