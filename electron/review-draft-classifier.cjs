// @ts-check

const { git } = require('./git-state/common.cjs');

/** @param {string} repositoryRoot @param {string} commit */
const commitExists = async (repositoryRoot, commit) => {
  try {
    await git(repositoryRoot, ['cat-file', '-e', `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};

/** @param {import('../core/types.ts').ReviewSourceSnapshot} snapshot */
const getSnapshotCommits = (snapshot) => {
  switch (snapshot.type) {
    case 'commit':
      return [snapshot.commit];
    case 'branch-diff':
    case 'branch-working-tree':
      return [snapshot.baseRef, snapshot.headRef];
    case 'range':
      return [snapshot.resolvedBase, snapshot.resolvedHead, snapshot.mergeBase].filter(Boolean);
    case 'pull-request':
      return [snapshot.headSha];
    case 'working-tree':
      return snapshot.head ? [snapshot.head] : [];
  }
};

/**
 * @param {string} repositoryRoot
 * @param {import('../core/types.ts').ReviewDraftClassificationRequest} request
 */
const classifyReviewDraft = async (repositoryRoot, request) => {
  const snapshot = request.sourceSnapshot;
  if (!snapshot) {
    return {
      disposition: 'legacy',
      id: request.id,
      reason: 'Draft predates resolved source snapshots.',
    };
  }

  const commits = getSnapshotCommits(snapshot);
  const availability = await Promise.all(
    commits.map((commit) => commitExists(repositoryRoot, /** @type {string} */ (commit))),
  );
  if (availability.includes(false)) {
    return {
      disposition: 'unavailable',
      id: request.id,
      reason: 'Commit is not available in this repository.',
    };
  }

  if (snapshot.type === 'commit' && request.scope.type === 'branch') {
    let branchHead;
    try {
      branchHead = (
        await git(repositoryRoot, [
          'rev-parse',
          '--verify',
          `refs/heads/${request.scope.label}^{commit}`,
        ])
      ).trim();
    } catch {
      return {
        disposition: 'unavailable',
        id: request.id,
        reason: 'Review branch is not available in this repository.',
      };
    }
    try {
      await git(repositoryRoot, ['merge-base', '--is-ancestor', snapshot.commit, branchHead]);
      return {
        disposition: 'current',
        id: request.id,
        reason: 'Commit is in the current branch history.',
      };
    } catch {
      return {
        disposition: 'superseded',
        id: request.id,
        reason: 'Commit exists but is outside the current branch history.',
      };
    }
  }

  if (
    request.currentSourceSnapshot &&
    JSON.stringify(snapshot) !== JSON.stringify(request.currentSourceSnapshot)
  ) {
    return {
      disposition: 'superseded',
      id: request.id,
      reason: 'Resolved source no longer matches the current review.',
    };
  }

  return {
    disposition: 'current',
    id: request.id,
    reason: 'Source snapshot is available.',
  };
};

/**
 * @param {string} repositoryRoot
 * @param {ReadonlyArray<import('../core/types.ts').ReviewDraftClassificationRequest>} requests
 */
const classifyReviewDrafts = (repositoryRoot, requests) =>
  Promise.all(requests.map((request) => classifyReviewDraft(repositoryRoot, request)));

module.exports = { classifyReviewDrafts };
