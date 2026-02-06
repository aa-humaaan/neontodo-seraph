export type Project = {
  id: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  sortOrder: number;
  createdAt: string;
};

export type Tag = {
  id: string;
  name: string;
};

export type Task = {
  id: string;
  projectId?: string | null;
  title: string;
  notes: string;
  completed: boolean;
  priority: number;
  dueAt?: string | null; // YYYY-MM-DD
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type SmartView = "today" | "upcoming" | "all" | "completed";
