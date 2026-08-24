import { randomUUID } from "node:crypto";
import { pool } from "./db.js";
import type { BoundingBox } from "./bbox.js";
import { getApproximateAreaKm2, isBoundingBox } from "./bbox.js";

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

const maxProjectNameLength = 80;
const maxProjectAreaKm2 = 5;
const maxProjectStateBytes = 6 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  assertProjectId(id);

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
  const osmDataJson = JSON.stringify(project.osmData);
  const userEditsJson = JSON.stringify(project.userEdits);

  if (Buffer.byteLength(osmDataJson) + Buffer.byteLength(userEditsJson) > maxProjectStateBytes) {
    throw new Error("Project map data and drawing edits must be 6 MB or smaller.");
  }

  await pool!.query("begin");

  try {
    if (project.id) {
      const update = await pool!.query(
        `
          update projects
          set name = $3, bbox = $4, updated_at = now()
          where id = $1 and user_id = $2
            and (char_length($3) <= 80 or name = $3)
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
      [id, osmDataJson, userEditsJson]
    );

    await pool!.query("commit");
  } catch (error) {
    await pool!.query("rollback");
    throw error;
  }

  return getProject(id, userId);
}

export async function deleteProject(id: string, userId: string) {
  assertDatabase();
  await ensureProjectSchema();
  await ensureUser(userId);
  assertProjectId(id);

  const result = await pool!.query(
    `
      delete from projects
      where id = $1 and user_id = $2
    `,
    [id, userId]
  );

  // project_state rows cascade; rowCount 0 means the project did not exist
  // for this user (or at all).
  return (result.rowCount ?? 0) > 0;
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
  const id = parseProjectId(body.id);

  if (!name) {
    throw new Error("Project name is required.");
  }

  if (!id && name.length > maxProjectNameLength) {
    throw new Error(`Project name must be ${maxProjectNameLength} characters or fewer.`);
  }

  validateProjectBoundingBox(body.bbox);

  if (!body.osmData || typeof body.osmData !== "object") {
    throw new Error("Project osmData is required.");
  }

  if (!Array.isArray(body.userEdits)) {
    throw new Error("Project userEdits must be an array.");
  }

  return {
    bbox: body.bbox as BoundingBox,
    id,
    name,
    osmData: body.osmData,
    userEdits: body.userEdits
  };
}

function parseProjectId(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new Error("Project id must be a valid UUID.");
  }

  return value.toLowerCase();
}

function validateProjectBoundingBox(bbox: unknown): asserts bbox is BoundingBox {
  if (!isBoundingBox(bbox)) {
    throw new Error("Project bbox must include north, south, east, and west numbers.");
  }

  if (![bbox.north, bbox.south, bbox.east, bbox.west].every(Number.isFinite)) {
    throw new Error("Bounding box coordinates must be finite numbers.");
  }

  if (bbox.south >= bbox.north || bbox.west >= bbox.east) {
    throw new Error("Bounding box coordinates are invalid.");
  }

  if (getApproximateAreaKm2(bbox) > maxProjectAreaKm2) {
    throw new Error(`Selected area exceeds the ${maxProjectAreaKm2} km2 limit.`);
  }
}

function assertProjectId(id: string) {
  if (!uuidPattern.test(id)) {
    throw new Error("Project id must be a valid UUID.");
  }
}

function assertDatabase() {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }
}
