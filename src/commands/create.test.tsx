import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import delay from "delay";
import { render } from "ink-testing-library";
import Create from "./create.js";

describe("create", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "create-test-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  function renderCreate(title: string) {
    render(<Create directory={tempDir} title={title} />);
    return delay(500);
  }

  test("should reject titles that produce empty slugs", async () => {
    const { lastFrame } = render(
      <Create directory={tempDir} title="🎉 ✨ 🚀" />,
    );

    await delay(500);

    expect(lastFrame()).toContain(
      "Title must contain at least one alphanumeric character",
    );

    const emailsDir = path.join(tempDir, "emails");
    const files = await readdir(emailsDir);
    expect(files).toHaveLength(0);
  });
});
