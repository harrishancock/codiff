import { CopyIcon as Copy } from '@phosphor-icons/react/Copy';
import { useCallback } from 'react';
import { buildReviewDraftsJSON, type ClassifiedReviewDraft } from '../../lib/review-drafts.ts';
import { getShortRef, getSourceLabel } from '../../lib/source.ts';

const getLocationLabel = ({ comment }: ClassifiedReviewDraft) => {
  const side = comment.side === 'deletions' ? 'Old' : 'New';
  const end = comment.lineNumber;
  const start = comment.startLineNumber;
  return start != null && start !== end ? `${side} lines ${start}–${end}` : `${side} line ${end}`;
};

const getSourceDisplayLabel = ({ source, sourceKey }: ClassifiedReviewDraft) =>
  source.type === 'commit' ? getShortRef(source.ref) : getSourceLabel(source) || sourceKey;

const dispositionLabels: Record<ClassifiedReviewDraft['disposition'], string> = {
  current: 'Current',
  legacy: 'Legacy',
  superseded: 'Superseded',
  unavailable: 'Unavailable',
};

export function ReviewDraftRecoveryView({
  drafts,
  onClearScope,
  scopeLabel,
}: {
  drafts: ReadonlyArray<ClassifiedReviewDraft>;
  onClearScope?: () => Promise<void>;
  scopeLabel: string;
}) {
  const copyJSON = useCallback(async (json: string) => {
    await navigator.clipboard.writeText(json);
  }, []);

  return (
    <div className="review-draft-recovery-view">
      <header className="review-draft-recovery-header">
        <div>
          <strong>{scopeLabel}</strong>
          <span>
            {drafts.length} preserved review {drafts.length === 1 ? 'comment' : 'comments'}
          </span>
        </div>
        <button
          disabled={drafts.length === 0}
          onClick={() => void copyJSON(buildReviewDraftsJSON(drafts))}
          type="button"
        >
          <Copy aria-hidden size={14} weight="bold" />
          Copy Scope Drafts ({drafts.length})
        </button>
        {onClearScope ? (
          <button
            className="danger"
            disabled={drafts.length === 0}
            onClick={() => {
              if (
                window.confirm(
                  `Clear ${drafts.length} staged review ${drafts.length === 1 ? 'comment' : 'comments'} from ${scopeLabel}?`,
                )
              ) {
                void onClearScope();
              }
            }}
            type="button"
          >
            Clear Scope Drafts…
          </button>
        ) : null}
      </header>
      <div className="review-draft-recovery-list">
        {drafts.map((draft) => (
          <article className="review-draft-recovery-card" key={`${draft.sourceKey}:${draft.id}`}>
            <header>
              <div className="review-draft-recovery-identity">
                <code>{getSourceDisplayLabel(draft)}</code>
                <span className="review-draft-recovery-disposition">
                  {dispositionLabels[draft.disposition]}
                </span>
                <strong>{draft.comment.filePath}</strong>
                <span>{getLocationLabel(draft)}</span>
              </div>
              <div className="review-draft-recovery-actions">
                <button onClick={() => void copyJSON(buildReviewDraftsJSON([draft]))} type="button">
                  <Copy aria-hidden size={13} weight="bold" />
                  Copy Comment
                </button>
                <button
                  onClick={() =>
                    void copyJSON(
                      buildReviewDraftsJSON(
                        drafts.filter(
                          ({ scopeKey, sourceKey }) =>
                            scopeKey === draft.scopeKey && sourceKey === draft.sourceKey,
                        ),
                      ),
                    )
                  }
                  type="button"
                >
                  <Copy aria-hidden size={13} weight="bold" />
                  Copy Source Drafts
                </button>
              </div>
            </header>
            <p className="review-draft-recovery-reason">{draft.reason}</p>
            <div className="review-draft-recovery-body">{draft.comment.body}</div>
          </article>
        ))}
      </div>
    </div>
  );
}
