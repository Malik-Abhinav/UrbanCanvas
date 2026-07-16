import cors from "cors";
import { clerkMiddleware, getAuth } from "@clerk/express";
import "dotenv/config";
import express from "express";
import { analyzeProjectChanges } from "./analysis.js";
import { checkDatabase } from "./db.js";
import { fetchOsmData } from "./osm.js";
import { getProject, listProjects, saveProject } from "./projects.js";

const app = express();
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
const frontendOrigins = (process.env.FRONTEND_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

app.set("trust proxy", 1);
app.use(
  cors({
    allowedHeaders: ["authorization", "content-type"],
    origin: frontendOrigins
  })
);
app.use(express.json({ limit: "8mb" }));

app.get("/", (_req, res) => {
  res.json({
    name: "UrbanCanvas API",
    status: "ok",
    health: "/api/health",
    environment: process.env.NODE_ENV ?? "development"
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

app.use(
  clerkMiddleware({
    publishableKey: clerkPublishableKey,
    secretKey: process.env.CLERK_SECRET_KEY
  })
);

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

app.post("/api/analyze", async (req, res) => {
  try {
    getRequiredUserId(req);
    const analysis = analyzeProjectChanges(req.body);

    res.json({
      status: "ok",
      analysis
    });
  } catch (error) {
    res.status(getErrorStatus(error)).json({
      status: "error",
      message: error instanceof Error ? error.message : "Unable to analyze changes"
    });
  }
});

app.use((_req, res) => {
  res.status(404).json({
    status: "error",
    message: "API route not found"
  });
});

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  void next;
  console.error("Unhandled API error", error);

  if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") {
    res.status(413).json({
      status: "error",
      message: "Request body is too large. Select a smaller area or reduce the number of edits."
    });
    return;
  }

  if (error instanceof SyntaxError) {
    res.status(400).json({
      status: "error",
      message: "Request body must be valid JSON."
    });
    return;
  }

  res.status(500).json({
    status: "error",
    message: "Unexpected server error"
  });
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
