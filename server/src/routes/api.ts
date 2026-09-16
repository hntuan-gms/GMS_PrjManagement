import { Router } from "express";
import { taskService } from "../taskService.js";
import type { TaskCreateInput, TaskUpdateInput } from "../types.js";

export const apiRouter = Router();

apiRouter.get("/meta", (_req, res) => {
  res.json(taskService.meta());
});

apiRouter.get("/tasks", async (_req, res) => {
  try {
    const tasks = await taskService.listTasks();
    res.json(tasks);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

apiRouter.get("/users", async (_req, res) => {
  try {
    const users = await taskService.listUsers();
    res.json(users);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

apiRouter.post("/tasks", async (req, res) => {
  try {
    const input = req.body as TaskCreateInput;
    if (!input.summary || !input.issueType) {
      return res.status(400).json({ error: "summary and issueType are required" });
    }
    const task = await taskService.createTask(input);
    res.status(201).json(task);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

apiRouter.patch("/tasks/:id", async (req, res) => {
  try {
    const input = req.body as TaskUpdateInput;
    const task = await taskService.updateTask(req.params.id, input);
    res.json(task);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

apiRouter.delete("/tasks/:id", async (req, res) => {
  try {
    await taskService.deleteTask(req.params.id);
    res.status(204).end();
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

apiRouter.post("/sync", async (_req, res) => {
  try {
    const tasks = await taskService.listTasks();
    res.json({ syncedAt: new Date().toISOString(), count: tasks.length, tasks });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});
