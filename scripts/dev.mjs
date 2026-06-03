import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const nodeBin = process.execPath;
const viteBin = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");

function start(name, command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  child.on("exit", (code, signal) => {
    console.log(`[${name}] exited (code=${code}, signal=${signal})`);
  });
  child.on("error", (err) => {
    console.error(`[${name}] spawn error:`, err.message);
  });
  return child;
}

const server = start("server", nodeBin, ["server/index.js"]);
const client = start("client", nodeBin, [viteBin, "--host", "0.0.0.0"]);

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!server.killed) server.kill("SIGTERM");
  if (!client.killed) client.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

let alive = 2;
function onChildExit() {
  alive--;
  if (alive <= 0) {
    shutdown();
    process.exit(0);
  }
}
server.on("exit", onChildExit);
client.on("exit", onChildExit);
