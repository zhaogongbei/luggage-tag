import { ChildProcessWithoutNullStreams, spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import http from 'http';
import net from 'net';
import { app } from 'electron';
import { join, resolve } from 'path';

type BackendRuntime = {
  port: number;
  url: string;
  child: ChildProcessWithoutNullStreams;
};

const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 5;
let runtime: BackendRuntime | null = null;

function compareNodeVersion(versionText: string): boolean {
  const match = versionText.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major > MIN_NODE_MAJOR) {
    return true;
  }
  return major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR;
}

function resolveNodeCommand(): string {
  const command = process.env.LUGGAGE_TAG_NODE_PATH || 'node';
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true });
  const versionText = String(result.stdout || result.stderr || '').trim();
  if (result.error || !compareNodeVersion(versionText)) {
    throw new Error(
      `本地打印端需要 Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0。当前检测结果：${versionText || result.error?.message || '未找到 node'}`
    );
  }
  return command;
}

function hasServerEntry(dir: string): boolean {
  return existsSync(join(dir, 'server', 'index.js')) && existsSync(join(dir, 'dist', 'index.html'));
}

function resolveServerRoot(): string {
  const configured = process.env.LUGGAGE_TAG_SERVER_DIR ? resolve(process.env.LUGGAGE_TAG_SERVER_DIR) : '';
  const candidates = [
    configured,
    join(app.getAppPath(), 'local-server'),
    join(process.resourcesPath, 'local-server'),
    resolve(app.getAppPath(), '..'),
  ].filter(Boolean);
  const found = candidates.find((candidate) => hasServerEntry(candidate));
  if (!found) {
    throw new Error('未找到本地打印服务文件，请先运行 npm run desktop:prepare。');
  }
  return found;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function healthCheck(url: string): Promise<boolean> {
  return new Promise((resolveHealth) => {
    const req = http.get(`${url}/health`, (res) => {
      res.resume();
      resolveHealth(res.statusCode === 200);
    });
    req.on('error', () => resolveHealth(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolveHealth(false);
    });
  });
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolveAvailable) => {
    const server = net.createServer();
    server.once('error', () => resolveAvailable(false));
    server.once('listening', () => {
      server.close(() => resolveAvailable(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function choosePort(): Promise<number> {
  const configured = Number(process.env.LUGGAGE_TAG_DESKTOP_PORT || process.env.PORT || 3108);
  if (process.env.LUGGAGE_TAG_DESKTOP_PORT || process.env.PORT) {
    return configured;
  }
  for (let port = configured; port < configured + 20; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error('本地打印服务端口不可用，请关闭占用 3108-3127 的程序后重试。');
}

export async function startLocalBackend(): Promise<string> {
  if (runtime) {
    return runtime.url;
  }
  const nodeCommand = resolveNodeCommand();
  const serverRoot = resolveServerRoot();
  const port = await choosePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(nodeCommand, [join(serverRoot, 'server', 'index.js')], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      LUGGAGE_TAG_HOST: '127.0.0.1',
      LUGGAGE_TAG_DATA_DIR: join(app.getPath('userData'), 'data'),
      LUGGAGE_TAG_DESKTOP_APP: 'true',
    },
    windowsHide: true,
  });
  runtime = { port, url, child };
  child.stdout.on('data', (data) => console.log(`[local-backend] ${String(data).trim()}`));
  child.stderr.on('data', (data) => console.error(`[local-backend] ${String(data).trim()}`));
  child.once('exit', (code, signal) => {
    console.log(`[local-backend] exited code=${code ?? ''} signal=${signal ?? ''}`);
    runtime = null;
  });

  try {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 18_000) {
      if (await healthCheck(url)) {
        return url;
      }
      if (child.exitCode !== null) {
        throw new Error('本地打印服务启动失败，请检查 Node.js 和打印服务依赖。');
      }
      await wait(300);
    }
    throw new Error('本地打印服务启动超时。');
  } catch (error) {
    if (!child.killed && child.exitCode === null) {
      child.kill();
    }
    runtime = null;
    throw error;
  }
}

export function stopLocalBackend(): void {
  const child = runtime?.child;
  runtime = null;
  if (!child || child.killed) {
    return;
  }
  child.kill();
}
