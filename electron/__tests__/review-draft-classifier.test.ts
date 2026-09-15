import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { expect, test } from 'vite-plus/test';
import {
  getGitTestEnvironmentForSubprocess,
  withGitTestEnvironment,
} from '../../core/__tests__/helpers/git.ts';
import { createTemporaryDirectory } from '../../core/__tests__/helpers/resources.ts';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { classifyReviewDrafts } = require('../review-draft-classifier.cjs') as {
  classifyReviewDrafts: (
    repositoryRoot: string,
    requests: ReadonlyArray<{
      id: string;
      currentSourceSnapshot?: Record<string, unknown>;
      scope: { key: string; label: string; type: string };
      sourceSnapshot: Record<string, unknown> | null;
    }>,
  ) => Promise<ReadonlyArray<{ disposition: string; id: string; reason: string }>>;
};

const git = async (repository: string, ...args: ReadonlyArray<string>) =>
  (
    await execFileAsync('git', ['-C', repository, ...args], {
      encoding: 'utf8',
      env: getGitTestEnvironmentForSubprocess(),
    })
  ).stdout.trim();

test('classifies reachable, rewritten, unavailable, and legacy commit drafts in one batch', () =>
  withGitTestEnvironment(async () => {
    await using directory = await createTemporaryDirectory('codiff-draft-classifier-');
    await git(directory.path, 'init');
    await git(directory.path, 'config', 'user.name', 'Codiff Test');
    await git(directory.path, 'config', 'user.email', 'codiff@example.com');
    await git(directory.path, 'commit', '--allow-empty', '-m', 'base');
    const base = await git(directory.path, 'rev-parse', 'HEAD');
    await git(directory.path, 'commit', '--allow-empty', '-m', 'old tip');
    const oldTip = await git(directory.path, 'rev-parse', 'HEAD');
    const branch = await git(directory.path, 'branch', '--show-current');
    await git(directory.path, 'reset', '--hard', base);
    await git(directory.path, 'commit', '--allow-empty', '-m', 'rewritten tip');

    const scope = { key: `branch:${branch}`, label: branch, type: 'branch' };
    const results = await classifyReviewDrafts(directory.path, [
      { id: 'reachable', scope, sourceSnapshot: { commit: base, type: 'commit' } },
      { id: 'rewritten', scope, sourceSnapshot: { commit: oldTip, type: 'commit' } },
      { id: 'missing', scope, sourceSnapshot: { commit: '0'.repeat(40), type: 'commit' } },
      { id: 'legacy', scope, sourceSnapshot: null },
    ]);

    expect(results).toEqual([
      {
        disposition: 'current',
        id: 'reachable',
        reason: 'Commit is in the current branch history.',
      },
      {
        disposition: 'superseded',
        id: 'rewritten',
        reason: 'Commit exists but is outside the current branch history.',
      },
      {
        disposition: 'unavailable',
        id: 'missing',
        reason: 'Commit is not available in this repository.',
      },
      { disposition: 'legacy', id: 'legacy', reason: 'Draft predates resolved source snapshots.' },
    ]);
  }));

test('compares resolved range endpoints instead of symbolic display refs', () =>
  withGitTestEnvironment(async () => {
    await using directory = await createTemporaryDirectory('codiff-draft-classifier-');
    await git(directory.path, 'init');
    await git(directory.path, 'config', 'user.name', 'Codiff Test');
    await git(directory.path, 'config', 'user.email', 'codiff@example.com');
    await git(directory.path, 'commit', '--allow-empty', '-m', 'base');
    const base = await git(directory.path, 'rev-parse', 'HEAD');
    await git(directory.path, 'commit', '--allow-empty', '-m', 'reviewed head');
    const reviewedHead = await git(directory.path, 'rev-parse', 'HEAD');
    await git(directory.path, 'commit', '--allow-empty', '-m', 'new head');
    const currentHead = await git(directory.path, 'rev-parse', 'HEAD');
    const reviewedSnapshot = {
      base: 'main',
      head: 'HEAD',
      resolvedBase: base,
      resolvedHead: reviewedHead,
      symmetric: false,
      type: 'range',
    };
    const currentSnapshot = { ...reviewedSnapshot, resolvedHead: currentHead };
    const scope = { key: 'source:range:main..HEAD', label: 'main..HEAD', type: 'source' };

    expect(
      await classifyReviewDrafts(directory.path, [
        {
          currentSourceSnapshot: currentSnapshot,
          id: 'range',
          scope,
          sourceSnapshot: reviewedSnapshot,
        },
      ]),
    ).toEqual([
      {
        disposition: 'superseded',
        id: 'range',
        reason: 'Resolved source no longer matches the current review.',
      },
    ]);
  }));
