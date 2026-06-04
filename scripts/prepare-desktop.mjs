import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const electronDir = path.join(rootDir, "electron");
const localServerDir = path.join(electronDir, "local-server");
const runtimeDir = path.join(localServerDir, "runtime");
const npmCmd = "npm";

async function copyIfExists(source, target) {
  try {
    await fs.cp(source, target, { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd ?? rootDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: true,
  });
}

async function copyNodeRuntime() {
  const nodeBinaryName = process.platform === "win32" ? "node.exe" : "node";
  const bundledNodePath = path.join(runtimeDir, nodeBinaryName);
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.copyFile(process.execPath, bundledNodePath);
}

await fs.rm(localServerDir, { force: true, recursive: true });
await fs.mkdir(localServerDir, { recursive: true });

run(npmCmd, ["run", "build"]);

await copyIfExists(path.join(rootDir, "server"), path.join(localServerDir, "server"));
await copyIfExists(path.join(rootDir, "dist"), path.join(localServerDir, "dist"));
await copyIfExists(path.join(rootDir, "public"), path.join(localServerDir, "public"));
await fs.copyFile(path.join(rootDir, "package.json"), path.join(localServerDir, "package.json"));
await fs.copyFile(path.join(rootDir, "package-lock.json"), path.join(localServerDir, "package-lock.json"));

run(npmCmd, ["install", "--omit=dev", "--ignore-scripts", "--legacy-peer-deps"], { cwd: localServerDir });
await copyNodeRuntime();
