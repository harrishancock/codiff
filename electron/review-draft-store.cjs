// @ts-check

const { mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const schema = `
  CREATE TABLE IF NOT EXISTS review_draft_sources (
    repository_root TEXT NOT NULL,
    source_key TEXT NOT NULL,
    source_json TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (repository_root, source_key)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS review_drafts (
    repository_root TEXT NOT NULL,
    source_key TEXT NOT NULL,
    comment_id TEXT NOT NULL,
    comment_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (repository_root, source_key, comment_id),
    FOREIGN KEY (repository_root, source_key)
      REFERENCES review_draft_sources (repository_root, source_key)
      ON DELETE CASCADE
  ) STRICT;
`;

/** @param {string} userDataPath */
const getReviewDraftDatabasePath = (userDataPath) =>
  join(userDataPath, 'review-drafts', 'drafts.sqlite3');

/**
 * @param {string} databasePath
 */
const createReviewDraftStore = (databasePath) => {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec(schema);
  database.exec('PRAGMA user_version = 1;');

  const readRevision = database.prepare(`
    SELECT revision
    FROM review_draft_sources
    WHERE repository_root = ? AND source_key = ?
  `);
  const upsertSource = database.prepare(`
    INSERT INTO review_draft_sources (
      repository_root, source_key, source_json, revision, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (repository_root, source_key) DO UPDATE SET
      source_json = excluded.source_json,
      revision = excluded.revision,
      updated_at = excluded.updated_at
  `);
  const deleteSourceDrafts = database.prepare(`
    DELETE FROM review_drafts WHERE repository_root = ? AND source_key = ?
  `);
  const insertDraft = database.prepare(`
    INSERT INTO review_drafts (
      repository_root, source_key, comment_id, comment_json, updated_at
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const loadSources = database.prepare(`
    SELECT source_key, source_json, revision
    FROM review_draft_sources
    WHERE repository_root = ?
    ORDER BY updated_at, source_key
  `);
  const loadDrafts = database.prepare(`
    SELECT comment_json
    FROM review_drafts
    WHERE repository_root = ? AND source_key = ?
    ORDER BY rowid
  `);
  const countDrafts = database.prepare(`
    SELECT COUNT(*) AS count
    FROM review_drafts
    WHERE repository_root = ?
  `);
  const clearRepositoryStatement = database.prepare(`
    DELETE FROM review_draft_sources WHERE repository_root = ?
  `);

  return {
    /** @param {string} repositoryRoot */
    clearRepository(repositoryRoot) {
      const row = /** @type {{count: number}} */ (countDrafts.get(repositoryRoot));
      clearRepositoryStatement.run(repositoryRoot);
      return Number(row.count);
    },
    close() {
      database.close();
    },
    /** @param {string} repositoryRoot */
    loadRepository(repositoryRoot) {
      return loadSources.all(repositoryRoot).map((rawSource) => {
        const sourceRow =
          /** @type {{revision: number, source_json: string, source_key: string}} */ (rawSource);
        return {
          comments: loadDrafts.all(repositoryRoot, sourceRow.source_key).map((rawDraft) => {
            const draftRow = /** @type {{comment_json: string}} */ (rawDraft);
            return JSON.parse(draftRow.comment_json);
          }),
          revision: Number(sourceRow.revision),
          source: JSON.parse(sourceRow.source_json),
          sourceKey: sourceRow.source_key,
        };
      });
    },
    /**
     * @param {{
     *   comments: ReadonlyArray<Record<string, unknown>>,
     *   repositoryRoot: string,
     *   revision: number,
     *   source: Record<string, unknown>,
     *   sourceKey: string,
     * }} snapshot
     */
    saveSource(snapshot) {
      const current = /** @type {{revision: number} | undefined} */ (
        readRevision.get(snapshot.repositoryRoot, snapshot.sourceKey)
      );
      if (current && Number(current.revision) >= snapshot.revision) {
        return false;
      }

      const drafts = snapshot.comments.filter(
        (comment) => !comment.isReadOnly && String(comment.body ?? '').trim().length > 0,
      );
      const updatedAt = new Date().toISOString();
      database.exec('BEGIN IMMEDIATE;');
      try {
        upsertSource.run(
          snapshot.repositoryRoot,
          snapshot.sourceKey,
          JSON.stringify(snapshot.source),
          snapshot.revision,
          updatedAt,
        );
        deleteSourceDrafts.run(snapshot.repositoryRoot, snapshot.sourceKey);
        for (const comment of drafts) {
          insertDraft.run(
            snapshot.repositoryRoot,
            snapshot.sourceKey,
            String(comment.id),
            JSON.stringify(comment),
            updatedAt,
          );
        }
        database.exec('COMMIT;');
      } catch (error) {
        database.exec('ROLLBACK;');
        throw error;
      }
      return true;
    },
  };
};

module.exports = { createReviewDraftStore, getReviewDraftDatabasePath };
