// @ts-check

const { stat } = require('node:fs/promises');
const { resolve } = require('node:path');
const { git, gitOrEmpty } = require('./git-state/common.cjs');

/** @param {string} raw */
const parseWorktrees = (raw) => {
  /** @type {Map<string, string>} */
  const paths = new Map();
  let path = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
    if (line.startsWith('branch refs/heads/'))
      paths.set(line.slice('branch refs/heads/'.length), path);
  }
  return paths;
};

/** @param {string} repositoryRoot @param {string} name */
const readCreatedAt = async (repositoryRoot, name) => {
  const raw = await gitOrEmpty(repositoryRoot, [
    'reflog',
    'show',
    '--format=%ct',
    `refs/heads/${name}`,
  ]);
  const timestamps = raw.trim().split('\n').filter(Boolean);
  const timestamp = Number(timestamps.at(-1));
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : null;
};

/** @param {string} repositoryRoot @param {string} name */
const readRefMtime = async (repositoryRoot, name) => {
  const path = (
    await gitOrEmpty(repositoryRoot, ['rev-parse', '--git-path', `refs/heads/${name}`])
  ).trim();
  if (!path) return null;
  try {
    return (await stat(resolve(repositoryRoot, path))).mtimeMs;
  } catch {
    return null;
  }
};

/** @param {string} repositoryRoot */
const listLocalBranches = async (repositoryRoot) => {
  const raw = await git(repositoryRoot, [
    'for-each-ref',
    '--format=%(refname:short)%00%(objectname)%00%(upstream:short)%00%(committerdate:unix)%00%(subject)',
    'refs/heads',
  ]);
  const records = raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name = '', headRef = '', upstream = '', updatedAt = '0', subject = ''] =
        line.split('\0');
      return {
        headRef,
        name,
        subject,
        updatedAt: Number(updatedAt) * 1000,
        upstream: upstream || null,
      };
    });
  const names = new Set(records.map(({ name }) => name));
  const defaultBranch = names.has('main')
    ? 'main'
    : names.has('master')
      ? 'master'
      : records[0]?.name;
  const worktrees = parseWorktrees(
    await gitOrEmpty(repositoryRoot, ['worktree', 'list', '--porcelain']),
  );

  return Promise.all(
    records.map(async (record) => {
      const baseName = defaultBranch ?? record.name;
      const baseRef = (await git(repositoryRoot, ['merge-base', baseName, record.headRef])).trim();
      const [createdAt, refMtime] = await Promise.all([
        readCreatedAt(repositoryRoot, record.name),
        readRefMtime(repositoryRoot, record.name),
      ]);
      return {
        ...record,
        baseRef,
        createdAt,
        refMtime,
        worktreePath: worktrees.get(record.name) ?? null,
      };
    }),
  );
};

module.exports = { listLocalBranches };
