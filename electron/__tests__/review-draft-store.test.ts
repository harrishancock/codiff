import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const { createReviewDraftStore } = require('../review-draft-store.cjs') as {
  createReviewDraftStore: (path: string) => {
    clearRepository: (repositoryRoot: string) => number;
    close: () => void;
    loadRepository: (repositoryRoot: string) => ReadonlyArray<{
      comments: ReadonlyArray<Record<string, unknown>>;
      revision: number;
      scope: Record<string, unknown>;
      scopeKey: string;
      source: Record<string, unknown>;
      sourceKey: string;
    }>;
    saveSource: (snapshot: {
      comments: ReadonlyArray<Record<string, unknown>>;
      repositoryRoot: string;
      revision: number;
      scope: Record<string, unknown>;
      scopeKey: string;
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

const scope = { key: 'branch:feature', label: 'feature', type: 'branch' };

test('persists mutable drafts by repository and source', () => {
  const store = createReviewDraftStore(':memory:');
  const snapshot = {
    comments: [comment('draft-1', 'Keep this.')],
    repositoryRoot: '/repo/one',
    revision: 1,
    scope,
    scopeKey: scope.key,
    source: { ref: 'abc123', type: 'commit' },
    sourceKey: 'commit:abc123',
  };

  expect(store.saveSource(snapshot)).toBe(true);
  expect(store.loadRepository('/repo/one')).toEqual([
    {
      comments: snapshot.comments,
      revision: 1,
      scope,
      scopeKey: scope.key,
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
    scope,
    scopeKey: scope.key,
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
      scope,
      scopeKey: scope.key,
      source: { type: 'working-tree' },
      sourceKey,
    });
  }

  expect(store.clearRepository('/repo/one')).toBe(2);
  expect(store.loadRepository('/repo/one')).toEqual([]);
  expect(store.loadRepository('/repo/two')).toHaveLength(1);
  store.close();
});

test('keeps the same source independent in different review scopes', () => {
  const store = createReviewDraftStore(':memory:');
  for (const branch of ['feature-a', 'feature-b']) {
    store.saveSource({
      comments: [comment(branch, `Draft for ${branch}.`)],
      repositoryRoot: '/repo',
      revision: 1,
      scope: { key: `branch:${branch}`, label: branch, type: 'branch' },
      scopeKey: `branch:${branch}`,
      source: { type: 'working-tree' },
      sourceKey: 'working-tree',
    });
  }

  expect(store.loadRepository('/repo').map(({ scopeKey }) => scopeKey)).toEqual([
    'branch:feature-a',
    'branch:feature-b',
  ]);
  store.close();
});

test('migrates unscoped drafts into the legacy recovery scope', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codiff-drafts-'));
  const databasePath = join(directory, 'drafts.sqlite3');
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE review_draft_sources (
      repository_root TEXT NOT NULL, source_key TEXT NOT NULL, source_json TEXT NOT NULL,
      revision INTEGER NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (repository_root, source_key)
    ) STRICT;
    CREATE TABLE review_drafts (
      repository_root TEXT NOT NULL, source_key TEXT NOT NULL, comment_id TEXT NOT NULL,
      comment_json TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (repository_root, source_key, comment_id),
      FOREIGN KEY (repository_root, source_key)
        REFERENCES review_draft_sources (repository_root, source_key) ON DELETE CASCADE
    ) STRICT;
    INSERT INTO review_draft_sources VALUES
      ('/repo', 'working-tree', '{"type":"working-tree"}', 4, '2026-09-11T00:00:00Z');
    INSERT INTO review_drafts VALUES
      ('/repo', 'working-tree', 'draft-1', '${JSON.stringify(comment('draft-1', 'Recovered.'))}',
       '2026-09-11T00:00:00Z');
    PRAGMA user_version = 1;
  `);
  database.close();

  try {
    const store = createReviewDraftStore(databasePath);
    expect(store.loadRepository('/repo')[0]).toMatchObject({
      comments: [comment('draft-1', 'Recovered.')],
      revision: 4,
      scope: { key: 'legacy', label: 'Legacy / recovered', type: 'legacy' },
      scopeKey: 'legacy',
    });
    store.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
