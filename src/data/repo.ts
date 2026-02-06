import Database from "@tauri-apps/plugin-sql";
import { nowIso, todayIsoDate } from "../lib/date";
import type { Project, SmartView, Tag, Task } from "../types";

export type SqlDb = {
  execute: (query: string, bindValues?: unknown[]) => Promise<{ rowsAffected: number; lastInsertId?: number }>;
  select: <T = unknown>(query: string, bindValues?: unknown[]) => Promise<T[]>;
};

let dbPromise: Promise<SqlDb> | null = null;

export async function getDb(): Promise<SqlDb> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:neontodo.db") as Promise<SqlDb>;
  }
  return dbPromise;
}

export async function initDb(): Promise<void> {
  const db = await getDb();
  // Seed a default project on first run.
  const rows = await db.select<{ count: number }>("SELECT COUNT(*) AS count FROM projects");
  const count = Number(rows?.[0]?.count ?? 0);
  if (count === 0) {
    const id = crypto.randomUUID();
    await db.execute(
      "INSERT INTO projects (id, name, color, icon, sort_order, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, "Inbox", "#29f0ff", "inbox", 0, nowIso()],
    );
  }
}

function mapProject(row: any): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    color: row.color ?? null,
    icon: row.icon ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at),
  };
}

function mapTask(row: any): Task {
  return {
    id: String(row.id),
    projectId: row.project_id ?? null,
    title: String(row.title),
    notes: String(row.notes ?? ""),
    completed: Boolean(row.completed),
    priority: Number(row.priority ?? 0),
    dueAt: row.due_at ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  const rows = await db.select(
    "SELECT id, name, color, icon, sort_order, created_at FROM projects ORDER BY sort_order ASC, created_at ASC",
  );
  return rows.map(mapProject);
}

export async function listTags(): Promise<Tag[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string; name: string }>("SELECT id, name FROM tags ORDER BY name ASC");
  return rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
}

export async function ensureTag(nameRaw: string): Promise<Tag> {
  const db = await getDb();
  const name = nameRaw.trim();
  if (!name) throw new Error("Tag name required");
  const existing = await db.select<{ id: string; name: string }>("SELECT id, name FROM tags WHERE name = $1", [name]);
  if (existing.length > 0) return { id: String(existing[0].id), name: String(existing[0].name) };

  const id = crypto.randomUUID();
  await db.execute("INSERT INTO tags (id, name) VALUES ($1, $2)", [id, name]);
  return { id, name };
}

export async function getTaskTags(taskId: string): Promise<Tag[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string; name: string }>(
    "SELECT tags.id AS id, tags.name AS name FROM tags INNER JOIN task_tags ON task_tags.tag_id = tags.id WHERE task_tags.task_id = $1 ORDER BY tags.name ASC",
    [taskId],
  );
  return rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
}

export async function attachTagToTask(taskId: string, tagId: string): Promise<void> {
  const db = await getDb();
  await db.execute("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES ($1, $2)", [taskId, tagId]);
}

export async function detachTagFromTask(taskId: string, tagId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM task_tags WHERE task_id = $1 AND tag_id = $2", [taskId, tagId]);
}

export async function createProject(input: { name: string; color?: string | null; icon?: string | null }): Promise<Project> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const sortRow = await db.select<{ next: number }>("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM projects");
  const sortOrder = Number(sortRow?.[0]?.next ?? 0);

  const baseName = input.name.trim();
  if (!baseName) throw new Error("Project name required");

  const existing = await db.select<{ name: string }>("SELECT name FROM projects");
  const existingLower = new Set(existing.map((r) => String(r.name).toLowerCase()));

  let name = baseName;
  if (existingLower.has(baseName.toLowerCase())) {
    let n = 2;
    while (existingLower.has(`${baseName} (${n})`.toLowerCase())) n++;
    name = `${baseName} (${n})`;
  }

  await db.execute(
    "INSERT INTO projects (id, name, color, icon, sort_order, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, name, input.color ?? null, input.icon ?? null, sortOrder, createdAt],
  );
  return { id, name, color: input.color ?? null, icon: input.icon ?? null, sortOrder, createdAt };
}

export async function renameProject(projectId: string, nameRaw: string): Promise<void> {
  const db = await getDb();
  const name = nameRaw.trim();
  if (!name) throw new Error("Project name required");
  await db.execute("UPDATE projects SET name = $1 WHERE id = $2", [name, projectId]);
}

async function ensureInboxProjectId(db: SqlDb): Promise<string> {
  const rows = await db.select<{ id: string }>(
    "SELECT id FROM projects WHERE icon = 'inbox' ORDER BY sort_order ASC, created_at ASC LIMIT 1",
  );
  if (rows.length > 0) return String(rows[0].id);

  const byName = await db.select<{ id: string }>("SELECT id FROM projects WHERE LOWER(name) = 'inbox' LIMIT 1");
  if (byName.length > 0) return String(byName[0].id);

  const id = crypto.randomUUID();
  await db.execute(
    "INSERT INTO projects (id, name, color, icon, sort_order, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, "Inbox", "#29f0ff", "inbox", 0, nowIso()],
  );
  return id;
}

export async function deleteProjectMoveToInbox(projectId: string): Promise<void> {
  const db = await getDb();
  const meta = await db.select<{ icon: string | null; name: string }>("SELECT icon, name FROM projects WHERE id = $1", [projectId]);
  if (meta.length === 0) return;
  const icon = meta[0].icon ?? null;
  if (icon === "inbox" || String(meta[0].name).toLowerCase() === "inbox") {
    throw new Error("Inbox cannot be deleted");
  }

  const inboxId = await ensureInboxProjectId(db);
  await db.execute("BEGIN");
  try {
    await db.execute("UPDATE tasks SET project_id = $1, updated_at = $2 WHERE project_id = $3", [inboxId, nowIso(), projectId]);
    await db.execute("DELETE FROM projects WHERE id = $1", [projectId]);
    await db.execute("COMMIT");
  } catch (e) {
    await db.execute("ROLLBACK");
    throw e;
  }
}

export async function listTasks(params: {
  view: SmartView;
  projectId?: string | null;
  search?: string;
  tagIds?: string[];
}): Promise<Task[]> {
  const db = await getDb();
  const where: string[] = [];
  const binds: unknown[] = [];

  const today = todayIsoDate();
  if (params.view === "completed") where.push("t.completed = 1");
  if (params.view === "today" || params.view === "upcoming") where.push("t.completed = 0");

  if (params.view === "today") {
    where.push("t.due_at = $" + (binds.length + 1));
    binds.push(today);
  }

  if (params.view === "upcoming") {
    // Everything due after today (including tasks with no due date at the bottom).
    where.push("(t.due_at IS NULL OR t.due_at > $" + (binds.length + 1) + ")");
    binds.push(today);
  }

  if (params.view === "all") {
    // nothing extra
  }

  if (params.projectId) {
    where.push("t.project_id = $" + (binds.length + 1));
    binds.push(params.projectId);
  }

  if (params.search && params.search.trim().length > 0) {
    where.push("(t.title LIKE $" + (binds.length + 1) + " OR t.notes LIKE $" + (binds.length + 2) + ")");
    const q = `%${params.search.trim()}%`;
    binds.push(q, q);
  }

  let fromSql = "FROM tasks t";
  if (params.tagIds && params.tagIds.length > 0) {
    const ids = params.tagIds.filter(Boolean);
    if (ids.length > 0) {
      const placeholders = ids.map((_, i) => `$${binds.length + i + 1}`).join(", ");
      binds.push(...ids);
      // AND semantics: task must have ALL selected tags.
      where.push(
        `t.id IN (
           SELECT task_id
           FROM task_tags
           WHERE tag_id IN (${placeholders})
           GROUP BY task_id
           HAVING COUNT(DISTINCT tag_id) = ${ids.length}
         )`,
      );
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderBy = params.projectId
    ? "ORDER BY t.sort_order ASC, t.created_at ASC"
    : "ORDER BY CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at ASC, t.sort_order ASC, t.created_at ASC";

  const rows = await db.select(
    `SELECT t.id, t.project_id, t.title, t.notes, t.completed, t.priority, t.due_at, t.sort_order, t.created_at, t.updated_at
     ${fromSql}
     ${whereSql}
     ${orderBy}`,
    binds,
  );

  return rows.map(mapTask);
}

export async function reorderTasks(projectId: string | null, orderedTaskIds: string[]): Promise<void> {
  const db = await getDb();
  await db.execute("BEGIN");
  try {
    const updatedAt = nowIso();
    for (let i = 0; i < orderedTaskIds.length; i++) {
      await db.execute(
        "UPDATE tasks SET sort_order = $1, updated_at = $2 WHERE id = $3 AND project_id IS $4",
        [i, updatedAt, orderedTaskIds[i], projectId],
      );
    }
    await db.execute("COMMIT");
  } catch (e) {
    await db.execute("ROLLBACK");
    throw e;
  }
}

export async function createTask(input: {
  title: string;
  projectId?: string | null;
}): Promise<Task> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const updatedAt = createdAt;
  const title = input.title.trim();
  const projectId = input.projectId ?? null;

  const sortRow = await db.select<{ next: number }>(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM tasks WHERE project_id IS $1",
    [projectId],
  );
  const sortOrder = Number(sortRow?.[0]?.next ?? 0);

  await db.execute(
    "INSERT INTO tasks (id, project_id, title, notes, completed, priority, due_at, sort_order, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [id, projectId, title, "", 0, 0, null, sortOrder, createdAt, updatedAt],
  );

  return {
    id,
    projectId,
    title,
    notes: "",
    completed: false,
    priority: 0,
    dueAt: null,
    sortOrder,
    createdAt,
    updatedAt,
  };
}

export async function toggleTaskCompleted(taskId: string, completed: boolean): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE tasks SET completed = $1, updated_at = $2 WHERE id = $3", [completed ? 1 : 0, nowIso(), taskId]);
}

export async function updateTask(taskId: string, patch: Partial<Pick<Task, "title" | "notes" | "priority" | "dueAt" | "projectId">>): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const binds: unknown[] = [];

  if (patch.title !== undefined) {
    fields.push(`title = $${binds.length + 1}`);
    binds.push(patch.title);
  }
  if (patch.notes !== undefined) {
    fields.push(`notes = $${binds.length + 1}`);
    binds.push(patch.notes);
  }
  if (patch.priority !== undefined) {
    fields.push(`priority = $${binds.length + 1}`);
    binds.push(patch.priority);
  }
  if (patch.dueAt !== undefined) {
    fields.push(`due_at = $${binds.length + 1}`);
    binds.push(patch.dueAt);
  }
  if (patch.projectId !== undefined) {
    fields.push(`project_id = $${binds.length + 1}`);
    binds.push(patch.projectId);
  }

  fields.push(`updated_at = $${binds.length + 1}`);
  binds.push(nowIso());

  binds.push(taskId);
  const sql = `UPDATE tasks SET ${fields.join(", ")} WHERE id = $${binds.length}`;
  await db.execute(sql, binds);
}

export async function deleteTask(taskId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM tasks WHERE id = $1", [taskId]);
}
