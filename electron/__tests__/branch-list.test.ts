import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const { listLocalBranches } = require('../branch-list.cjs') as {
  listLocalBranches: (repositoryRoot: string) => Promise<
    ReadonlyArray<{
      baseRef: string;
      createdAt: number | null;
      headRef: string;
      name: string;
      subject: string;
      updatedAt: number;
      upstream: string | null;
      worktreePath: string | null;
    }>
  >;
};

const git = (root: string, args: ReadonlyArray<string>) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

test('lists local branches with resolved review endpoints and freshness', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codiff-branches-'));
  try {
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'reviewer@example.com']);
    git(root, ['config', 'user.name', 'Reviewer']);
    writeFileSync(join(root, 'file.txt'), 'base\n');
    git(root, ['add', 'file.txt']);
    git(root, ['commit', '-m', 'Base commit']);
    git(root, ['checkout', '-b', 'feature/recent']);
    writeFileSync(join(root, 'file.txt'), 'feature\n');
    git(root, ['commit', '-am', 'Feature work']);
    git(root, ['checkout', 'main']);

    const branches = await listLocalBranches(root);
    const feature = branches.find(({ name }) => name === 'feature/recent');
    expect(feature).toMatchObject({
      name: 'feature/recent',
      subject: 'Feature work',
      upstream: null,
      worktreePath: null,
    });
    expect(feature?.baseRef).toBe(git(root, ['rev-parse', 'main']));
    expect(feature?.headRef).toBe(git(root, ['rev-parse', 'feature/recent']));
    expect(feature?.createdAt).toEqual(expect.any(Number));
    expect(branches.find(({ name }) => name === 'main')?.worktreePath).toBe(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
