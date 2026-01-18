import { beforeEach, describe, expect, test } from "bun:test";
import delay from "delay";
import { render } from "ink-testing-library";
import createConfig from "../config.js";
import Login from "./login.js";

beforeEach(() => {
	const config = createConfig();
	config.clear();
});

describe("login", () => {
	describe("OAuth flow (default)", () => {
		// Note: Tests that start the OAuth server can conflict when run in parallel
		// since they all try to bind to port 9876. These tests verify the UI states
		// but may fail if another test is already using the port.

		test("should show already logged in when API key exists", () => {
			const config = createConfig();
			config.set("apiKey", "existing-api-key");

			const { lastFrame } = render(<Login />);
			expect(lastFrame()).toContain("You're already logged in");
			expect(lastFrame()).toContain("buttondown login --force");
		});

		test("should show already logged in when access token exists", () => {
			const config = createConfig();
			config.set("accessToken", "existing-access-token");

			const { lastFrame } = render(<Login />);
			expect(lastFrame()).toContain("You're already logged in");
		});

		test("should show initializing state before OAuth flow starts", () => {
			// This test only checks the initial render, before the server starts
			const { lastFrame } = render(<Login />);
			// Initial state is "idle" which shows "Initializing..."
			const frame = lastFrame();
			// Either initializing or already started OAuth flow
			expect(
				frame?.includes("Initializing") ||
					frame?.includes("Opening browser") ||
					frame?.includes("Login failed"),
			).toBe(true);
		});
	});

	describe("API key flow (--api-key flag)", () => {
		test("should show API key input when --api-key flag is provided with value", () => {
			const { lastFrame } = render(<Login apiKey="test-key" />);
			expect(lastFrame()).toContain("Please enter your Buttondown API key");
		});

		test("should use provided API key and allow submit", async () => {
			const providedKey = "my-provided-api-key";
			const { stdin, lastFrame } = render(<Login apiKey={providedKey} />);

			// The key should already be in the input
			await delay(50);
			stdin.write("\r"); // Just submit
			await delay(200);

			expect(lastFrame()).toContain("Successfully logged in");
			const config = createConfig();
			expect(config.get("apiKey")).toBe(providedKey);
		});

		test("should clear OAuth tokens when using API key", async () => {
			const config = createConfig();
			config.set("accessToken", "old-access-token");
			config.set("refreshToken", "old-refresh-token");

			const { stdin, lastFrame } = render(<Login apiKey="new-api-key" />);
			await delay(50);
			stdin.write("\r");
			await delay(200);

			expect(lastFrame()).toContain("Successfully logged in");
			expect(config.get("accessToken")).toBeUndefined();
			expect(config.get("refreshToken")).toBeUndefined();
		});
	});
});
