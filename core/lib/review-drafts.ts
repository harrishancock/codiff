import type {
  PersistedReviewDraftSource,
  ReviewDraftClassification,
  ReviewDraftDisposition,
  ReviewScope,
  ReviewSource,
  ReviewSourceSnapshot,
} from '../types.ts';
import type { ReviewComment } from './app-types.ts';

export type ClassifiedReviewDraft = {
  comment: ReviewComment;
  disposition: ReviewDraftDisposition;
  id: string;
  reason: string;
  scope: ReviewScope;
  scopeKey: string;
  source: ReviewSource;
  sourceKey: string;
  sourceSnapshot: ReviewSourceSnapshot | null;
};

export const getReviewDraftClassificationId = (
  scopeKey: string,
  sourceKey: string,
  commentId: string,
) => `${scopeKey}\0${sourceKey}\0${commentId}`;

export const buildClassifiedReviewDraftModel = (
  sources: ReadonlyArray<PersistedReviewDraftSource>,
  classifications: ReadonlyArray<ReviewDraftClassification>,
): ReadonlyArray<ClassifiedReviewDraft> => {
  const classificationById = new Map(classifications.map((item) => [item.id, item]));
  return sources.flatMap((source) =>
    source.comments
      .filter((comment) => !comment.isReadOnly && comment.body.trim())
      .map((comment) => {
        const classification = classificationById.get(
          getReviewDraftClassificationId(source.scopeKey, source.sourceKey, comment.id),
        );
        return {
          comment,
          disposition: classification?.disposition ?? 'legacy',
          id: comment.id,
          reason: classification?.reason ?? 'Draft has not been classified.',
          scope: source.scope,
          scopeKey: source.scopeKey,
          source: source.source,
          sourceKey: source.sourceKey,
          sourceSnapshot: source.sourceSnapshot ?? null,
        };
      }),
  );
};

export const getReviewDraftCounts = (
  drafts: ReadonlyArray<ClassifiedReviewDraft>,
  activeScopeKey: string,
) => {
  const activeDrafts = drafts.filter(({ scopeKey }) => scopeKey === activeScopeKey);
  return {
    allInReview: activeDrafts.length,
    allRepository: drafts.length,
    current: activeDrafts.filter(({ disposition }) => disposition === 'current').length,
  };
};

export const buildReviewDraftsJSON = (
  drafts: ReadonlyArray<ClassifiedReviewDraft>,
  include: (draft: ClassifiedReviewDraft) => boolean = () => true,
) => {
  const groups = new Map<
    string,
    {
      comments: Array<Record<string, unknown>>;
      scope: ReviewScope;
      scopeKey: string;
      source: ReviewSource;
      sourceKey: string;
      sourceSnapshot: ReviewSourceSnapshot | null;
    }
  >();
  for (const draft of drafts.filter(include)) {
    const key = `${draft.scopeKey}\0${draft.sourceKey}`;
    const group = groups.get(key) ?? {
      comments: [],
      scope: draft.scope,
      scopeKey: draft.scopeKey,
      source: draft.source,
      sourceKey: draft.sourceKey,
      sourceSnapshot: draft.sourceSnapshot,
    };
    group.comments.push({
      body: draft.comment.body,
      disposition: draft.disposition,
      filePath: draft.comment.filePath,
      id: draft.id,
      lineNumber: draft.comment.lineNumber,
      reason: draft.reason,
      side: draft.comment.side,
      startLineNumber: draft.comment.startLineNumber,
      startSide: draft.comment.startSide,
    });
    groups.set(key, group);
  }
  return JSON.stringify([...groups.values()], null, 2);
};
