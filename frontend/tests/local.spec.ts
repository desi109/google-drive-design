import { test, expect } from "@playwright/test";

test("two independent browser clients preserve a reconnect conflict", async ({
  browser,
  baseURL,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const first = await a.newPage(),
    second = await b.newPage();
  const errors: string[] = [];
  first.on("pageerror", (e) => errors.push(e.message));
  second.on("pageerror", (e) => errors.push(e.message));
  await Promise.all([first.goto(baseURL!), second.goto(baseURL!)]);
  for (const p of [first, second]) {
    await p
      .getByRole("button", { name: "Inspect Welcome.txt", exact: true })
      .click();
    await p.getByRole("button", { name: "Edit text", exact: true }).click();
    await expect(
      p.getByRole("textbox", { name: "File contents", exact: true }),
    ).toBeVisible();
  }
  const unique = Date.now();
  await a.setOffline(true);
  await first
    .getByRole("textbox", { name: "File contents", exact: true })
    .fill("Client A offline draft " + unique);
  await first
    .getByRole("button", { name: "Save offline draft", exact: true })
    .click();
  await expect(
    first.getByText("1 pending transfer", { exact: true }),
  ).toBeVisible();
  await second
    .getByRole("textbox", { name: "File contents", exact: true })
    .fill("Client B current revision " + unique);
  await second
    .getByRole("button", { name: "Save revision", exact: true })
    .click();
  await expect(
    second.getByText("Revision saved.", { exact: true }),
  ).toBeVisible();
  await a.setOffline(false);
  await expect(
    first.getByText("Conflicting edit preserved as a separate file.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    first.getByText("1 pending transfer", { exact: true }),
  ).toHaveCount(0);
  const conflict = first.getByRole("button", {
    name: /^Inspect Welcome.txt \(conflict/,
  });
  await expect(conflict).toBeVisible();
  await conflict.click();
  await expect(first.locator(".text-preview")).toContainText(
    "Client A offline draft " + unique,
  );
  await first
    .getByRole("button", { name: "Inspect Welcome.txt", exact: true })
    .click();
  await expect(first.locator(".text-preview")).toContainText(
    "Client B current revision " + unique,
  );
  await first
    .getByRole("button", { name: "Version history", exact: true })
    .click();
  await expect(first.getByText("2 revisions", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});

test("folder upload resumes without retransmitting an accepted block", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Inspect Welcome.txt", exact: true }),
  ).toBeVisible();
  const folder = "Transfer lab " + Date.now();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(folder);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page
    .getByRole("button", { name: "Open " + folder, exact: true })
    .click();
  let firstParts = 0,
    interrupted = false;
  await page.route("**/api/uploads/*/parts/*", async (route) => {
    if (route.request().url().endsWith("/parts/0")) firstParts++;
    if (route.request().url().endsWith("/parts/1") && !interrupted) {
      interrupted = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  const file = {
    name: "resumable.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(4 * 1024 * 1024 + 31, 65),
  };
  await page.getByLabel("Choose file to upload").setInputFiles(file);
  await expect(page.getByRole("alert")).toContainText(
    "Reselect the same file",
    { timeout: 20000 },
  );
  await page.getByLabel("Choose file to upload").setInputFiles(file);
  await expect(
    page.getByRole("button", { name: "Inspect resumable.txt", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  expect(firstParts).toBe(1);
  expect(interrupted).toBe(true);
  await page
    .getByRole("button", { name: "Inspect resumable.txt", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("resumable.txt");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Inspect resumable.txt", exact: true }),
  ).toBeVisible();
});

test("reader UI and server both reject writes", async ({ page, request }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Account settings", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Identity", exact: true })
    .selectOption("bob");
  await page.getByRole("button", { name: "Use account", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Inspect Welcome.txt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload file", exact: true }),
  ).toBeDisabled();
  const namespaces = await request.get("/api/namespaces", {
    headers: { Authorization: "Bearer local-bob-key" },
  });
  const ns = (await namespaces.json()).namespaces[0].id;
  const denied = await request.post(`/api/namespaces/${ns}/folders`, {
    headers: {
      Authorization: "Bearer local-bob-key",
      "Idempotency-Key": "reader-e2e-" + Date.now(),
    },
    data: { name: "Forbidden" },
  });
  expect(denied.status()).toBe(403);
});
