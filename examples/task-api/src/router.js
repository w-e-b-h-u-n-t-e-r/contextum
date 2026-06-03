import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
} from "./store.js";

export async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const segments = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { status: "ok" });
  }

  if (segments[0] !== "tasks") {
    return send(res, 404, { error: "not found" });
  }

  const id = segments[1];

  if (!id) {
    if (req.method === "GET") return send(res, 200, listTasks());
    if (req.method === "POST") return createHandler(req, res);
    return send(res, 405, { error: "method not allowed" });
  }

  if (req.method === "GET") {
    const task = getTask(id);
    return task ? send(res, 200, task) : send(res, 404, { error: "task not found" });
  }

  if (req.method === "PATCH") return patchHandler(req, res, id);

  if (req.method === "DELETE") {
    return deleteTask(id)
      ? send(res, 204)
      : send(res, 404, { error: "task not found" });
  }

  return send(res, 405, { error: "method not allowed" });
}

async function createHandler(req, res) {
  const body = await readJson(req);
  if (!body || typeof body.title !== "string" || body.title.trim() === "") {
    return send(res, 400, { error: "title is required" });
  }
  return send(res, 201, createTask({ title: body.title.trim() }));
}

async function patchHandler(req, res, id) {
  const body = await readJson(req);
  if (!body) return send(res, 400, { error: "invalid JSON body" });

  const updated = updateTask(id, {
    title: typeof body.title === "string" ? body.title : undefined,
    done: typeof body.done === "boolean" ? body.done : undefined,
  });
  return updated ? send(res, 200, updated) : send(res, 404, { error: "task not found" });
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
  });
}

function send(res, status, payload) {
  if (payload === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}
