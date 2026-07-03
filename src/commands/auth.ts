import createConfig from "../config.js";
import { constructClient, throwIfError } from "../sync/types.js";

export type LoginResult =
	| { status: "logged_in" }
	| { status: "already_logged_in" };

/**
 * Validates the key against the API before storing it, so a typo'd key
 * fails at login time instead of producing mysterious failures later. The
 * key is trimmed (pasted keys routinely pick up whitespace) and existing
 * credentials are only overwritten when `force` is set.
 */
export async function performLogin(
	apiKey: string,
	options: { force?: boolean; baseUrl: string },
): Promise<LoginResult> {
	const config = createConfig();
	const trimmedKey = apiKey.trim();
	if (!trimmedKey) {
		throw new Error("API key cannot be empty");
	}
	if (config.get("apiKey") && !options.force) {
		return { status: "already_logged_in" };
	}

	const client = constructClient({
		apiKey: trimmedKey,
		baseUrl: options.baseUrl,
		directory: ".",
	});
	const response = await client.get("/newsletters");
	throwIfError(response, "API key validation failed");

	config.set("apiKey", trimmedKey);
	const username = response.data?.results?.[0]?.username;
	if (username) {
		config.set("username", username);
	}
	return { status: "logged_in" };
}

export function performLogout(): void {
	createConfig().clear();
}
