// @ts-check

const { mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const legacyScope = { key: 'legacy', label: 'Legacy / recovered', type: 'legacy' };
const schema = `
  CREATE TABLE IF NOT EXISTS review_draft_sources (
    repository_root TEXT NOT NULL, scope_key TEXT NOT NULL, scope_json TEXT NOT NULL,
    source_key TEXT NOT NULL, source_json TEXT NOT NULL, source_snapshot_json TEXT,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL, PRIMARY KEY (repository_root, scope_key, source_key)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS review_drafts (
    repository_root TEXT NOT NULL, scope_key TEXT NOT NULL, source_key TEXT NOT NULL,
    comment_id TEXT NOT NULL, comment_json TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (repository_root, scope_key, source_key, comment_id),
    FOREIGN KEY (repository_root, scope_key, source_key)
      REFERENCES review_draft_sources (repository_root, scope_key, source_key) ON DELETE CASCADE
  ) STRICT;
`;

/** @param {import('node:sqlite').DatabaseSync} database */
const initializeSchema = (database) => {
  const version = Number(database.prepare('PRAGMA user_version').get()?.user_version ?? 0);
  if (version === 1) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(`
        ALTER TABLE review_draft_sources RENAME TO review_draft_sources_v1;
        ALTER TABLE review_drafts RENAME TO review_drafts_v1;
        ${schema}
      `);
      const scopeJSON = JSON.stringify(legacyScope).replaceAll("'", "''");
      database.exec(`
        INSERT INTO review_draft_sources
          (repository_root, scope_key, scope_json, source_key, source_json, source_snapshot_json,
           revision, updated_at)
        SELECT repository_root, 'legacy', '${scopeJSON}', source_key, source_json, NULL,
          revision, updated_at FROM review_draft_sources_v1;
        INSERT INTO review_drafts
          (repository_root, scope_key, source_key, comment_id, comment_json, updated_at)
        SELECT repository_root, 'legacy', source_key, comment_id, comment_json, updated_at
          FROM review_drafts_v1;
        DROP TABLE review_drafts_v1;
        DROP TABLE review_draft_sources_v1;
        PRAGMA user_version = 3;
        COMMIT;
      `);
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
    return;
  }
  if (version === 2) {
    database.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE review_draft_sources ADD COLUMN source_snapshot_json TEXT;
      PRAGMA user_version = 3;
      COMMIT;
    `);
    return;
  }
  database.exec(schema);
  database.exec('PRAGMA user_version = 3;');
};

/** @param {string} userDataPath */
const getReviewDraftDatabasePath = (userDataPath) =>
  join(userDataPath, 'review-drafts', 'drafts.sqlite3');

/** @param {string} databasePath */
const createReviewDraftStore = (databasePath) => {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON;');
  initializeSchema(database);

  const readRevision = database.prepare(`SELECT revision FROM review_draft_sources
    WHERE repository_root = ? AND scope_key = ? AND source_key = ?`);
  const upsertSource = database.prepare(`INSERT INTO review_draft_sources
    (repository_root, scope_key, scope_json, source_key, source_json, source_snapshot_json,
     revision, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (repository_root, scope_key, source_key)
    DO UPDATE SET scope_json = excluded.scope_json, source_json = excluded.source_json,
      source_snapshot_json = excluded.source_snapshot_json, revision = excluded.revision,
      updated_at = excluded.updated_at`);
  const deleteSourceDrafts = database.prepare(`DELETE FROM review_drafts
    WHERE repository_root = ? AND scope_key = ? AND source_key = ?`);
  const insertDraft = database.prepare(`INSERT INTO review_drafts
    (repository_root, scope_key, source_key, comment_id, comment_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const loadSources = database.prepare(`SELECT scope_key, scope_json, source_key, source_json,
    source_snapshot_json, revision FROM review_draft_sources WHERE repository_root = ?
    ORDER BY updated_at, scope_key, source_key`);
  const loadDrafts = database.prepare(`SELECT comment_json FROM review_drafts
    WHERE repository_root = ? AND scope_key = ? AND source_key = ? ORDER BY rowid`);
  const countDrafts = database.prepare(
    'SELECT COUNT(*) AS count FROM review_drafts WHERE repository_root = ?',
  );
  const clearRepositoryStatement = database.prepare(
    'DELETE FROM review_draft_sources WHERE repository_root = ?',
  );

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
        const row =
          /** @type {{revision: number, scope_json: string, scope_key: string, source_json: string, source_key: string, source_snapshot_json: string | null}} */ (
            rawSource
          );
        return {
          comments: loadDrafts
            .all(repositoryRoot, row.scope_key, row.source_key)
            .map((rawDraft) =>
              JSON.parse(/** @type {{comment_json: string}} */ (rawDraft).comment_json),
            ),
          revision: Number(row.revision),
          scope: JSON.parse(row.scope_json),
          scopeKey: row.scope_key,
          source: JSON.parse(row.source_json),
          sourceKey: row.source_key,
          sourceSnapshot: row.source_snapshot_json ? JSON.parse(row.source_snapshot_json) : null,
        };
      });
    },
    /** @param {{comments: ReadonlyArray<Record<string, unknown>>, repositoryRoot: string, revision: number, scope: Record<string, unknown>, scopeKey: string, source: Record<string, unknown>, sourceKey: string, sourceSnapshot: Record<string, unknown>}} snapshot */
    saveSource(snapshot) {
      const current = /** @type {{revision: number} | undefined} */ (
        readRevision.get(snapshot.repositoryRoot, snapshot.scopeKey, snapshot.sourceKey)
      );
      if (current && Number(current.revision) >= snapshot.revision) return false;
      const drafts = snapshot.comments.filter(
        (comment) => !comment.isReadOnly && String(comment.body ?? '').trim().length > 0,
      );
      const updatedAt = new Date().toISOString();
      database.exec('BEGIN IMMEDIATE;');
      try {
        upsertSource.run(
          snapshot.repositoryRoot,
          snapshot.scopeKey,
          JSON.stringify(snapshot.scope),
          snapshot.sourceKey,
          JSON.stringify(snapshot.source),
          JSON.stringify(snapshot.sourceSnapshot),
          snapshot.revision,
          updatedAt,
        );
        deleteSourceDrafts.run(snapshot.repositoryRoot, snapshot.scopeKey, snapshot.sourceKey);
        for (const comment of drafts) {
          insertDraft.run(
            snapshot.repositoryRoot,
            snapshot.scopeKey,
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
