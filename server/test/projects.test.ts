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

  it("rejects names longer than 80 characters", async () => {
    await expect(saveProject(validBody({ name: "x".repeat(81) }), userId)).rejects.toThrow(/80 characters/);
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

  it("rejects more than 500 user edits", async () => {
    await expect(
      saveProject(validBody({ userEdits: Array.from({ length: 501 }, (_, i) => ({ id: String(i), type: "signal" })) }), userId)
    ).rejects.toThrow(/500 drawing edits/);
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
  it("fails the transaction when the project belongs to another user", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.trim().startsWith("update projects")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await expect(saveProject(validBody({ id: projectId }), userId)).rejects.toThrow(/Project not found/);
    expect(queryMock).toHaveBeenCalledWith("rollback");
  });
});
