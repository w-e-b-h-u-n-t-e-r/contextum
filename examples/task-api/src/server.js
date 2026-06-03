import { createServer } from "node:http";
import { route } from "./router.js";

const port = Number(process.env.PORT ?? 3000);

const server = createServer((req, res) => {
  route(req, res).catch(() => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal server error" }));
  });
});

server.listen(port, () => {
  console.log(`task-api listening on http://localhost:${port}`);
});
