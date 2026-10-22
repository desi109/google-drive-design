#!/usr/bin/env node
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const gradle = join(
  root,
  "backend",
  process.platform === "win32" ? "gradlew.bat" : "gradlew",
);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let server;
let browserTests;
let interrupted;
let serverFailure;
let serverLog = "";
let data;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted = signal;
    browserTests?.kill(signal);
    server?.kill("SIGTERM");
  });
}

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitUntilReady(url) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error("Local verification interrupted.");
    if (serverFailure) throw serverFailure;
    if (server.exitCode !== null || server.signalCode !== null)
      throw new Error("The packaged application exited before becoming ready.");
    try {
      const health = await fetch(`${url}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (health.ok && (await health.json()).status === "up") {
        const page = await fetch(url, { signal: AbortSignal.timeout(1000) });
        if (page.ok && (await page.text()).includes('id="root"')) return;
      }
    } catch {
      /* The JVM may still be starting. */
    }
    await delay(200);
  }
  throw new Error(
    `The packaged application did not serve health and frontend within 60 seconds at ${url}. Run npm run build and retry.`,
  );
}

async function stopServer() {
  if (
    !server ||
    server.exitCode !== null ||
    server.signalCode !== null ||
    !server.pid
  )
    return;
  const stopped = once(server, "close");
  server.kill("SIGTERM");
  const timeout = setTimeout(() => server.kill("SIGKILL"), 10_000);
  timeout.unref();
  try {
    await stopped;
  } finally {
    clearTimeout(timeout);
  }
}

try {
  const { stdout } = await promisify(execFile)(
    gradle,
    ["-p", "backend", "--console=plain", "-q", "printJavaLauncher"],
    { cwd: root },
  );
  const java = stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("COMMONPLACE_JAVA="))
    ?.slice("COMMONPLACE_JAVA=".length);
  if (!java)
    throw new Error(
      "No Java 21 launcher reported by Gradle. Install JDK 21, set JAVA_HOME, and retry.",
    );
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  data = await mkdtemp(join(tmpdir(), "commonplace-local-test-"));
  if (interrupted) throw new Error("Local verification interrupted.");
  server = spawn(
    java,
    [
      "-jar",
      join(root, "backend/build/libs/commonplace-1.0.0.jar"),
      "--debug=false",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        DRIVE_DATA: data,
        DRIVE_SEED: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.once("error", (error) => {
    serverFailure = error;
  });
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      serverLog = (serverLog + chunk).slice(-24_000);
    });
  await waitUntilReady(url);
  console.log(
    `Testing the packaged Java 21 application at ${url} with disposable data.`,
  );
  const result = await new Promise((resolve, reject) => {
    browserTests = spawn(npm, ["test", "--prefix", "frontend"], {
      cwd: root,
      env: { ...process.env, APP_URL: url },
      stdio: "inherit",
    });
    browserTests.once("error", reject);
    browserTests.once("close", (code, signal) =>
      resolve(code ?? (signal === "SIGINT" ? 130 : 1)),
    );
  });
  process.exitCode = result;
  if (result !== 0 && !interrupted)
    console.error(`\nPackaged application logs:\n${serverLog}`);
} catch (error) {
  if (!interrupted)
    console.error(`Local verification failed: ${error.message}\n${serverLog}`);
  process.exitCode = 1;
} finally {
  await stopServer();
  if (data) await rm(data, { recursive: true, force: true });
  if (interrupted) process.exitCode = interrupted === "SIGINT" ? 130 : 143;
}
