import { describe, expect, it } from "bun:test";
import {
	deserialize,
	LOCAL_AUTOMATIONS_RESOURCE,
	REMOTE_AUTOMATIONS_RESOURCE,
	serialize,
} from "./automations.js";

const SAMPLE_AUTOMATION = {
	id: "aut_abc123",
	name: "Welcome email",
	status: "active" as const,
	trigger: "subscriber.confirmed" as const,
	timing: {
		time: "delay" as const,
		delay: {
			value: "1",
			unit: "days" as const,
			time_of_day: "morning" as const,
		},
	},
	actions: [
		{
			type: "send_email" as const,
			metadata: { email_id: "eml_xyz789" },
		},
	],
	filters: {
		filters: [],
		groups: [],
		predicate: "and" as const,
	},
	metadata: {},
	should_evaluate_filter_after_delay: false,
};

describe("automations", () => {
	describe("serialize", () => {
		it("should serialize automation as JSON", () => {
			const result = serialize(SAMPLE_AUTOMATION);
			const parsed = JSON.parse(result);

			expect(parsed.id).toBe("aut_abc123");
			expect(parsed.name).toBe("Welcome email");
			expect(parsed.status).toBe("active");
			expect(parsed.trigger).toBe("subscriber.confirmed");
		});

		it("should include all serialized fields", () => {
			const result = serialize(SAMPLE_AUTOMATION);
			const parsed = JSON.parse(result);

			expect(parsed.actions).toEqual(SAMPLE_AUTOMATION.actions);
			expect(parsed.filters).toEqual(SAMPLE_AUTOMATION.filters);
			expect(parsed.timing).toEqual(SAMPLE_AUTOMATION.timing);
			expect(parsed.metadata).toEqual({});
			expect(parsed.should_evaluate_filter_after_delay).toBe(false);
		});

		it("should exclude null and undefined values", () => {
			const result = serialize({
				name: "Test",
				id: undefined,
			});
			const parsed = JSON.parse(result);

			expect(parsed.name).toBe("Test");
			expect("id" in parsed).toBe(false);
		});

		it("should produce formatted JSON", () => {
			const result = serialize(SAMPLE_AUTOMATION);
			expect(result).toContain("\n");
			expect(result).toContain("  ");
		});
	});

	describe("deserialize", () => {
		it("should deserialize valid JSON", () => {
			const content = JSON.stringify(SAMPLE_AUTOMATION);
			const result = deserialize(content);

			expect(result.isValid).toBe(true);
			expect(result.automation.name).toBe("Welcome email");
			expect(result.automation.trigger).toBe("subscriber.confirmed");
			expect(result.automation.actions).toEqual(
				SAMPLE_AUTOMATION.actions,
			);
		});

		it("should return invalid for bad JSON", () => {
			const result = deserialize("not json at all");

			expect(result.isValid).toBe(false);
			expect(result.error).toBe("Invalid JSON");
		});

		it("should return invalid when name is missing", () => {
			const content = JSON.stringify({
				trigger: "subscriber.confirmed",
			});
			const result = deserialize(content);

			expect(result.isValid).toBe(false);
			expect(result.error).toContain("name");
		});
	});

	describe("serialize/deserialize roundtrip", () => {
		it("should preserve data through roundtrip", () => {
			const serialized = serialize(SAMPLE_AUTOMATION);
			const { automation } = deserialize(serialized);

			expect(automation.id).toBe(SAMPLE_AUTOMATION.id);
			expect(automation.name).toBe(SAMPLE_AUTOMATION.name);
			expect(automation.status).toBe(SAMPLE_AUTOMATION.status);
			expect(automation.trigger).toBe(SAMPLE_AUTOMATION.trigger);
			expect(automation.timing).toEqual(SAMPLE_AUTOMATION.timing);
			expect(automation.actions).toEqual(SAMPLE_AUTOMATION.actions);
			expect(automation.filters).toEqual(SAMPLE_AUTOMATION.filters);
			expect(automation.should_evaluate_filter_after_delay).toBe(false);
		});
	});

	describe("REMOTE_AUTOMATIONS_RESOURCE", () => {
		it("should have serialize as identity function", () => {
			const automations = [SAMPLE_AUTOMATION as any];
			expect(
				REMOTE_AUTOMATIONS_RESOURCE.serialize(automations),
			).toEqual(automations);
		});

		it("should have deserialize as identity function", () => {
			const automations = [SAMPLE_AUTOMATION as any];
			expect(
				REMOTE_AUTOMATIONS_RESOURCE.deserialize(automations),
			).toEqual(automations);
		});
	});

	describe("LOCAL_AUTOMATIONS_RESOURCE", () => {
		it("should serialize automations to JSON strings", () => {
			const automations = [SAMPLE_AUTOMATION as any];
			const result =
				LOCAL_AUTOMATIONS_RESOURCE.serialize(automations);

			expect(result).toHaveLength(1);
			expect(JSON.parse(result[0]).name).toBe("Welcome email");
		});

		it("should deserialize JSON strings to automations", () => {
			const strings = [JSON.stringify(SAMPLE_AUTOMATION)];
			const result =
				LOCAL_AUTOMATIONS_RESOURCE.deserialize(strings);

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("Welcome email");
		});
	});
});
