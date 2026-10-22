import { test, expect } from "@playwright/test";
test("sample browsing, revision download, search, reload and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("");
  await expect(page.getByText("Public sample", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Open Product studio", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Inspect Project brief.md", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Project brief.md", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Version history" }).click();
  await expect(page.getByText("2 revisions", { exact: true })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download revision 1", exact: true })
    .click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toContain("Project brief");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Inspect Project brief.md", exact: true }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("field notes");
  await expect(
    page.getByRole("button", {
      name: "Inspect Sync field notes.txt",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("does not exist");
  await expect(page.getByText("No matching files")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("searchbox").fill("");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
