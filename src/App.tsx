import "./App.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Project, SmartView, Tag, Task } from "./types";
import {
  attachTagToTask,
  createProject,
  createTask,
  deleteProjectMoveToInbox,
  deleteTask,
  detachTagFromTask,
  ensureTag,
  getTaskTags,
  initDb,
  listProjects,
  listTags,
  listTasks,
  renameProject,
  reorderTasks,
  toggleTaskCompleted,
  updateTask,
} from "./data/repo";
import { todayIsoDate } from "./lib/date";
import { exportToJsonFile, importFromJsonFile } from "./data/backup";

function App() {
  const [boot, setBoot] = useState<"booting" | "ready" | "error">("booting");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskTags, setSelectedTaskTags] = useState<Tag[]>([]);

  const [active, setActive] = useState<
    | { type: "smart"; view: SmartView }
    | { type: "project"; projectId: string }
  >({ type: "smart", view: "today" });

  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [composer, setComposer] = useState("");
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const newProjectRef = useRef<HTMLInputElement | null>(null);
  const [listAnimKey, setListAnimKey] = useState(0);

  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const composerRef = useRef<HTMLInputElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const defaultProjectId = projects[0]?.id ?? null;
  const inboxProjectId = useMemo(() => projects.find((p) => p.icon === "inbox")?.id ?? projects[0]?.id ?? null, [projects]);

  const viewTitle = useMemo(() => {
    if (active.type === "project") {
      const p = projects.find((x) => x.id === active.projectId);
      return p?.name ?? "Project";
    }
    if (active.view === "today") return "Today";
    if (active.view === "upcoming") return "Upcoming";
    if (active.view === "completed") return "Completed";
    return "All";
  }, [active, projects]);

  const activeKey = useMemo(() => {
    return active.type === "project" ? `project:${active.projectId}` : `smart:${active.view}`;
  }, [active]);

  useEffect(() => {
    setListAnimKey((k) => k + 1);
  }, [activeKey]);

  useEffect(() => {
    // Window title polish. Safe no-op when not running in Tauri.
    try {
      const w = getCurrentWindow();
      void w.setTitle(`NeonTodo — ${viewTitle}`);
    } catch {
      // ignore
    }
  }, [viewTitle]);

  const selectedTask = useMemo(() => tasks.find((t) => t.id === selectedTaskId) ?? null, [tasks, selectedTaskId]);

  const splitTasks = useMemo(() => {
    const open = tasks.filter((t) => !t.completed);
    const done = tasks.filter((t) => t.completed);
    return { open, done };
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    if (active.type === "smart" && active.view === "completed") return tasks;
    if (active.type === "project") return splitTasks.open;
    return splitTasks.open;
  }, [active, splitTasks.open, tasks]);

  const canReorder = useMemo(() => {
    return active.type === "project" && search.trim().length === 0 && tagFilter.length === 0;
  }, [active.type, search, tagFilter.length]);

  const isFiltered = useMemo(() => {
    return search.trim().length > 0 || tagFilter.length > 0;
  }, [search, tagFilter.length]);

  async function refresh(): Promise<void> {
    const ps = await listProjects();
    setProjects(ps);

    const ts = await listTags();
    setTags(ts);

    const common = { search };
    if (active.type === "project") {
      const rows = await listTasks({ ...common, view: "all", projectId: active.projectId, tagIds: tagFilter });
      setTasks(rows);
      return;
    }

    const rows = await listTasks({ ...common, view: active.view, projectId: null, tagIds: tagFilter });
    setTasks(rows);
  }

  useEffect(() => {
    function onDocMouseDown() {
      setProjectMenuId(null);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initDb();
        if (cancelled) return;
        setBoot("ready");
        await refresh();
      } catch (e: any) {
        if (cancelled) return;
        setBoot("error");
        setError(String(e?.message ?? e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (boot !== "ready") return;
    refresh().catch((e) => {
      setError(String((e as any)?.message ?? e));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, boot]);

  useEffect(() => {
    if (boot !== "ready") return;
    const t = setTimeout(() => {
      refresh().catch((e) => setError(String((e as any)?.message ?? e)));
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, boot]);

  useEffect(() => {
    if (boot !== "ready") return;
    refresh().catch((e) => setError(String((e as any)?.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagFilter, boot]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedTaskId) {
        setSelectedTaskTags([]);
        return;
      }
      try {
        const ttags = await getTaskTags(selectedTaskId);
        if (cancelled) return;
        setSelectedTaskTags(ttags);
      } catch (e) {
        if (cancelled) return;
        setError(String((e as any)?.message ?? e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTaskId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        composerRef.current?.focus();
      }
      if (!e.ctrlKey && !e.metaKey && e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setSelectedTaskId(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function onAddTask(): Promise<void> {
    const title = composer.trim();
    if (!title) return;

    const targetProjectId = active.type === "project" ? active.projectId : defaultProjectId;
    if (!targetProjectId) return;

    setComposer("");
    const t = await createTask({ title, projectId: targetProjectId });
    setSelectedTaskId(t.id);
    await refresh();
  }

  async function onToggleTask(t: Task): Promise<void> {
    await toggleTaskCompleted(t.id, !t.completed);
    if (selectedTaskId === t.id && !t.completed) {
      // Keep inspector open on completion.
      setSelectedTaskId(t.id);
    }
    await refresh();
  }

  async function onDeleteTask(t: Task): Promise<void> {
    if (!confirm("Delete this task?")) return;
    await deleteTask(t.id);
    if (selectedTaskId === t.id) setSelectedTaskId(null);
    await refresh();
  }

  async function onCreateProjectInline(): Promise<void> {
    const name = newProjectName.trim();
    if (!name) return;
    const p = await createProject({ name, color: "#5cffb2", icon: "spark" });
    setNewProjectName("");
    setNewProjectOpen(false);
    setActive({ type: "project", projectId: p.id });
  }

  async function onRenameProject(projectId: string, name: string): Promise<void> {
    await renameProject(projectId, name);
    setNotice("Project renamed");
    setEditingProjectId(null);
    setEditingProjectName("");
    await refresh();
  }

  async function onDeleteProject(projectId: string): Promise<void> {
    if (!confirm("Delete this project? Tasks will be moved to Inbox.")) return;
    await deleteProjectMoveToInbox(projectId);
    setNotice("Project deleted; tasks moved to Inbox");
    setProjectMenuId(null);
    setEditingProjectId(null);
    setEditingProjectName("");
    if (active.type === "project" && active.projectId === projectId) {
      if (inboxProjectId) setActive({ type: "project", projectId: inboxProjectId });
      else setActive({ type: "smart", view: "today" });
    }
    await refresh();
  }

  useEffect(() => {
    if (!newProjectOpen) return;
    const t = setTimeout(() => newProjectRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [newProjectOpen]);

  async function onExport(): Promise<void> {
    setError(null);
    const path = await exportToJsonFile();
    setNotice(`Exported backup: ${path}`);
  }

  async function onImport(): Promise<void> {
    setError(null);
    const path = await importFromJsonFile(async () => {
      return confirm("Import will MERGE by ID and overwrite matching items. Continue?");
    });
    setNotice(`Imported backup: ${path}`);
    await refresh();
  }

  async function onAddTagToSelectedTask(name: string): Promise<void> {
    if (!selectedTask) return;
    const tag = await ensureTag(name);
    await attachTagToTask(selectedTask.id, tag.id);
    setNotice(`Tag added: ${tag.name}`);
    await refresh();
    setSelectedTaskTags(await getTaskTags(selectedTask.id));
  }

  async function onRemoveTagFromSelectedTask(tagId: string): Promise<void> {
    if (!selectedTask) return;
    await detachTagFromTask(selectedTask.id, tagId);
    await refresh();
    setSelectedTaskTags(await getTaskTags(selectedTask.id));
  }

  if (boot === "booting") {
    return (
      <div className="boot">
        <div className="bootCard">
          <div className="bootMark" />
          <div className="bootTitle">NeonTodo</div>
          <div className="bootSub mono">Initializing local database...</div>
        </div>
      </div>
    );
  }

  if (boot === "error") {
    return (
      <div className="boot">
        <div className="bootCard error">
          <div className="bootTitle">Startup failed</div>
          <div className="bootSub mono">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">
          <div className="brandDot" />
          <div className="brandText">
            <div className="brandName">NeonTodo</div>
            <div className="brandMeta mono">local-only · sqlite</div>
          </div>
        </div>

        <div className="railSection">
          <div className="railHeader">Views</div>
          <button
            className={"railItem" + (active.type === "smart" && active.view === "today" ? " active" : "")}
            onClick={() => setActive({ type: "smart", view: "today" })}
          >
            <span className="railGlyph">◎</span>
            Today
            <span className="railHint mono">{todayIsoDate()}</span>
          </button>
          <button
            className={"railItem" + (active.type === "smart" && active.view === "upcoming" ? " active" : "")}
            onClick={() => setActive({ type: "smart", view: "upcoming" })}
          >
            <span className="railGlyph">⇢</span>
            Upcoming
          </button>
          <button
            className={"railItem" + (active.type === "smart" && active.view === "completed" ? " active" : "")}
            onClick={() => setActive({ type: "smart", view: "completed" })}
          >
            <span className="railGlyph">✓</span>
            Completed
          </button>
        </div>

        <div className="railSection">
          <div className="railHeader">
            Projects
            <button
              className="railMini"
              onClick={() => setNewProjectOpen((v) => !v)}
              title={newProjectOpen ? "Close" : "New project"}
            >
              +
            </button>
          </div>

          {newProjectOpen ? (
            <div className="projectComposer">
              <input
                ref={newProjectRef}
                className="projectInput"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.currentTarget.value)}
                placeholder="Project name"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setNewProjectOpen(false);
                    setNewProjectName("");
                  }
                  if (e.key === "Enter") {
                    onCreateProjectInline().catch((err) => setError(String((err as any)?.message ?? err)));
                  }
                }}
              />
              <button
                className="projectBtn"
                onClick={() => onCreateProjectInline().catch((err) => setError(String((err as any)?.message ?? err)))}
                disabled={!newProjectName.trim()}
              >
                Create
              </button>
            </div>
          ) : null}

          <div className="railList">
            {projects.map((p) => {
              const isActive = active.type === "project" && active.projectId === p.id;
              const isInbox = p.icon === "inbox" || p.name.toLowerCase() === "inbox";
              const menuOpen = projectMenuId === p.id;
              const editing = editingProjectId === p.id;
              return (
                <div key={p.id} className={"projRow" + (isActive ? " active" : "")}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <button className="projMain" onClick={() => setActive({ type: "project", projectId: p.id })}>
                    <span className="projGlyph" style={{ color: p.color ?? "var(--accent)" }}>
                      ◈
                    </span>
                    {editing ? (
                      <input
                        className="projEdit"
                        value={editingProjectName}
                        onChange={(e) => setEditingProjectName(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setEditingProjectId(null);
                            setEditingProjectName("");
                          }
                          if (e.key === "Enter") {
                            onRenameProject(p.id, editingProjectName).catch((err) => setError(String((err as any)?.message ?? err)));
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <span className="projName">{p.name}</span>
                    )}
                  </button>

                  <button
                    className={"projMore" + (menuOpen ? " on" : "")}
                    title="Project actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      setProjectMenuId((prev) => (prev === p.id ? null : p.id));
                    }}
                  >
                    ⋯
                  </button>

                  {menuOpen ? (
                    <div className="projMenu" role="menu">
                      <button
                        className="projMenuItem"
                        onClick={() => {
                          setEditingProjectId(p.id);
                          setEditingProjectName(p.name);
                          setProjectMenuId(null);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="projMenuItem danger"
                        disabled={isInbox}
                        onClick={() => onDeleteProject(p.id).catch((err) => setError(String((err as any)?.message ?? err)))}
                        title={isInbox ? "Inbox cannot be deleted" : "Delete project"}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="railFooter mono">
          <div className="railData">
            <button className="railAction" onClick={() => onExport().catch((e) => setError(String((e as any)?.message ?? e)))}>
              Export JSON
            </button>
            <button className="railAction" onClick={() => onImport().catch((e) => setError(String((e as any)?.message ?? e)))}>
              Import JSON
            </button>
          </div>
          Shortcuts: <span className="mono">Ctrl+N</span> new · <span className="mono">/</span> search · <span className="mono">Esc</span> close
        </div>
      </aside>

      <section className="main">
        <header className="topbar">
          <div className="topTitle">
            <h1>{viewTitle}</h1>
            <div className="badge mono">{tasks.length}</div>
          </div>
          <div className="topTools">
            <input
              ref={searchRef}
              className="search"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              placeholder="Search title or notes ( / )"
            />
          </div>

          <div className="chipRow" aria-label="Tag filters">
            {tags.length === 0 ? <span className="chip faint mono">no tags yet</span> : null}
            {tags.map((t) => {
              const on = tagFilter.includes(t.id);
              return (
                <button
                  key={t.id}
                  className={"chip" + (on ? " on" : "")}
                  onClick={() => {
                    setTagFilter((prev) => (prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id]));
                  }}
                  title={on ? "Remove filter" : "Filter by tag"}
                >
                  #{t.name}
                </button>
              );
            })}
            {tagFilter.length > 0 ? (
              <button className="chip danger" onClick={() => setTagFilter([])} title="Clear tag filters">
                clear
              </button>
            ) : null}
          </div>
        </header>

        <div className="composer">
          <input
            ref={composerRef}
            className="composerInput"
            value={composer}
            onChange={(e) => setComposer(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAddTask().catch((err) => setError(String((err as any)?.message ?? err)));
            }}
            placeholder={active.type === "project" ? `Add a task to ${viewTitle}...` : "Add a task to Inbox..."}
          />
          <button
            className="primary"
            onClick={() => onAddTask().catch((err) => setError(String((err as any)?.message ?? err)))}
            disabled={!composer.trim()}
          >
            Add
          </button>
        </div>

        <div className="listWrap">
          {notice ? (
            <div className="banner ok mono">
              {notice}
              <button className="bannerBtn" onClick={() => setNotice(null)}>
                dismiss
              </button>
            </div>
          ) : null}
          {error ? (
            <div className="banner mono">
              {error}
              <button className="bannerBtn" onClick={() => setError(null)}>
                dismiss
              </button>
            </div>
          ) : null}

          {tasks.length === 0 ? (
            <EmptyState
              mode={active.type === "project" ? "project" : active.view}
              title={viewTitle}
              filtered={isFiltered}
              onClearFilters={() => {
                setSearch("");
                setTagFilter([]);
              }}
              onFocusComposer={() => composerRef.current?.focus()}
            />
          ) : null}

          <div className="taskGroup animate" key={listAnimKey}>
            {active.type === "project" && splitTasks.done.length > 0 ? (
              <div className="groupHeader mono">OPEN</div>
            ) : null}
            {visibleTasks.map((t, idx) => (
              <TaskRow
                key={t.id}
                task={t}
                selected={t.id === selectedTaskId}
                index={idx}
                onSelect={() => setSelectedTaskId(t.id)}
                onToggle={() => onToggleTask(t).catch((err) => setError(String((err as any)?.message ?? err)))}
                onDelete={() => onDeleteTask(t).catch((err) => setError(String((err as any)?.message ?? err)))}
                draggable={canReorder}
                isDragging={dragTaskId === t.id}
                onDragStart={() => setDragTaskId(t.id)}
                onDragEnd={() => setDragTaskId(null)}
                onDropOn={async (targetId) => {
                  if (active.type !== "project") return;
                  if (!dragTaskId) return;
                  if (dragTaskId === targetId) return;

                  const ids = splitTasks.open.map((x) => x.id);
                  const from = ids.indexOf(dragTaskId);
                  const to = ids.indexOf(targetId);
                  if (from < 0 || to < 0) return;

                  const next = [...ids];
                  const [moved] = next.splice(from, 1);
                  next.splice(to, 0, moved);

                  // Optimistic UI reorder.
                  setTasks((prev) => {
                    const map = new Map(prev.map((x) => [x.id, x] as const));
                    const openNext = next.map((id) => map.get(id)).filter(Boolean) as Task[];
                    const done = prev.filter((x) => x.completed);
                    return [...openNext, ...done];
                  });

                  await reorderTasks(active.projectId, next);
                  setNotice("Reordered");
                  setDragTaskId(null);
                  await refresh();
                }}
              />
            ))}

            {active.type === "project" && splitTasks.done.length > 0 ? (
              <>
                <div className="groupHeader mono">COMPLETED</div>
                {splitTasks.done.map((t, idx) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    selected={t.id === selectedTaskId}
                    index={visibleTasks.length + idx}
                    onSelect={() => setSelectedTaskId(t.id)}
                    onToggle={() => onToggleTask(t).catch((err) => setError(String((err as any)?.message ?? err)))}
                    onDelete={() => onDeleteTask(t).catch((err) => setError(String((err as any)?.message ?? err)))}
                  />
                ))}
              </>
            ) : null}
          </div>
        </div>
      </section>

      <aside className={"inspector" + (selectedTask ? " open" : "")}
        onMouseDown={(e) => {
          // Prevent losing selection when clicking inside.
          e.stopPropagation();
        }}
      >
        {selectedTask ? (
          <Inspector
            task={selectedTask}
            projectName={projects.find((p) => p.id === selectedTask.projectId)?.name ?? ""}
            tags={selectedTaskTags}
            onClose={() => setSelectedTaskId(null)}
            onChange={async (patch) => {
              await updateTask(selectedTask.id, patch);
              await refresh();
            }}
            onAddTag={onAddTagToSelectedTask}
            onRemoveTag={onRemoveTagFromSelectedTask}
          />
        ) : (
          <div className="inspectorEmpty">
            <div className="emptyTitle">Inspector</div>
            <div className="emptySub mono">Select a task to edit details.</div>
          </div>
        )}
      </aside>
    </div>
  );
}

export default App;

function TaskRow(props: {
  task: Task;
  selected: boolean;
  index: number;
  onSelect: () => void;
  onToggle: () => void;
  onDelete: () => void;
  draggable?: boolean;
  isDragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDropOn?: (targetId: string) => void | Promise<void>;
}) {
  const p = props.task.priority;
  const pri = p === 0 ? "P0" : p === 1 ? "P1" : p === 2 ? "P2" : "P3";
  return (
    <div
      className={
        "task" +
        (props.selected ? " selected" : "") +
        (props.draggable ? " draggable" : "") +
        (props.isDragging ? " dragging" : "")
      }
      style={{ ["--i" as any]: props.index } as any}
      onClick={props.onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onSelect();
      }}
      draggable={Boolean(props.draggable)}
      onDragStart={(e) => {
        if (!props.draggable) return;
        e.dataTransfer.effectAllowed = "move";
        props.onDragStart?.();
      }}
      onDragEnd={() => {
        props.onDragEnd?.();
      }}
      onDragOver={(e) => {
        if (!props.draggable) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        if (!props.draggable) return;
        e.preventDefault();
        void props.onDropOn?.(props.task.id);
      }}
    >
      <div className="grip" aria-hidden="true" />
      <button
        className={"check" + (props.task.completed ? " on" : "")}
        onClick={(e) => {
          e.stopPropagation();
          props.onToggle();
        }}
        aria-label={props.task.completed ? "Mark incomplete" : "Mark complete"}
      />
      <div className="taskBody">
        <div className={"taskTitle" + (props.task.completed ? " done" : "")}>{props.task.title}</div>
        <div className="taskMeta mono">
          {props.task.dueAt ? <span className={"pill" + (props.task.dueAt === todayIsoDate() ? " hot" : "")}>due {props.task.dueAt}</span> : <span className="pill faint">no due</span>}
          <span className={"pill" + (p >= 2 ? " warn" : "")}>{pri}</span>
        </div>
      </div>
      <button
        className="ghost"
        onClick={(e) => {
          e.stopPropagation();
          props.onDelete();
        }}
        title="Delete"
        aria-label="Delete task"
      >
        ×
      </button>
    </div>
  );
}

function EmptyState(props: {
  mode: "project" | SmartView;
  title: string;
  filtered: boolean;
  onClearFilters: () => void;
  onFocusComposer: () => void;
}) {
  let headline = "No signal.";
  let sub = "Add a task, or switch views/projects.";

  if (props.filtered) {
    headline = "No matches.";
    sub = "Try clearing search / tag filters.";
  } else if (props.mode === "today") {
    headline = "Nothing due today.";
    sub = "Schedule something, or use Today as your focus lane.";
  } else if (props.mode === "upcoming") {
    headline = "No upcoming tasks.";
    sub = "Set a due date and they’ll appear here.";
  } else if (props.mode === "completed") {
    headline = "No completed tasks yet.";
    sub = "Finish one and it’ll show up here.";
  } else if (props.mode === "all") {
    headline = "No tasks yet.";
    sub = "Start with one tiny thing.";
  } else {
    headline = `"${props.title}" is empty.`;
    sub = "Drop tasks here and reorder them however you like.";
  }

  return (
    <div className="empty">
      <div className="emptyArt" aria-hidden="true">
        <div className="emptyOrb" />
        <div className="emptyRing" />
        <div className="emptyGrid" />
      </div>
      <div className="emptyTitle">{headline}</div>
      <div className="emptySub mono">{sub}</div>
      <div className="emptyActions">
        <button className="primary" onClick={props.onFocusComposer}>
          New task
        </button>
        {props.filtered ? (
          <button className="railAction" onClick={props.onClearFilters}>
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Inspector(props: {
  task: Task;
  projectName: string;
  tags: Tag[];
  onClose: () => void;
  onChange: (patch: Partial<Pick<Task, "title" | "notes" | "priority" | "dueAt">>) => Promise<void>;
  onAddTag: (name: string) => Promise<void>;
  onRemoveTag: (tagId: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(props.task.title);
  const [notes, setNotes] = useState(props.task.notes);
  const [dueAt, setDueAt] = useState(props.task.dueAt ?? "");
  const [priority, setPriority] = useState(String(props.task.priority ?? 0));
  const [tagName, setTagName] = useState("");

  useEffect(() => {
    setTitle(props.task.title);
    setNotes(props.task.notes);
    setDueAt(props.task.dueAt ?? "");
    setPriority(String(props.task.priority ?? 0));
  }, [props.task]);

  return (
    <div className="inspectorInner">
      <div className="inspTop">
        <div>
          <div className="inspLabel mono">TASK</div>
          <div className="inspProject mono">{props.projectName}</div>
        </div>
        <button className="ghost" onClick={props.onClose} title="Close">
          ✕
        </button>
      </div>

      <label className="field">
        <div className="fieldLabel mono">TITLE</div>
        <input
          className="fieldInput"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          onBlur={() => props.onChange({ title: title.trim() || "Untitled" })}
        />
      </label>

      <div className="grid2">
        <label className="field">
          <div className="fieldLabel mono">DUE</div>
          <input
            className="fieldInput"
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.currentTarget.value)}
            onBlur={() => props.onChange({ dueAt: dueAt ? dueAt : null })}
          />
        </label>

        <label className="field">
          <div className="fieldLabel mono">PRIORITY</div>
          <select
            className="fieldInput"
            value={priority}
            onChange={(e) => setPriority(e.currentTarget.value)}
            onBlur={() => props.onChange({ priority: Number(priority) })}
          >
            <option value="0">P0</option>
            <option value="1">P1</option>
            <option value="2">P2</option>
            <option value="3">P3</option>
          </select>
        </label>
      </div>

      <label className="field">
        <div className="fieldLabel mono">NOTES</div>
        <textarea
          className="fieldInput textarea"
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
          onBlur={() => props.onChange({ notes })}
          placeholder="Add details, links, context..."
        />
      </label>

      <div className="field">
        <div className="fieldLabel mono">TAGS</div>
        <div className="tagRow">
          {props.tags.length === 0 ? <span className="pill faint mono">none</span> : null}
          {props.tags.map((t) => (
            <button key={t.id} className="tag" onClick={() => props.onRemoveTag(t.id)} title="Remove tag">
              #{t.name} <span className="tagX">×</span>
            </button>
          ))}
        </div>

        <div className="tagAdd">
          <input
            className="fieldInput"
            value={tagName}
            onChange={(e) => setTagName(e.currentTarget.value)}
            placeholder="Add tag (e.g. work)"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const name = tagName.trim();
                if (!name) return;
                props
                  .onAddTag(name)
                  .then(() => setTagName(""))
                  .catch(() => {
                    // Errors are surfaced in main banner.
                  });
              }
            }}
          />
          <button
            className="ghost"
            onClick={() => {
              const name = tagName.trim();
              if (!name) return;
              props
                .onAddTag(name)
                .then(() => setTagName(""))
                .catch(() => {
                  // Errors are surfaced in main banner.
                });
            }}
            title="Add tag"
          >
            +
          </button>
        </div>
      </div>

      <div className="inspHint mono">Saved automatically. Local-only.</div>
    </div>
  );
}
