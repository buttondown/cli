import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import delay from "delay";
import { render } from "ink-testing-library";
import createConfig from "../config.js";
import { jsonResponse, mockFetch } from "../test-helpers.js";
import Login from "./login.js";

const BASE_URL = "https://api.buttondown.com";

let originalFetch: typeof fetch;

beforeEach(() => {
	const config = createConfig();
	config.clear();
	originalFetch = globalThis.fetch;
	mockFetch((_, url) => {
		if (url.pathname === "/newsletters") {
			return jsonResponse({
				results: [{ id: "nl_1", username: "test-user" }],
				count: 1,
			});
		}
	});
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("login", () => {
	test("should display starting status initially", () => {
		const { lastFrame } = render(<Login baseUrl={BASE_URL} />);
		expect(lastFrame()).toContain("Please enter your Buttondown API key:");
	});

	test("should persist api key via interactive input", async () => {
		const randomKey = Math.random().toString(36).slice(2, 15);
		const { stdin, frames } = render(<Login baseUrl={BASE_URL} />);

		await delay(50);

		stdin.write(randomKey);

		await delay(50);

		stdin.write("\r");

		await delay(200);

		expect(frames.join("\n")).toContain("Logged in.");
		const config = createConfig();
		expect(config.get("apiKey")).toBe(randomKey);
		expect(config.get("username")).toBe("test-user");
	});

	test("should persist api key non-interactively when --api-key is passed", async () => {
		const randomKey = Math.random().toString(36).slice(2, 15);
		const { frames } = render(<Login apiKey={randomKey} baseUrl={BASE_URL} />);

		await delay(200);

		expect(frames.join("\n")).toContain("Logged in.");
		const config = createConfig();
		expect(config.get("apiKey")).toBe(randomKey);
	});

	test("should trim whitespace from pasted keys", async () => {
		const randomKey = Math.random().toString(36).slice(2, 15);
		const { frames } = render(
			<Login apiKey={`  ${randomKey}\t`} baseUrl={BASE_URL} />,
		);

		await delay(200);

		expect(frames.join("\n")).toContain("Logged in.");
		expect(createConfig().get("apiKey")).toBe(randomKey);
	});

	test("should reject a key the API does not accept", async () => {
		mockFetch((_, url) => {
			if (url.pathname === "/newsletters") {
				return jsonResponse({ detail: "Invalid API token" }, 401);
			}
		});

		const { frames } = render(<Login apiKey="wrong-key" baseUrl={BASE_URL} />);

		await delay(200);

		expect(frames.join("\n")).toContain("Invalid API token");
		expect(createConfig().get("apiKey")).toBeUndefined();
	});

	test("should show already logged in message when API key exists and no force flag", () => {
		const config = createConfig();
		config.set("apiKey", "existing-api-key");

		const { lastFrame } = render(<Login baseUrl={BASE_URL} />);
		expect(lastFrame()).toContain("Already logged in.");
		expect(lastFrame()).toContain("buttondown login --force");
	});

	test("should not overwrite existing credentials non-interactively without --force", async () => {
		const config = createConfig();
		config.set("apiKey", "existing-api-key");

		const { frames } = render(<Login apiKey="new-key" baseUrl={BASE_URL} />);

		await delay(200);

		expect(frames.join("\n")).toContain("Already logged in.");
		expect(config.get("apiKey")).toBe("existing-api-key");
	});

	test("should show login prompt when API key exists but force flag is true", () => {
		const config = createConfig();
		config.set("apiKey", "existing-api-key");

		const { lastFrame } = render(<Login force={true} baseUrl={BASE_URL} />);
		expect(lastFrame()).toContain("Please enter your Buttondown API key:");
	});

	test("should allow overriding existing API key with force flag", async () => {
		const config = createConfig();
		config.set("apiKey", "existing-api-key");

		const newRandomKey = Math.random().toString(36).slice(2, 15);
		const { stdin, frames } = render(<Login force={true} baseUrl={BASE_URL} />);

		await delay(50);

		stdin.write(newRandomKey);

		await delay(50);

		stdin.write("\r");

		await delay(200);

		expect(frames.join("\n")).toContain("Logged in.");
		expect(config.get("apiKey")).toBe(newRandomKey);
	});
});
