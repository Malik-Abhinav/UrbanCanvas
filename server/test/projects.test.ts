import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("../src/db.js", () => ({
  pool: {
    query: (...args: unknown[]) => queryMock(...args)
  }
}));

const { deleteProject, getProject, saveProject } = await import("../src/projects.js");

const bbox = { north: 28.615, south: 28.605, east: 77.215, west: 77.205 };
const projectId = "11111111-1111-4111-8111-111111111111";
const userId = "user_1";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "My plan",
    bbox,
    osmData: { counts: { roads: 1 }, roads: [], buildings: [], openLand: [] },
    userEdits: [],
    ...overrides
  };
}

beforeEach(() => {
  queryMock.mockReset();
  // Schema setup + ensureUser + default select responses.
  queryMock.mockResolvedValue({ rows: [], rowCount: 1 });
});

describe("saveProject validation", () => {
  it("rejects empty names", async () => {
    await expect(saveProject(validBody({ name: "   " }), userId)).rejects.toThrow(/name is required/i);
  });

  it("rejects a new project name longer than the editing affordance", async () => {
    await expect(saveProject(validBody({ name: "x".repeat(81) }), userId)).rejects.toThrow(/80 characters/i);
  });

  it("saves an existing legacy project name longer than the editing affordance", async () => {
    const legacyName = "Legacy neighborhood plan ".repeat(5);
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes("for update")) {
        return Promise.resolve({ rows: [{ name: legacyName.trim(), user_id: userId }], rowCount: 1 });
      }
      if (sql.includes("insert into projects")) {
        return Promise.resolve({ rows: [{ id: projectId }], rowCount: 1 });
      }
      if (sql.includes("join project_state")) {
        return Promise.resolve({
          rows: [{ id: projectId, name: legacyName, bbox, created_at: new Date(), updated_at: new Date(), osm_data: {}, user_edits: [] }],
          rowCount: 1
        });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const project = await saveProject(validBody({ id: projectId, name: legacyName }), userId);

    expect(project?.name).toBe(legacyName);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("on conflict (id) do update"),
      [projectId, userId, legacyName.trim(), JSON.stringify(bbox)]
    );
  });

  it("rejects non-UUID ids", async () => {
    await expect(saveProject(validBody({ id: "not-a-uuid" }), userId)).rejects.toThrow(/valid UUID/);
  });

  it("accepts a valid new project", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes("join project_state")) {
        return Promise.resolve({
          rows: [{ id: projectId, name: "My plan", bbox, created_at: new Date(), updated_at: new Date(), osm_data: {}, user_edits: [] }],
          rowCount: 1
        });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const project = await saveProject(validBody(), userId);

    expect(project?.id).toBe(projectId);
  });

  it("rejects bboxes larger than the 5 km2 limit", async () => {
    await expect(
      saveProject(
        validBody({ bbox: { north: 28.65, south: 28.55, east: 77.25, west: 77.15 } }),
        userId
      )
    ).rejects.toThrow(/5 km2/);
  });

  it("accepts 501 user edits within the request body limit", async () => {
    const edits = Array.from({ length: 501 }, (_, i) => ({ id: String(i), type: "signal" }));
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes("join project_state")) {
        return Promise.resolve({
          rows: [{ id: projectId, name: "My plan", bbox, created_at: new Date(), updated_at: new Date(), osm_data: {}, user_edits: edits }],
          rowCount: 1
        });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const project = await saveProject(validBody({ userEdits: edits }), userId);

    expect(project?.user_edits).toHaveLength(501);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("insert into project_state"),
      expect.arrayContaining([JSON.stringify(edits)])
    );
  });

  it("accepts a schemaVersion 1 userEdits document and stores it verbatim", async () => {
    const document = {
      metadata: { designBasis: "concept-only", locale: "IN" },
      objects: [{ geometry: { point: { lat: 1, lng: 2 }, type: "Point" }, id: "s1", properties: { kind: "vehicle" }, type: "traffic-signal" }],
      schemaVersion: 1
    };
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes("join project_state")) {
        return Promise.resolve({
          rows: [{ id: projectId, name: "My plan", bbox, created_at: new Date(), updated_at: new Date(), osm_data: {}, user_edits: document }],
          rowCount: 1
        });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const project = await saveProject(validBody({ userEdits: document }), userId);

    expect(project?.user_edits).toEqual(document);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("insert into project_state"),
      expect.arrayContaining([JSON.stringify(document)])
    );
  });

  it.each([
    ["an unsupported schema version", { objects: [], schemaVersion: 2 }],
    ["a versioned object without an objects array", { schemaVersion: 1 }]
  ])("rejects %s as userEdits", async (_label, userEdits) => {
    await expect(saveProject(validBody({ userEdits }), userId)).rejects.toThrow(/userEdits/);
  });

  it("rejects a serialized project state larger than 6 MB", async () => {
    const oversizedEdit = {
      id: "oversized",
      note: "x".repeat(6 * 1024 * 1024),
      type: "signal"
    };

    await expect(saveProject(validBody({ userEdits: [oversizedEdit] }), userId)).rejects.toThrow(/6 MB/i);
  });

  it("rejects non-finite bbox coordinates", async () => {
    await expect(saveProject(validBody({ bbox: { ...bbox, north: Number.NaN } }), userId)).rejects.toThrow(/finite/);
  });
});

describe("getProject / deleteProject id handling", () => {
  it("rejects malformed project ids before touching the database", async () => {
    await expect(getProject("../../etc", userId)).rejects.toThrow(/valid UUID/);
    await expect(deleteProject("1; drop table users", userId)).rejects.toThrow(/valid UUID/);
    expect(queryMock).not.toHaveBeenCalledWith(expect.stringMatching(/select p\.id/), expect.anything(), expect.anything());
  });

  it("reports deletion success based on rowCount", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });
    await expect(deleteProject(projectId, userId)).resolves.toBe(true);

    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(deleteProject(projectId, userId)).resolves.toBe(false);
  });
});

describe("saveProject update path", () => {
  it("uses a supplied UUID in an ownership-safe transactional upsert", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes("for update")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes("insert into projects")) {
        return Promise.resolve({ rows: [{ id: projectId }], rowCount: 1 });
      }
      if (sql.includes("join project_state")) {
        return Promise.resolve({
          rows: [{ id: projectId, name: "My plan", bbox, created_at: new Date(), updated_at: new Date(), osm_data: {}, user_edits: [] }],
          rowCount: 1
        });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await expect(saveProject(validBody({ id: projectId }), userId)).resolves.toMatchObject({ id: projectId });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringMatching(/insert into projects[\s\S]*on conflict \(id\) do update[\s\S]*projects\.user_id = excluded\.user_id/i),
      [projectId, userId, "My plan", JSON.stringify(bbox)]
    );
    expect(queryMock).toHaveBeenCalledWith("commit");
  });

  it("rolls back when a supplied UUID belongs to another user", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes("for update")) {
        return Promise.resolve({ rows: [{ name: "Their plan", user_id: "user_2" }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await expect(saveProject(validBody({ id: projectId }), userId)).rejects.toThrow(/Project not found/);
    expect(queryMock).toHaveBeenCalledWith("rollback");
  });

  it("allows only the exact unchanged long name on an existing legacy project", async () => {
    const legacyName = "Legacy neighborhood plan ".repeat(5).trim();
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes("for update")) {
        return Promise.resolve({ rows: [{ name: legacyName, user_id: userId }], rowCount: 1 });
      }
      if (sql.includes("insert into projects")) {
        return Promise.resolve({ rows: [{ id: projectId }], rowCount: 1 });
      }
      if (sql.includes("join project_state")) {
        return Promise.resolve({ rows: [{ id: projectId, name: legacyName, bbox, osm_data: {}, user_edits: [] }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await expect(saveProject(validBody({ id: projectId, name: legacyName }), userId)).resolves.toMatchObject({ name: legacyName });
    await expect(saveProject(validBody({ id: projectId, name: `${legacyName}!` }), userId)).rejects.toThrow(/80 characters/i);
  });

  it("does not let a client-generated UUID bypass the new-name limit", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes("for update")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await expect(saveProject(validBody({ id: projectId, name: "x".repeat(81) }), userId)).rejects.toThrow(/80 characters/i);
    expect(queryMock).toHaveBeenCalledWith("rollback");
    expect(queryMock).not.toHaveBeenCalledWith(expect.stringContaining("insert into project_state"), expect.anything());
  });
});
