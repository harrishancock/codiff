import { CaretDownIcon as CaretDown } from '@phosphor-icons/react/CaretDown';
import { GitBranchIcon as GitBranch } from '@phosphor-icons/react/GitBranch';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LocalBranchSummary, ReviewSource } from '../../types.ts';

const getFreshness = (branch: LocalBranchSummary) =>
  branch.createdAt ?? branch.refMtime ?? branch.updatedAt;

const formatAge = (timestamp: number) => {
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days === 0) {
    return 'today';
  }
  if (days === 1) {
    return 'yesterday';
  }
  if (days < 30) {
    return `${days}d ago`;
  }
  return `${Math.floor(days / 30)}mo ago`;
};

export function BranchPicker({
  currentBranch,
  getDraftCount = () => 0,
  onSelect,
}: {
  currentBranch: string;
  getDraftCount?: (branch: string) => number;
  onSelect: (source: Extract<ReviewSource, { type: 'branch-diff' }>) => Promise<void>;
}) {
  const [branches, setBranches] = useState<ReadonlyArray<LocalBranchSummary>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const dismiss = (event: PointerEvent) => {
      // oxlint-disable-next-line @nkzw/no-instanceof
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  const visibleBranches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...branches]
      .filter(
        ({ name, subject }) =>
          !normalized ||
          name.toLowerCase().includes(normalized) ||
          subject.toLowerCase().includes(normalized),
      )
      .sort((left, right) => getFreshness(right) - getFreshness(left));
  }, [branches, query]);

  const show = () => {
    setOpen(true);
    setError(null);
    setLoading(true);
    void window.codiff.getLocalBranches().then(
      (items) => {
        setBranches(items);
        setLoading(false);
      },
      (error: unknown) => {
        setError(error instanceof Error ? error.message : String(error));
        setLoading(false);
      },
    );
  };

  return (
    <div className="branch-picker" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="review-top-bar-branch branch-picker-trigger"
        onClick={open ? () => setOpen(false) : show}
        title={`Switch review branch (currently ${currentBranch})`}
        type="button"
      >
        <GitBranch aria-hidden size={13} weight="bold" />
        <span>{currentBranch}</span>
        <CaretDown aria-hidden size={11} weight="bold" />
      </button>
      {open ? (
        <div className="branch-picker-popover" role="dialog">
          <input
            aria-label="Filter local branches"
            autoFocus
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Filter branches"
            type="search"
            value={query}
          />
          <div className="branch-picker-list">
            {loading ? <span className="branch-picker-status">Loading branches…</span> : null}
            {error ? <span className="branch-picker-status error">{error}</span> : null}
            {!loading && !error
              ? visibleBranches.map((branch) => (
                  <button
                    className={`branch-picker-item${branch.name === currentBranch ? ' current' : ''}`}
                    disabled={loading}
                    key={branch.name}
                    onClick={() => {
                      setLoading(true);
                      void onSelect({
                        baseRef: branch.baseRef,
                        headRef: branch.headRef,
                        ref: branch.name,
                        type: 'branch-diff',
                      }).then(
                        () => setOpen(false),
                        (error: unknown) => {
                          setError(error instanceof Error ? error.message : String(error));
                          setLoading(false);
                        },
                      );
                    }}
                    type="button"
                  >
                    <span className="branch-picker-item-name">{branch.name}</span>
                    <span className="branch-picker-item-subject">{branch.subject}</span>
                    <span className="branch-picker-item-meta">
                      {branch.createdAt ? 'Created' : 'Updated'} {formatAge(getFreshness(branch))}
                      {branch.worktreePath ? ' · Worktree' : ''}
                      {getDraftCount(branch.name) > 0
                        ? ` · ${getDraftCount(branch.name)} draft${getDraftCount(branch.name) === 1 ? '' : 's'}`
                        : ''}
                    </span>
                  </button>
                ))
              : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
