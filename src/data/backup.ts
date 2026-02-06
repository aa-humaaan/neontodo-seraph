import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { nowIso } from "../lib/date";
import type { SqlDb } from "./repo";
import { getDb } from "./repo";

export type BackupV1 = {
  version: 1;
  exportedAt: string;
  projects: Array<{
    id: string;
    name: string;
    color: string | null;
    icon: string | null;
    sort_order: number;
    created_at: string;
  }>;
  tasks: Array<{
    id: string;
    project_id: string | null;
    title: string;
    notes: string;
    completed: number;
    priority: number;
    due_at: string | null;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }>;
  tags: Array<{ id: string; name: string }>;
  task_tags: Array<{ task_id: string; tag_id: string }>;
};

async function exportBundle(db: SqlDb): Promise<BackupV1> {
  const projects = await db.select<BackupV1["projects"][number]>(
    "SELECT id, name, color, icon, sort_order, created_at FROM projects ORDER BY sort_order ASC, created_at ASC",
  );
  const tasks = await db.select<BackupV1["tasks"][number]>(
    "SELECT id, project_id, title, notes, completed, priority, due_at, sort_order, created_at, updated_at FROM tasks ORDER BY created_at ASC",
  );
  const tags = await db.select<BackupV1["tags"][number]>("SELECT id, name FROM tags ORDER BY name ASC");
  const task_tags = await db.select<BackupV1["task_tags"][number]>("SELECT task_id, tag_id FROM task_tags");

  return {
    version: 1,
    exportedAt: nowIso(),
    projects,
    tasks,
    tags,
    task_tags,
  };
}

function safeParseBackup(json: string): BackupV1 {
  const data = JSON.parse(json);
  if (!data || data.version !== 1) throw new Error("Unsupported backup format");
  return data as BackupV1;
}

async function importBundle(db: SqlDb, bundle: BackupV1): Promise<void> {
  await db.execute("PRAGMA foreign_keys = ON");
  await db.execute("BEGIN");
  try {
    for (const p of bundle.projects ?? []) {
      if (!p?.id || !p?.name) continue;
      await db.execute(
        "INSERT OR REPLACE INTO projects (id, name, color, icon, sort_order, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [p.id, p.name, p.color ?? null, p.icon ?? null, Number(p.sort_order ?? 0), p.created_at ?? nowIso()],
      );
    }

    for (const t of bundle.tasks ?? []) {
      if (!t?.id || !t?.title) continue;
      await db.execute(
        "INSERT OR REPLACE INTO tasks (id, project_id, title, notes, completed, priority, due_at, sort_order, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          t.id,
          t.project_id ?? null,
          t.title,
          t.notes ?? "",
          Number(t.completed ?? 0),
          Number(t.priority ?? 0),
          t.due_at ?? null,
          Number(t.sort_order ?? 0),
          t.created_at ?? nowIso(),
          t.updated_at ?? nowIso(),
        ],
      );
    }

    for (const tag of bundle.tags ?? []) {
      if (!tag?.id || !tag?.name) continue;
      await db.execute("INSERT OR REPLACE INTO tags (id, name) VALUES ($1,$2)", [tag.id, tag.name]);
    }

    for (const tt of bundle.task_tags ?? []) {
      if (!tt?.task_id || !tt?.tag_id) continue;
      await db.execute("INSERT OR REPLACE INTO task_tags (task_id, tag_id) VALUES ($1,$2)", [tt.task_id, tt.tag_id]);
    }

    await db.execute("COMMIT");
  } catch (e) {
    await db.execute("ROLLBACK");
    throw e;
  }
}

export async function exportToJsonFile(): Promise<string> {
  const path = await save({
    title: "Export NeonTodo Backup",
    defaultPath: `neontodo-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (!path) throw new Error("Export cancelled");

  const db = await getDb();
  const bundle = await exportBundle(db);
  await writeTextFile(path, JSON.stringify(bundle, null, 2));
  return path;
}

export async function importFromJsonFile(confirmMerge: () => Promise<boolean>): Promise<string> {
  const picked = await open({
    title: "Import NeonTodo Backup",
    multiple: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (!picked) throw new Error("Import cancelled");
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (!path) throw new Error("Import cancelled");

  const ok = await confirmMerge();
  if (!ok) throw new Error("Import cancelled");

  const json = await readTextFile(path);
  const bundle = safeParseBackup(json);

  const db = await getDb();
  await importBundle(db, bundle);
  return path;
}
