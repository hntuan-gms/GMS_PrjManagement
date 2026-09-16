import "dotenv/config";
import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiRouter } from "./routes/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api", apiRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

// Single-machine deploy: the built React app is copied into server/public
// (see deploy.sh / Dockerfile) so one process serves both the API and the UI
// on one port — no separate frontend server or CORS setup needed.
const publicDir = path.join(__dirname, "../public");
if (existsSync(path.join(publicDir, "index.html"))) {
  app.use(express.static(publicDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`GMS PrjManagement server listening on http://localhost:${port}`);
});
