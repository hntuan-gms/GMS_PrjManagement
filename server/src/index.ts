import "dotenv/config";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAuthConfig } from "./auth/config.js";
import { errorHandler } from "./errors.js";
import { apiRouter } from "./routes/api.js";
import { authRouter } from "./routes/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fail fast and loud. There is no mock/degraded mode any more, so a missing
// credential must stop the process here rather than surface as a confusing error
// on someone's first login. On Cloud Run a boot crash shows up only as "revision
// failed to start", so the message has to carry the diagnosis.
try {
  loadAuthConfig();
} catch (err) {
  console.error("\n[startup] Cannot start GMS PrjManagement:\n  " + (err as Error).message + "\n");
  process.exit(1);
}

const app = express();

// Cloud Run terminates TLS upstream; without this req.secure is false and any
// protocol-derived logic is wrong.
app.set("trust proxy", 1);
app.use(express.json());

// No CORS: production serves the client from this same process, and dev goes
// through the Vite proxy (client/vite.config.ts), so every request is same-origin.
// That also keeps SameSite=Lax cookies working identically in both environments.

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api", apiRouter);
app.use(errorHandler);

// Single-machine deploy: the built React app is copied into server/public
// (see deploy.sh / Dockerfile) so one process serves both the UI and the API
// on one port — no separate frontend server needed.
const publicDir = path.join(__dirname, "../public");
if (existsSync(path.join(publicDir, "index.html"))) {
  // The privacy policy URL is registered with Atlassian and is awkward to change,
  // so accept the extensionless form too — otherwise /privacy falls through to the
  // SPA catch-all below and quietly renders the login screen instead.
  app.get("/privacy", (_req, res) => res.redirect(301, "/privacy.html"));
  app.use(express.static(publicDir));
  // Excludes bare /api and /health as well as their subpaths; the previous
  // /^(?!\/api\/).*/ let "/api" itself fall through to index.html.
  app.get(/^(?!\/(api|health)(\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`GMS PrjManagement server listening on http://localhost:${port}`);
});
