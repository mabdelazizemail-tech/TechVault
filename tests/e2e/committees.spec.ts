import { expect, test } from "@playwright/test";

/**
 * Committee meeting to-do critical path (CLAUDE.md §20, ADR-036): sign in →
 * schedule a meeting → add an agenda item → open the Team To-Do List → add a task
 * for a typed name → reply → update its status → filter the list.
 *
 * Needs a running app against a NON-production database (migrated and seeded) that
 * has a user holding `committees-user`, given as E2E_EMAIL (a username or email) and
 * E2E_PASSWORD, who is a member of an active committee whose name is E2E_COMMITTEE
 * (default "Board").
 *
 * Credentials come from the environment and are never committed (§18.1). Without
 * them the journey is skipped.
 */

const login = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const committee = process.env.E2E_COMMITTEE ?? "Board";

test.describe("Committees: meeting to Team To-Do List", () => {
  test.skip(
    login === undefined || login === "" || password === undefined || password === "",
    "Set E2E_EMAIL and E2E_PASSWORD for a committee member on a test database.",
  );

  test("schedules a meeting, records a task, discusses it and completes it", async ({
    page,
  }) => {
    const stamp = Date.now();
    await page.goto("/login?next=%2Fcommittees%2Fmeetings");
    await page.getByLabel("Username").fill(login ?? "");
    await page.getByLabel("Password").fill(password ?? "");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Meetings" })).toBeVisible();

    // Schedule a meeting a week ahead; the scheduler becomes its organiser.
    await page.getByRole("button", { name: "Schedule meeting" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Committee").selectOption({ label: committee });
    await dialog.getByLabel("Title").fill(`E2E meeting ${stamp}`);
    const when = new Date(Date.now() + 7 * 86_400_000);
    when.setMinutes(when.getMinutes() - when.getTimezoneOffset());
    await dialog.getByLabel("Date and time").fill(when.toISOString().slice(0, 16));
    await dialog.getByRole("button", { name: "Schedule meeting" }).click();
    await expect(
      page.getByRole("heading", { name: `E2E meeting ${stamp}` }),
    ).toBeVisible();

    // The agenda.
    await page.getByRole("button", { name: "Add agenda item" }).click();
    await page.getByRole("dialog").getByLabel("Title").fill("Q4 budget");
    await page.getByRole("dialog").getByRole("button", { name: "Add item" }).click();
    await expect(page.getByText("Q4 budget")).toBeVisible();

    // The Team To-Do List: a task for someone without an account.
    await page.getByRole("link", { name: /Team To-Do List/ }).click();
    await expect(page.getByText("No tasks yet")).toBeVisible();
    await page.getByRole("button", { name: "Add new task" }).first().click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Task description").fill(`Draft the Q4 budget ${stamp}`);
    const due = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await form.getByLabel("Due date").fill(due);
    await form.getByRole("combobox").fill("Omar External");
    await form.getByRole("button", { name: /as a name/ }).click();
    await expect(form.getByText("(not registered)")).toBeVisible();
    await form.getByRole("button", { name: "Add task" }).click();

    // The task page: reply, then complete with a comment.
    await expect(
      page.getByRole("heading", { name: `Draft the Q4 budget ${stamp}` }),
    ).toBeVisible();
    await page.getByLabel("Reply").fill("First draft is circulating.");
    await page.getByRole("button", { name: "Post reply" }).click();
    await expect(page.getByText("First draft is circulating.")).toBeVisible();
    await expect(page.getByText(/Discussion \(1 reply\)/)).toBeVisible();

    await page.getByLabel("Status").selectOption({ label: "Completed" });
    await page.getByLabel("Progress comment").fill("Approved by the board.");
    await page.getByRole("button", { name: "Update status" }).click();
    await expect(page.getByText("changed the status")).toBeVisible();

    // Back on the list, the task is found under Completed.
    await page
      .getByRole("link", { name: /Team To-Do List/ })
      .first()
      .click();
    await page.getByLabel("Status").selectOption({ label: "Completed" });
    await expect(page.getByText(`Draft the Q4 budget ${stamp}`).first()).toBeVisible();
  });
});
