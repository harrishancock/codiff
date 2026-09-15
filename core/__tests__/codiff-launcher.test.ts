import { execFile } from 'node:child_process';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { delimiter, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vite-plus/test';
import { createTemporaryDirectory } from './helpers/resources.ts';

const execFileAsync = promisify(execFile);
const launcher = resolve('bin/codiff');

const writeCommand = async (path: string, contents: string) => {
  await writeFile(path, `#!/bin/sh\n${contents}`);
  await chmod(path, 0o755);
};

test('launcher uses a supported ambient Node and forwards arguments', async () => {
  await using directory = await createTemporaryDirectory('codiff-launcher-');
  const log = `${directory.path}/node-args`;
  await writeCommand(
    `${directory.path}/node`,
    'if [ "$1" = "-e" ]; then exit 0; fi\nprintf "%s\\n" "$@" > "$CODIFF_TEST_LOG"\n',
  );

  await execFileAsync(launcher, ['path with spaces', '--walkthrough'], {
    env: {
      ...process.env,
      CODIFF_TEST_LOG: log,
      PATH: `${directory.path}${delimiter}${process.env.PATH}`,
    },
  });

  expect((await readFile(log, 'utf8')).trim().split('\n')).toEqual([
    resolve('bin/codiff.js'),
    'path with spaces',
    '--walkthrough',
  ]);
});

test('launcher uses the source checkout mise runtime when ambient Node is unsupported', async () => {
  await using directory = await createTemporaryDirectory('codiff-launcher-');
  const log = `${directory.path}/mise-args`;
  await writeCommand(`${directory.path}/node`, 'exit 1\n');
  await writeCommand(`${directory.path}/mise`, 'printf "%s\\n" "$@" > "$CODIFF_TEST_LOG"\n');

  await execFileAsync(launcher, ['workerd'], {
    env: {
      ...process.env,
      CODIFF_TEST_LOG: log,
      PATH: `${directory.path}${delimiter}${process.env.PATH}`,
    },
  });

  expect((await readFile(log, 'utf8')).trim().split('\n')).toEqual([
    'exec',
    '-C',
    resolve('.'),
    '--',
    'node',
    resolve('bin/codiff.js'),
    'workerd',
  ]);
});

test('launcher explains an unsupported runtime before loading application code', async () => {
  await using directory = await createTemporaryDirectory('codiff-launcher-');
  await writeCommand(
    `${directory.path}/node`,
    'if [ "$1" = "--version" ]; then printf "v18.19.1\\n"; exit 0; fi\nexit 1\n',
  );

  const result = await execFileAsync(launcher, ['workerd'], {
    env: { ...process.env, PATH: `${directory.path}${delimiter}/usr/bin:/bin` },
  }).catch((error: unknown) => error as { code: number; stderr: string });

  expect(result).toMatchObject({
    code: 1,
    stderr:
      'codiff: Node.js 23 or newer is required (found: v18.19.1).\n' +
      'Install a supported Node.js version and try again.\n',
  });
});
