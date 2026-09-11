import { createRequire } from 'node:module';
import { expect, test } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const { createReviewDraftStore } = require('../review-draft-store.cjs') as {
  createReviewDraftStore: (path: string) => {
    clearRepository: (repositoryRoot: string) => number;
    close: () => void;
    loadRepository: (repositoryRoot: string) => ReadonlyArray<{
      comments: ReadonlyArray<Record<string, unknown>>;
      revision: number;
      source: Record<string, unknown>;
      sourceKey: string;
    }>;
    saveSource: (snapshot: {
      comments: ReadonlyArray<Record<string, unknown>>;
      repositoryRoot: string;
      revision: number;
      source: Record<string, unknown>;
      sourceKey: string;
    }) => boolean;
  };
};

const comment = (id: string, body: string) => ({
  body,
  filePath: 'src/app.ts',
  id,
  lineNumber: 4,
  sectionId: 'src/app.ts:staged:1',
  side: 'additions',
});

test('persists mutable drafts by repository and source', () => {
  const store = createReviewDraftStore(':memory:');
  const snapshot = {
    comments: [comment('draft-1', 'Keep this.')],
    repositoryRoot: '/repo/one',
    revision: 1,
    source: { ref: 'abc123', type: 'commit' },
    sourceKey: 'commit:abc123',
  };

  expect(store.saveSource(snapshot)).toBe(true);
  expect(store.loadRepository('/repo/one')).toEqual([
    {
      comments: snapshot.comments,
      revision: 1,
      source: snapshot.source,
      sourceKey: snapshot.sourceKey,
    },
  ]);
  expect(store.loadRepository('/repo/two')).toEqual([]);
  store.close();
});

test('rejects stale source snapshots and excludes submitted comments', () => {
  const store = createReviewDraftStore(':memory:');
  const base = {
    repositoryRoot: '/repo',
    source: { type: 'working-tree' },
    sourceKey: 'working-tree',
  };

  expect(
    store.saveSource({
      ...base,
      comments: [comment('draft-1', 'Newest body.')],
      revision: 2,
    }),
  ).toBe(true);
  expect(
    store.saveSource({
      ...base,
      comments: [comment('draft-1', 'Stale body.')],
      revision: 1,
    }),
  ).toBe(false);
  expect(
    store.saveSource({
      ...base,
      comments: [{ ...comment('submitted', 'Remote.'), isReadOnly: true }],
      revision: 3,
    }),
  ).toBe(true);
  expect(store.loadRepository('/repo')[0]?.comments).toEqual([]);
  store.close();
});

test('clears every source for only the selected repository', () => {
  const store = createReviewDraftStore(':memory:');
  for (const [repositoryRoot, sourceKey] of [
    ['/repo/one', 'working-tree'],
    ['/repo/one', 'commit:abc'],
    ['/repo/two', 'working-tree'],
  ]) {
    store.saveSource({
      comments: [comment(`${repositoryRoot}:${sourceKey}`, 'Draft.')],
      repositoryRoot,
      revision: 1,
      source: { type: 'working-tree' },
      sourceKey,
    });
  }

  expect(store.clearRepository('/repo/one')).toBe(2);
  expect(store.loadRepository('/repo/one')).toEqual([]);
  expect(store.loadRepository('/repo/two')).toHaveLength(1);
  store.close();
});
