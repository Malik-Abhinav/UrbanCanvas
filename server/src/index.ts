import cors from "cors";
import { clerkMiddleware, getAuth } from "@clerk/express";
import "dotenv/config";
import express from "express";
import { checkDatabase } from "./db.js";
import { fetchOsmData } from "./osm.js";
import { getProject, listProjects, saveProject } from "./projects.js";

const app = express();
const port = Number(process.env.API_PORT ?? 3001);
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

app.use(
  cors({
    allowedHeaders: ["authorization", "content-type"],
    origin: frontendOrigin
  })
);
app.use(express.json({ limit: "8mb" }));
app.use(
  clerkMiddleware({
    publishableKey: clerkPublishableKey,
    secretKey: process.env.CLERK_SECRET_KEY
  })
);

app.get("/", (_req, res) => {
  res.json({
    name: "UrbanCanvas API",
    status: "ok",
    health: "/api/health"
  });
});

app.get("/api/health", async (_req, res) => {
  const database = await checkDatabase();

  res.json({
    status: "ok",
    service: "urbancanvas-api",
    database
  });
});

app.post("/api/osm", async (req, res) => {
  try {
    const data = await fetchOsmData(req.body?.bbox);

    res.json({
      status: "ok",
      data
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      message: error instanceof Error ? error.message : "Unable to fetch OSM data"
    });
  }
});

app.get("/api/projects", async (_req, res) => {
  try {
    const userId = getRequiredUserId(_req);
    const projects = await listProjects(userId);

    res.json({
      status: "ok",
      projects
    });
  } catch (error) {
    res.status(getErrorStatus(error)).json({
      status: "error",
      message: error instanceof Error ? error.message : "Unable to list projects"
    });
  }
});

app.get("/api/projects/:id", async (req, res) => {
  try {
    const userId = getRequiredUserId(req);
    const project = await getProject(req.params.id, userId);

    if (!project) {
      res.status(404).json({
        status: "error",
        message: "Project not found"
      });
      return;
    }

    res.json({
      status: "ok",
      project
    });
  } catch (error) {
    res.status(getErrorStatus(error)).json({
      status: "error",
      message: error instanceof Error ? error.message : "Unable to load project"
    });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const userId = getRequiredUserId(req);
    const project = await saveProject(req.body, userId);

    res.json({
      status: "ok",
      project
    });
  } catch (error) {
    res.status(getErrorStatus(error)).json({
      status: "error",
      message: error instanceof Error ? error.message : "Unable to save project"
    });
  }
});

function getErrorStatus(error: unknown) {
  return error instanceof UnauthorizedError ? 401 : 400;
}

function getRequiredUserId(req: express.Request) {
  const { userId } = getAuth(req);

  if (!userId) {
    throw new UnauthorizedError();
  }

  return userId;
}

class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
  }
}

app.listen(port, () => {
  console.log(`UrbanCanvas API listening on http://localhost:${port}`);
});
