import { randomUUID } from "node:crypto";
import { pool } from "./db.js";
import type { BoundingBox } from "./osm.js";

type ProjectRow = {
  bbox: BoundingBox;
  created_at: Date;
  id: string;
  name: string;
  updated_at: Date;
};

type ProjectStateRow = ProjectRow & {
  osm_data: unknown;
  user_edits: unknown;
};

export async function listProjects(userId: string) {
  assertDatabase();
  await ensureProjectSchema();
  await ensureUser(userId);

  const result = await pool!.query<ProjectRow>(
    `
      select id, name, bbox, created_at, updated_at
      from projects
      where user_id = $1
      order by updated_at desc
    `,
    [userId]
  );

  return result.rows;
}

export async function getProject(id: string, userId: string) {
  assertDatabase();
  await ensureProjectSchema();
  await ensureUser(userId);

  const result = await pool!.query<ProjectStateRow>(
    `
      select p.id, p.name, p.bbox, p.created_at, p.updated_at, ps.osm_data, ps.user_edits
      from projects p
      join project_state ps on ps.project_id = p.id
      where p.id = $1 and p.user_id = $2
    `,
    [id, userId]
  );

  return result.rows[0] ?? null;
}

export async function saveProject(input: unknown, userId: string) {
  assertDatabase();
  await ensureProjectSchema();
  await ensureUser(userId);

  const project = parseProjectInput(input);
  const id = project.id ?? randomUUID();

  await pool!.query("begin");

  try {
    if (project.id) {
      const update = await pool!.query(
        `
          update projects
          set name = $3, bbox = $4, updated_at = now()
          where id = $1 and user_id = $2
        `,
        [id, userId, project.name, JSON.stringify(project.bbox)]
      );

      if (update.rowCount === 0) {
        throw new Error("Project not found.");
      }
    } else {
      await pool!.query(
        `
          insert into projects (id, user_id, name, bbox)
          values ($1, $2, $3, $4)
        `,
        [id, userId, project.name, JSON.stringify(project.bbox)]
      );
    }

    await pool!.query(
      `
        insert into project_state (project_id, osm_data, user_edits)
        values ($1, $2, $3)
        on conflict (project_id) do update set
          osm_data = excluded.osm_data,
          user_edits = excluded.user_edits
      `,
      [id, JSON.stringify(project.osmData), JSON.stringify(project.userEdits)]
    );

    await pool!.query("commit");
  } catch (error) {
    await pool!.query("rollback");
    throw error;
  }

  return getProject(id, userId);
}

async function ensureProjectSchema() {
  await pool!.query(`
    create table if not exists users (
      id text primary key,
      clerk_id text unique,
      email text,
      created_at timestamptz not null default now()
    )
  `);

  await pool!.query(`
    create table if not exists projects (
      id uuid primary key,
      user_id text not null references users(id) on delete cascade,
      name text not null,
      bbox jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  await pool!.query(`
    create table if not exists project_state (
      project_id uuid primary key references projects(id) on delete cascade,
      osm_data jsonb not null,
      user_edits jsonb not null
    )
  `);
}

async function ensureUser(userId: string) {
  await pool!.query(
    `
      insert into users (id, clerk_id)
      values ($1, $1)
      on conflict (id) do nothing
    `,
    [userId]
  );
}

function parseProjectInput(input: unknown) {
  if (!input || typeof input !== "object") {
    throw new Error("Request body must be an object.");
  }

  const body = input as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name) {
    throw new Error("Project name is required.");
  }

  if (!isBoundingBox(body.bbox)) {
    throw new Error("Project bbox must include north, south, east, and west numbers.");
  }

  if (!body.osmData || typeof body.osmData !== "object") {
    throw new Error("Project osmData is required.");
  }

  if (!Array.isArray(body.userEdits)) {
    throw new Error("Project userEdits must be an array.");
  }

  return {
    bbox: body.bbox,
    id: typeof body.id === "string" && body.id ? body.id : null,
    name,
    osmData: body.osmData,
    userEdits: body.userEdits
  };
}

function isBoundingBox(value: unknown): value is BoundingBox {
  if (!value || typeof value !== "object") {
    return false;
  }

  const bbox = value as Record<string, unknown>;

  return (
    typeof bbox.north === "number" &&
    typeof bbox.south === "number" &&
    typeof bbox.east === "number" &&
    typeof bbox.west === "number"
  );
}

function assertDatabase() {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }
}
