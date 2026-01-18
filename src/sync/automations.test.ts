import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { components } from "../lib/openapi.js";
import {
	deserialize,
	LOCAL_AUTOMATIONS_RESOURCE,
	REMOTE_AUTOMATIONS_RESOURCE,
	serialize,
} from "./automations.js";
import type { Configuration } from "./types.js";

type Automation = components["schemas"]["Automation"];

const createTestAutomation = (
	overrides: Partial<Automation> = {},
): Automation => ({
	id: "123",
	creation_date: "2024-01-01T00:00:00Z",
	name: "Test Automation",
	trigger: "subscriber.created",
	status: "active",
	timing: { time: "immediate" },
	actions: [{ type: "send_email", metadata: {} }],
	filters: { filters: [], groups: [], predicate: "and" },
	metadata: {},
	...overrides,
});

describe("automations", () => {
	describe("serialize", () => {
		it("should serialize automations array to YAML", () => {
			const automations = [
				createTestAutomation({ name: "Welcome Email" }),
				createTestAutomation({ id: "456", name: "Goodbye Email" }),
			];

			const result = serialize(automations);

			expect(result).toContain("name: Welcome Email");
			expect(result).toContain("name: Goodbye Email");
			expect(result).toContain("trigger: subscriber.created");
		});
	});

	describe("deserialize", () => {
		it("should deserialize YAML to automations array", () => {
			const yaml = `
- id: "123"
  name: Welcome Email
  trigger: subscriber.created
  status: active
  timing:
    time: immediate
  actions:
    - type: send_email
      metadata: {}
  filters:
    filters: []
    groups: []
    predicate: and
  metadata: {}
  creation_date: "2024-01-01T00:00:00Z"
`;

			const result = deserialize(yaml);

			expect(result.isValid).toBe(true);
			expect(result.automations).toHaveLength(1);
			expect(result.automations[0]?.name).toBe("Welcome Email");
			expect(result.automations[0]?.trigger).toBe("subscriber.created");
		});

		it("should return error for invalid YAML", () => {
			const invalidYaml = "{ invalid yaml";

			const result = deserialize(invalidYaml);

			expect(result.isValid).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should return error when YAML is not an array", () => {
			const yaml = `
name: Single Automation
trigger: subscriber.created
`;

			const result = deserialize(yaml);

			expect(result.isValid).toBe(false);
			expect(result.error).toContain("expected array");
		});
	});

	describe("REMOTE_AUTOMATIONS_RESOURCE", () => {
		it("should have serialize as identity function", () => {
			const automations = [createTestAutomation()];

			const result = REMOTE_AUTOMATIONS_RESOURCE.serialize(automations);

			expect(result).toEqual(automations);
		});

		it("should have deserialize as identity function", () => {
			const automations = [createTestAutomation()];

			const result = REMOTE_AUTOMATIONS_RESOURCE.deserialize(automations);

			expect(result).toEqual(automations);
		});
	});

	describe("LOCAL_AUTOMATIONS_RESOURCE", () => {
		const testDir = path.join(import.meta.dir, ".test-automations-output");

		beforeEach(async () => {
			await Bun.write(path.join(testDir, ".keep"), "");
		});

		afterEach(async () => {
			await rm(testDir, { recursive: true, force: true });
		});

		it("should create automations.yaml file when pulling", async () => {
			const automations = [
				createTestAutomation({ name: "Welcome Email" }),
				createTestAutomation({ id: "456", name: "Reminder Email" }),
			];

			const configuration: Configuration = {
				directory: testDir,
				baseUrl: "https://api.buttondown.com",
				apiKey: "test-key",
			};

			const result = await LOCAL_AUTOMATIONS_RESOURCE.set(
				automations,
				configuration,
			);

			expect(result.creations).toBe(2);

			const filePath = path.join(testDir, "automations.yaml");
			const content = await readFile(filePath, "utf8");

			expect(content).toContain("name: Welcome Email");
			expect(content).toContain("name: Reminder Email");
		});

		it("should read automations from automations.yaml", async () => {
			const yaml = `
- id: "123"
  name: Test Automation
  trigger: subscriber.created
  status: active
  timing:
    time: immediate
  actions:
    - type: send_email
      metadata: {}
  filters:
    filters: []
    groups: []
    predicate: and
  metadata: {}
  creation_date: "2024-01-01T00:00:00Z"
`;
			await writeFile(path.join(testDir, "automations.yaml"), yaml);

			const configuration: Configuration = {
				directory: testDir,
				baseUrl: "https://api.buttondown.com",
				apiKey: "test-key",
			};

			const result = await LOCAL_AUTOMATIONS_RESOURCE.get(configuration);

			expect(result).toHaveLength(1);
			expect(result?.[0]?.name).toBe("Test Automation");
		});

		it("should return empty array when automations.yaml does not exist", async () => {
			const configuration: Configuration = {
				directory: testDir,
				baseUrl: "https://api.buttondown.com",
				apiKey: "test-key",
			};

			const result = await LOCAL_AUTOMATIONS_RESOURCE.get(configuration);

			expect(result).toEqual([]);
		});

		it("should report updates when file content changes", async () => {
			const automations = [createTestAutomation({ name: "Original" })];

			const configuration: Configuration = {
				directory: testDir,
				baseUrl: "https://api.buttondown.com",
				apiKey: "test-key",
			};

			// First write
			await LOCAL_AUTOMATIONS_RESOURCE.set(automations, configuration);

			// Update with different content
			const updatedAutomations = [createTestAutomation({ name: "Updated" })];
			const result = await LOCAL_AUTOMATIONS_RESOURCE.set(
				updatedAutomations,
				configuration,
			);

			expect(result.updates).toBe(1);
			expect(result.creations).toBe(0);
		});

		it("should report noops when file content is unchanged", async () => {
			const automations = [createTestAutomation({ name: "Same" })];

			const configuration: Configuration = {
				directory: testDir,
				baseUrl: "https://api.buttondown.com",
				apiKey: "test-key",
			};

			// First write
			await LOCAL_AUTOMATIONS_RESOURCE.set(automations, configuration);

			// Write same content again
			const result = await LOCAL_AUTOMATIONS_RESOURCE.set(
				automations,
				configuration,
			);

			expect(result.noops).toBe(1);
			expect(result.updates).toBe(0);
			expect(result.creations).toBe(0);
		});
	});
});
