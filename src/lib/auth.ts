import type { Config } from "../config.js";

const OAUTH_CLIENT_ID = "buttondown-cli";
const OAUTH_REDIRECT_URI = "http://localhost:9876/callback";
const TOKEN_EXPIRY_BUFFER_SECONDS = 60;

/**
 * Convert API base URL to dashboard URL for OAuth.
 * Handles two URL patterns:
 * - Production: api.buttondown.com -> buttondown.com (removes "api." subdomain)
 * - Local dev: URLs without "api." subdomain are used as-is (e.g., http://application.bd:8000)
 */
function getOAuthBaseUrl(baseUrl: string): string {
	if (baseUrl.includes("://api.")) {
		return baseUrl.replace("://api.", "://");
	}
	// For custom domains or local development, use the base URL as-is
	return baseUrl;
}

export function getAuthorizeUrl(state: string, baseUrl: string): string {
	const dashboardUrl = getOAuthBaseUrl(baseUrl);
	const params = new URLSearchParams({
		client_id: OAUTH_CLIENT_ID,
		redirect_uri: OAUTH_REDIRECT_URI,
		response_type: "code",
		state,
	});
	return `${dashboardUrl}/oauth/authorize?${params.toString()}`;
}

export function isTokenExpired(config: Config): boolean {
	if (!config.tokenExpiresAt) {
		return true;
	}
	const now = Math.floor(Date.now() / 1000);
	return now >= config.tokenExpiresAt - TOKEN_EXPIRY_BUFFER_SECONDS;
}

export async function exchangeCodeForTokens(
	code: string,
	baseUrl: string,
): Promise<{
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
}> {
	const dashboardUrl = getOAuthBaseUrl(baseUrl);
	const tokenUrl = `${dashboardUrl}/oauth/token`;

	let response: Response;
	try {
		response = await fetch(tokenUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				client_id: OAUTH_CLIENT_ID,
				grant_type: "authorization_code",
				code,
				redirect_uri: OAUTH_REDIRECT_URI,
			}),
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to connect to ${tokenUrl}: ${message}`);
	}

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Failed to exchange code for tokens: ${text}`);
	}

	const data = await response.json();
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresIn: data.expires_in,
	};
}

export async function refreshAccessToken(
	refreshToken: string,
	baseUrl: string,
): Promise<{
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
}> {
	const dashboardUrl = getOAuthBaseUrl(baseUrl);
	const response = await fetch(`${dashboardUrl}/oauth/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			client_id: OAUTH_CLIENT_ID,
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Failed to refresh token: ${text}`);
	}

	const data = await response.json();
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresIn: data.expires_in,
	};
}

export function calculateTokenExpiresAt(expiresIn: number): number {
	return Math.floor(Date.now() / 1000) + expiresIn;
}
