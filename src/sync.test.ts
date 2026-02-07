import { describe, expect, it } from "bun:test";

// All sync tests have been moved to individual module test files:
// - sync/automations.test.ts
// - sync/emails.test.ts
// - sync/images.test.ts
// - sync/newsletter.test.ts

describe("sync", () => {
	it("should export resources", async () => {
		const { RESOURCES } = await import("./sync/index.js");
		expect(RESOURCES).toHaveLength(5);
	});
});
