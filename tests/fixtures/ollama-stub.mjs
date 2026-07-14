import { createServer } from "node:http";

const port = Number(process.env.STUB_PORT ?? 11445);
const responseText = "The deterministic local Ollama stub completed this reliability check.";

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/api/tags") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ models: [{ name: "reliability-stub:latest", size: 1, modified_at: "2026-01-01T00:00:00.000Z" }] }));
    return;
  }
  if (request.method === "POST" && request.url === "/api/chat") {
    let body = ""; request.on("data", (chunk) => { body += chunk; }); request.on("end", () => {
      const input = JSON.parse(body || "{}");
      if (input.stream) {
        response.writeHead(200, { "Content-Type": "application/x-ndjson" });
        response.end(`${JSON.stringify({ model: input.model, message: { role: "assistant", content: responseText }, done: true })}\n`);
      } else {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ model: input.model, message: { role: "assistant", content: responseText }, done: true }));
      }
    });
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, "127.0.0.1");
const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close); process.on("SIGTERM", close);
