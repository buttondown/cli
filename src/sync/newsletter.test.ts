import { describe, expect, it } from "bun:test";
import {
	LOCAL_NEWSLETTER_RESOURCE,
	REMOTE_NEWSLETTER_RESOURCE,
} from "./newsletter.js";

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
	});
});
