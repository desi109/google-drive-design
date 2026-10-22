import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { configuration, ensurePortAvailable } from "./startup.mjs";

test("startup defaults keep persisted data at the repository root", () => {
  assert.deepEqual(configuration({}, "/tmp/commonplace"), {
    root: "/tmp/commonplace",
    host: "127.0.0.1",
    port: 8080,
    data: "/tmp/commonplace/data",
    seed: "true",
  });
  assert.equal(
    configuration(
      { DRIVE_DATA: "my-data", DRIVE_SEED: "false", PORT: "8291" },
      "/tmp/commonplace",
    ).data,
    "/tmp/commonplace/my-data",
  );
  assert.equal(
    configuration({ DRIVE_SEED: "false" }, "/tmp/commonplace").seed,
    "false",
  );
});

test("invalid configuration fails before dependency installation or data creation", () => {
  for (const port of ["0", "65536", "8080abc", "-1", ""]) {
    assert.throws(
      () => configuration({ PORT: port }, "/tmp/commonplace"),
      /PORT must be/,
    );
  }
  assert.throws(
    () => configuration({ DRIVE_DATA: "" }, "/tmp/commonplace"),
    /DRIVE_DATA must not be empty/,
  );
  assert.throws(
    () => configuration({ DRIVE_SEED: "maybe" }, "/tmp/commonplace"),
    /DRIVE_SEED must be true or false/,
  );
});

test("an occupied port reports a useful error and leaves its listener running", async () => {
  const occupied = createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = occupied.address();
    await assert.rejects(
      ensurePortAvailable("127.0.0.1", port),
      new RegExp(`Port ${port}.*PORT=`),
    );
    assert.equal(occupied.listening, true);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});

test("the startup port probe releases the port for the Java server", async () => {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  await ensurePortAvailable("127.0.0.1", port);
  await new Promise((resolve) => probe.listen(port, "127.0.0.1", resolve));
  await new Promise((resolve) => probe.close(resolve));
});
