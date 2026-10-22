#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configuration, ensurePortAvailable } from "./startup.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const gradle = join(
  root,
  "backend",
  process.platform === "win32" ? "gradlew.bat" : "gradlew",
);
let activeChild;
let stopped;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopped = signal;
    if (activeChild && !activeChild.killed) activeChild.kill(signal);
  });
}

async function run(command, args, { capture = false, env = process.env } = {}) {
  if (stopped) throw new Error("Startup interrupted.");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    });
    activeChild = child;
    let output = "";
    if (capture) {
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
    }
    child.once("error", (error) => {
      if (activeChild === child) activeChild = undefined;
      reject(new Error(`Cannot run ${command}: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      if (activeChild === child) activeChild = undefined;
      if (code === 0) resolve(output);
      else
        reject(
          new Error(
            `${command} ${args.join(" ")} failed (${signal ?? `exit ${code}`}).${output ? `\n${output.trim()}` : ""}`,
          ),
        );
    });
  });
}

try {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12))
    throw new Error(
      `Node.js 22.12 or newer is required (found ${process.versions.node}). Install a current Node.js LTS release and retry npm start.`,
    );
  const config = configuration(process.env, root);
  await ensurePortAvailable(config.host, config.port);
  await run(npm, ["--version"], { capture: true });
  console.log("Finding the Java 21 toolchain with Gradle…");
  let java;
  try {
    const output = await run(
      gradle,
      ["-p", "backend", "--console=plain", "-q", "printJavaLauncher"],
      { capture: true },
    );
    java = output
      .split(/\r?\n/)
      .find((line) => line.startsWith("COMMONPLACE_JAVA="))
      ?.slice("COMMONPLACE_JAVA=".length);
    if (!java)
      throw new Error(`Gradle did not report a Java 21 launcher.\n${output}`);
    await access(java, constants.X_OK);
  } catch (error) {
    throw new Error(
      `Java 21 is required. Install a JDK 21 and set JAVA_HOME to its location, then retry npm start. Inspect detected installations with ./backend/gradlew -p backend javaToolchains.\n${error.message}`,
    );
  }
  console.log("Installing the pinned frontend dependencies…");
  await run(npm, ["ci", "--prefix", "frontend"]);
  console.log("Building the local frontend…");
  await run(npm, ["run", "build", "--prefix", "frontend"]);
  console.log("Building the application…");
  await run(gradle, [
    "-p",
    "backend",
    "--console=plain",
    "bootJar",
    "-PskipFrontendBuild=true",
  ]);
  if (stopped) throw new Error("Startup interrupted.");
  console.log(
    `\nCommonplace: http://${config.host.includes(":") ? `[${config.host}]` : config.host}:${config.port}`,
  );
  console.log(`Persistent data: ${config.data}\nPress Ctrl+C to stop.\n`);
  await run(
    java,
    [
      "-jar",
      join(root, "backend/build/libs/commonplace-1.0.0.jar"),
      "--debug=false",
    ],
    {
      env: {
        ...process.env,
        HOST: config.host,
        PORT: String(config.port),
        DRIVE_DATA: config.data,
        DRIVE_SEED: config.seed,
      },
    },
  );
} catch (error) {
  if (!stopped) console.error(`\nStartup failed: ${error.message}`);
  process.exitCode =
    stopped === "SIGINT" ? 130 : stopped === "SIGTERM" ? 143 : 1;
}
