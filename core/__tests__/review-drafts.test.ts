import { expect, test } from 'vite-plus/test';
import {
  buildClassifiedReviewDraftModel,
  buildReviewDraftsJSON,
  getReviewDraftCounts,
} from '../lib/review-drafts.ts';
import type { PersistedReviewDraftSource, ReviewDraftClassification } from '../types.ts';

const comment = (id: string, body = `Comment ${id}`) => ({
  body,
  filePath: 'src/app.ts',
  id,
  lineNumber: 4,
  sectionId: 'src/app.ts:commit:1',
  side: 'additions' as const,
});

const source = (
  scopeKey: string,
  sourceKey: string,
  comments: PersistedReviewDraftSource['comments'],
): PersistedReviewDraftSource => ({
  comments,
  revision: 1,
  scope: { key: scopeKey, label: scopeKey, type: 'branch' },
  scopeKey,
  source: { ref: sourceKey.slice('commit:'.length), type: 'commit' },
  sourceKey,
  sourceSnapshot: { commit: sourceKey.slice('commit:'.length), type: 'commit' },
});

test('builds one classified model and derives every draft total from it', () => {
  const sources = [
    source('branch:main', 'commit:aaa', [comment('one'), comment('submitted')]),
    source('branch:main', 'commit:bbb', [comment('two')]),
    source('branch:other', 'commit:ccc', [comment('three')]),
  ];
  sources[0]!.comments[1]!.isReadOnly = true;
  const classifications: ReadonlyArray<ReviewDraftClassification> = [
    { disposition: 'current', id: 'branch:main\0commit:aaa\0one', reason: 'Reachable.' },
    {
      disposition: 'superseded',
      id: 'branch:main\0commit:bbb\0two',
      reason: 'Rewritten.',
    },
    { disposition: 'current', id: 'branch:other\0commit:ccc\0three', reason: 'Reachable.' },
  ];

  const model = buildClassifiedReviewDraftModel(sources, classifications);

  expect(
    model.map(({ disposition, id, scopeKey, sourceKey }) => ({
      disposition,
      id,
      scopeKey,
      sourceKey,
    })),
  ).toEqual([
    {
      disposition: 'current',
      id: 'one',
      scopeKey: 'branch:main',
      sourceKey: 'commit:aaa',
    },
    {
      disposition: 'superseded',
      id: 'two',
      scopeKey: 'branch:main',
      sourceKey: 'commit:bbb',
    },
    {
      disposition: 'current',
      id: 'three',
      scopeKey: 'branch:other',
      sourceKey: 'commit:ccc',
    },
  ]);
  expect(getReviewDraftCounts(model, 'branch:main')).toEqual({
    allInReview: 2,
    allRepository: 3,
    current: 1,
  });
  expect(
    JSON.parse(buildReviewDraftsJSON(model, (draft) => draft.scopeKey === 'branch:main')),
  ).toMatchObject([
    {
      comments: [{ body: 'Comment one', disposition: 'current', id: 'one' }],
      scopeKey: 'branch:main',
      sourceKey: 'commit:aaa',
      sourceSnapshot: { commit: 'aaa', type: 'commit' },
    },
    {
      comments: [{ body: 'Comment two', disposition: 'superseded', id: 'two' }],
      scopeKey: 'branch:main',
      sourceKey: 'commit:bbb',
    },
  ]);
});

test('keeps unclassified persisted drafts visible as legacy recovery data', () => {
  const model = buildClassifiedReviewDraftModel(
    [source('branch:main', 'commit:aaa', [comment('one')])],
    [],
  );

  expect(model[0]).toMatchObject({
    disposition: 'legacy',
    reason: 'Draft has not been classified.',
  });
  expect(getReviewDraftCounts(model, 'branch:main')).toEqual({
    allInReview: 1,
    allRepository: 1,
    current: 0,
  });
});
