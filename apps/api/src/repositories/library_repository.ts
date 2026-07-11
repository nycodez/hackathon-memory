import type { LibraryFolder, LibraryListing } from '@hackathon/shared'
import type { QueryResultRow } from 'pg'
import { query, transaction } from '../db/pool.js'
import DocumentsRepository from './documents_repository.js'

interface FolderRow extends QueryResultRow {
  id: string
  parent_id: string | null
  name: string
  created_at: Date
}

export default class LibraryRepository {
  constructor(private readonly documents = new DocumentsRepository()) {}

  async list(workspaceId: string, folderId: string | null): Promise<LibraryListing | null> {
    const currentFolder = folderId ? await this.get(workspaceId, folderId) : null
    if (folderId && !currentFolder) return null

    const [foldersResult, documents, breadcrumbs] = await Promise.all([
      query<FolderRow>(
        `SELECT id, parent_id, name, created_at
         FROM library_folders
         WHERE workspace_id = $1 AND parent_id IS NOT DISTINCT FROM $2::uuid
         ORDER BY lower(name), created_at`,
        [workspaceId, folderId]
      ),
      this.documents.listInFolder(workspaceId, folderId),
      folderId ? this.breadcrumbs(workspaceId, folderId) : Promise.resolve([]),
    ])

    return {
      currentFolder,
      breadcrumbs,
      folders: foldersResult.rows.map(mapFolder),
      documents,
    }
  }

  async create(workspaceId: string, name: string, parentId: string | null): Promise<LibraryFolder> {
    if (parentId && !await this.get(workspaceId, parentId)) throw new Error('Folder not found')
    try {
      const result = await query<FolderRow>(
        `INSERT INTO library_folders (workspace_id, parent_id, name)
         VALUES ($1, $2, $3)
         RETURNING id, parent_id, name, created_at`,
        [workspaceId, parentId, name]
      )
      const folder = result.rows[0]
      if (!folder) throw new Error('Folder could not be created')
      return mapFolder(folder)
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error('A folder with this name already exists here')
      throw error
    }
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    return transaction(async (client) => {
      const folderResult = await client.query<Pick<FolderRow, 'id'>>(
        `SELECT id
         FROM library_folders
         WHERE workspace_id = $1 AND id = $2
         FOR UPDATE`,
        [workspaceId, id]
      )
      const folder = folderResult.rows[0]
      if (!folder) return false

      await client.query(
        `WITH RECURSIVE subtree AS (
           SELECT id
           FROM library_folders
           WHERE workspace_id = $1 AND id = $2
           UNION ALL
           SELECT child.id
           FROM library_folders child
           JOIN subtree parent ON child.parent_id = parent.id
           WHERE child.workspace_id = $1
         )
         DELETE FROM knowledge_documents
         WHERE workspace_id = $1 AND folder_id IN (SELECT id FROM subtree)`,
        [workspaceId, id]
      )

      const removed = await client.query(
        'DELETE FROM library_folders WHERE workspace_id = $1 AND id = $2',
        [workspaceId, id]
      )
      return removed.rowCount === 1
    })
  }

  private async get(workspaceId: string, id: string): Promise<LibraryFolder | null> {
    const result = await query<FolderRow>(
      `SELECT id, parent_id, name, created_at
       FROM library_folders
       WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, id]
    )
    return result.rows[0] ? mapFolder(result.rows[0]) : null
  }

  private async breadcrumbs(workspaceId: string, folderId: string): Promise<LibraryFolder[]> {
    const result = await query<FolderRow & { depth: number }>(
      `WITH RECURSIVE trail AS (
         SELECT id, parent_id, name, created_at, 0 AS depth
         FROM library_folders
         WHERE workspace_id = $1 AND id = $2
         UNION ALL
         SELECT parent.id, parent.parent_id, parent.name, parent.created_at, trail.depth + 1
         FROM library_folders parent
         JOIN trail ON trail.parent_id = parent.id
         WHERE parent.workspace_id = $1
       )
       SELECT id, parent_id, name, created_at, depth
       FROM trail
       ORDER BY depth DESC`,
      [workspaceId, folderId]
    )
    return result.rows.map(mapFolder)
  }
}

function mapFolder(row: FolderRow): LibraryFolder {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}
