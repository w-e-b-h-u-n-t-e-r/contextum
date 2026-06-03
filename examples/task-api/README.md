# task-api

A small, zero-dependency REST API for managing tasks. It exists so you can see a
**Contextum** context layer applied to a real, runnable project.

## Run

```bash
node src/server.js
# task-api listening on http://localhost:3000
```

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness check |
| GET | `/tasks` | List all tasks |
| POST | `/tasks` | Create a task (`{ "title": "..." }`) |
| GET | `/tasks/:id` | Get one task |
| PATCH | `/tasks/:id` | Update `title` and/or `done` |
| DELETE | `/tasks/:id` | Delete a task |

## Try it

```bash
curl -s localhost:3000/tasks
curl -s -X POST localhost:3000/tasks -d '{"title":"write docs"}'
```

## Contextum layer

This folder was initialized with:

```bash
npx contextum init
```

That produced `AGENTS.md` and the `ai-context/` directory. Open `ai-context/README.md`
to see what an agent reads before touching this code, and run `contextum doctor` here
to see the readiness scorecard.
