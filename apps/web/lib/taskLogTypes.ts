export type ActorIdentity = {
  userId?: string;
  username?: string;
  email?: string;
  role?: string;
};

export type TaskStage = "CULTIVATION" | "EXTRACTION" | "PACKAGING";

export type TaskLogServerRow = {
  id: string;
  stage: TaskStage;
  note: string;
  minutes: number;
  referenceId?: string | null;
  createdAt?: string | null;
  actorUserId?: string | null;
  loggedBy?: ActorIdentity | null;
};

export type UiTaskLogRow = {
  id?: string;
  fromServer?: boolean;
  area: "Cultivation" | "Extraction" | "Packaging";
  batch?: string;
  task: string;
  output: string;
  minutes: number;
  time?: string;
  loggedAtIso?: string;
  loggedBy?: ActorIdentity;
  data?: Record<string, unknown>;
};

export type RecentTaskLogResponse = {
  rows: TaskLogServerRow[];
};

export type CreateTaskLogPayload = {
  area?: string;
  batch?: string;
  task?: string;
  output?: string;
  minutes?: number;
  data?: Record<string, unknown>;
};

export type SaveStatus = "idle" | "saving" | "saved" | "retry";
