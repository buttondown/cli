import { describe, expect, it } from "bun:test";
import {
	calculateTokenExpiresAt,
	getAuthorizeUrl,
	isTokenExpired,
} from "./auth.js";

describe("auth", () => {
	describe("getAuthorizeUrl", () => {
		it("should generate correct authorize URL", () => {
			const url = getAuthorizeUrl("test-state", "https://api.buttondown.com");

			expect(url).toContain("https://buttondown.com/oauth/authorize");
			expect(url).toContain("client_id=buttondown-cli");
			expect(url).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A9876%2Fcallback");
			expect(url).toContain("response_type=code");
			expect(url).toContain("state=test-state");
		});

		it("should handle custom base URL", () => {
			const url = getAuthorizeUrl("test-state", "https://api.staging.buttondown.com");

			expect(url).toContain("https://staging.buttondown.com/oauth/authorize");
		});

		it("should handle local development URL without api subdomain", () => {
			const url = getAuthorizeUrl("test-state", "http://application.bd:8000");

			expect(url).toContain("http://application.bd:8000/oauth/authorize");
		});
	});

	describe("isTokenExpired", () => {
		it("should return true if tokenExpiresAt is not set", () => {
			const config = {};
			expect(isTokenExpired(config)).toBe(true);
		});

		it("should return true if token is expired", () => {
			const config = {
				tokenExpiresAt: Math.floor(Date.now() / 1000) - 100,
			};
			expect(isTokenExpired(config)).toBe(true);
		});

		it("should return true if token expires within buffer period", () => {
			const config = {
				tokenExpiresAt: Math.floor(Date.now() / 1000) + 30, // 30 seconds, less than 60s buffer
			};
			expect(isTokenExpired(config)).toBe(true);
		});

		it("should return false if token is still valid", () => {
			const config = {
				tokenExpiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
			};
			expect(isTokenExpired(config)).toBe(false);
		});
	});

	describe("calculateTokenExpiresAt", () => {
		it("should calculate expiration timestamp", () => {
			const now = Math.floor(Date.now() / 1000);
			const expiresIn = 3600; // 1 hour

			const result = calculateTokenExpiresAt(expiresIn);

			// Allow 1 second tolerance for test execution time
			expect(result).toBeGreaterThanOrEqual(now + expiresIn - 1);
			expect(result).toBeLessThanOrEqual(now + expiresIn + 1);
		});
	});
});
