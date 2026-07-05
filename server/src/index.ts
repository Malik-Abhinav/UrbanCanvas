import cors from "cors";
import "dotenv/config";
import express from "express";
import { checkDatabase } from "./db.js";

const app = express();
const port = Number(process.env.API_PORT ?? 3001);
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

app.use(
  cors({
    origin: frontendOrigin
  })
);
app.use(express.json());

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

app.listen(port, () => {
  console.log(`UrbanCanvas API listening on http://localhost:${port}`);
});
