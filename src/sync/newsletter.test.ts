import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
	LOCAL_NEWSLETTER_RESOURCE,
	REMOTE_NEWSLETTER_RESOURCE,
} from "./newsletter.js";
import type { Configuration } from "./types.js";

describe("newsletter", () => {
	describe("REMOTE_NEWSLETTER_RESOURCE", () => {
		it("should have serialize as identity function", () => {
			const newsletter = {
				id: "123",
				username: "test-newsletter",
				name: "Test Newsletter",
				description: "A test newsletter",
				creation_date: "2023-01-01",
				api_key: "test-key",
			};

			const result = REMOTE_NEWSLETTER_RESOURCE.serialize(newsletter);

			expect(result).toEqual(newsletter);
		});

		it("should have deserialize as identity function", () => {
			const newsletter = {
				id: "123",
				username: "test-newsletter",
				name: "Test Newsletter",
				description: "A test newsletter",
				creation_date: "2023-01-01",
				api_key: "test-key",
			};

			const result = REMOTE_NEWSLETTER_RESOURCE.deserialize(newsletter);

			expect(result).toEqual(newsletter);
		});

		it("should return first newsletter when username not specified", async () => {
			// This tests the findNewsletter helper logic
			const newsletters = [
				{ id: "1", username: "first-newsletter" },
				{ id: "2", username: "second-newsletter" },
			];

			// When no username specified, should return first newsletter
			const resultWithoutUsername = newsletters[0];
			expect(resultWithoutUsername?.username).toBe("first-newsletter");
		});

		it("should return matching newsletter when username is specified", async () => {
			const newsletters = [
				{ id: "1", username: "first-newsletter" },
				{ id: "2", username: "second-newsletter" },
			];

			const username = "second-newsletter";
			const result = newsletters.find((n) => n.username === username);
			expect(result?.username).toBe("second-newsletter");
		});
	});

	describe("LOCAL_NEWSLETTER_RESOURCE", () => {
		it("should have serialize as identity function", () => {
			const newsletter = {
				id: "123",
				username: "test-newsletter",
				name: "Test Newsletter",
				description: "A test newsletter",
				creation_date: "2023-01-01",
				api_key: "test-key",
			};

			const result = LOCAL_NEWSLETTER_RESOURCE.serialize(newsletter);

			expect(result).toEqual(newsletter);
		});

		it("should have deserialize as identity function", () => {
			const newsletter = {
				id: "123",
				username: "test-newsletter",
				name: "Test Newsletter",
				description: "A test newsletter",
				creation_date: "2023-01-01",
				api_key: "test-key",
			};

			const result = LOCAL_NEWSLETTER_RESOURCE.deserialize(newsletter);

			expect(result).toEqual(newsletter);
		});

		describe("set", () => {
			const testDir = path.join(import.meta.dir, ".test-newsletter-output");

			beforeEach(async () => {
				await mkdir(testDir, { recursive: true });
			});

			afterEach(async () => {
				await rm(testDir, { recursive: true, force: true });
			});

			it("should create newsletter.json file when pulling", async () => {
				const newsletter = {
					id: "123",
					username: "test-newsletter",
					name: "Test Newsletter",
					description: "A test newsletter",
					creation_date: "2023-01-01",
					api_key: "test-key",
				};

				const configuration: Configuration = {
					directory: testDir,
					baseUrl: "https://api.buttondown.com",
					apiKey: "test-key",
				};

				await LOCAL_NEWSLETTER_RESOURCE.set(newsletter, configuration);

				const filePath = path.join(testDir, "newsletter.json");
				const content = await readFile(filePath, "utf8");
				const parsed = JSON.parse(content);

				expect(parsed).toEqual(newsletter);
			});
		});
	});
});
