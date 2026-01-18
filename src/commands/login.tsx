import { createServer } from "node:http";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import open from "open";
import { useEffect, useMemo, useState } from "react";
import createConfig from "../config.js";
import {
	calculateTokenExpiresAt,
	exchangeCodeForTokens,
	getAuthorizeUrl,
} from "../lib/auth.js";

type LoginState =
	| { status: "idle" }
	| { status: "already_logged_in" }
	| { status: "api_key_input" }
	| { status: "waiting_for_browser"; authorizeUrl: string }
	| { status: "exchanging_code" }
	| { status: "success"; username?: string }
	| { status: "error"; message: string };

const DEFAULT_BASE_URL = "https://api.buttondown.com";

export default function Login({
	apiKey: initialApiKey,
	force,
	baseUrl = DEFAULT_BASE_URL,
}: {
	apiKey?: string;
	force?: boolean;
	baseUrl?: string;
}) {
	const config = useMemo(() => createConfig(), []);
	const { exit } = useApp();
	const existingApiKey = config.get("apiKey");
	const existingAccessToken = config.get("accessToken");

	const [state, setState] = useState<LoginState>(() => {
		// If --api-key flag provided, go straight to API key input mode
		if (initialApiKey) {
			return { status: "api_key_input" };
		}
		// If already logged in and not forcing, show message
		if ((existingApiKey || existingAccessToken) && !force) {
			return { status: "already_logged_in" };
		}
		// Start OAuth flow
		return { status: "idle" };
	});

	const [apiKey, setApiKey] = useState<string>(initialApiKey || "");

	// Handle OAuth flow - use a ref to track if we've started
	const [oauthStarted, setOauthStarted] = useState(false);

	useEffect(() => {
		// Only start OAuth flow if we're in idle state and haven't started yet
		if (state.status !== "idle" || oauthStarted) {
			return;
		}

		setOauthStarted(true);

		const oauthState = Math.random().toString(36).substring(2, 15);
		const authorizeUrl = getAuthorizeUrl(oauthState, baseUrl);
		let server: ReturnType<typeof createServer> | null = null;
		let serverClosed = false;

		const closeServer = () => {
			if (server && !serverClosed) {
				serverClosed = true;
				server.close();
			}
		};

		const startOAuthFlow = async () => {
			setState({ status: "waiting_for_browser", authorizeUrl });

			// Create a promise that resolves when we get the callback
			const codePromise = new Promise<string>((resolve, reject) => {
				server = createServer((req, res) => {
					const url = new URL(req.url || "", "http://localhost:9876");

					if (url.pathname === "/callback") {
						const code = url.searchParams.get("code");
						const returnedState = url.searchParams.get("state");
						const error = url.searchParams.get("error");

						if (error) {
							res.writeHead(200, { "Content-Type": "text/html" });
							res.end(
								"<html><body><h1>Authorization failed</h1><p>You can close this window.</p></body></html>",
							);
							reject(new Error(`OAuth error: ${error}`));
							return;
						}

						if (returnedState !== oauthState) {
							res.writeHead(200, { "Content-Type": "text/html" });
							res.end(
								"<html><body><h1>Invalid state</h1><p>Please try again.</p></body></html>",
							);
							reject(new Error("State mismatch"));
							return;
						}

						if (!code) {
							res.writeHead(200, { "Content-Type": "text/html" });
							res.end(
								"<html><body><h1>No code received</h1><p>Please try again.</p></body></html>",
							);
							reject(new Error("No authorization code received"));
							return;
						}

						res.writeHead(200, { "Content-Type": "text/html" });
						res.end(
							"<html><body><h1>Success!</h1><p>You can close this window and return to the terminal.</p></body></html>",
						);
						resolve(code);
					} else {
						res.writeHead(404);
						res.end();
					}
				});

				server.listen(9876, () => {
					open(authorizeUrl);
				});

				server.on("error", (err) => {
					reject(err);
				});
			});

			try {
				const code = await codePromise;
				setState({ status: "exchanging_code" });

				const tokens = await exchangeCodeForTokens(code, baseUrl);

				config.set("accessToken", tokens.accessToken);
				config.set("refreshToken", tokens.refreshToken);
				config.set("tokenExpiresAt", calculateTokenExpiresAt(tokens.expiresIn));
				config.set("baseUrl", baseUrl);
				// Clear old API key if present
				config.delete("apiKey");

				setState({ status: "success" });
			} catch (error) {
				setState({
					status: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			} finally {
				closeServer();
			}
		};

		startOAuthFlow();

		return () => {
			closeServer();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Exit after showing result
	useEffect(() => {
		if (
			state.status === "success" ||
			state.status === "error" ||
			state.status === "already_logged_in"
		) {
			const timer = setTimeout(() => {
				exit();
			}, 1000);
			return () => clearTimeout(timer);
		}
	}, [state.status, exit]);

	const handleApiKeySubmit = () => {
		if (!apiKey.trim()) {
			setState({ status: "error", message: "API key cannot be empty" });
			return;
		}

		config.set("apiKey", apiKey);
		config.set("baseUrl", baseUrl);
		// Clear OAuth tokens if present
		config.delete("accessToken");
		config.delete("refreshToken");
		config.delete("tokenExpiresAt");

		setState({ status: "success" });
	};

	if (state.status === "already_logged_in") {
		return (
			<Box flexDirection="column">
				<Text color="green">✓ You're already logged in!</Text>
				<Box marginTop={1}>
					<Text>To use a different account, run: </Text>
					<Text color="cyan">buttondown login --force</Text>
				</Box>
			</Box>
		);
	}

	if (state.status === "api_key_input") {
		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text>Please enter your Buttondown API key:</Text>
				</Box>
				<Box>
					<TextInput
						value={apiKey}
						onChange={setApiKey}
						onSubmit={handleApiKeySubmit}
						placeholder="Enter your API key..."
						showCursor
					/>
				</Box>
			</Box>
		);
	}

	if (state.status === "waiting_for_browser") {
		return (
			<Box flexDirection="column">
				<Box>
					<Text color="blue">
						<Spinner type="dots" />
					</Text>
					<Text> Opening browser for authentication...</Text>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>
						If the browser doesn't open, visit this URL manually:
					</Text>
				</Box>
				<Box marginLeft={2}>
					<Text color="cyan">{state.authorizeUrl}</Text>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>Waiting for authorization...</Text>
				</Box>
			</Box>
		);
	}

	if (state.status === "exchanging_code") {
		return (
			<Box>
				<Text color="blue">
					<Spinner type="dots" />
				</Text>
				<Text> Completing authentication...</Text>
			</Box>
		);
	}

	if (state.status === "success") {
		return (
			<Box flexDirection="column">
				<Text color="green">✓ Successfully logged in!</Text>
				<Box marginTop={1}>
					<Text>You can now use </Text>
					<Text color="cyan">buttondown pull</Text>
					<Text> and </Text>
					<Text color="cyan">buttondown push</Text>
					<Text> commands.</Text>
				</Box>
			</Box>
		);
	}

	if (state.status === "error") {
		return (
			<Box flexDirection="column">
				<Text color="red">✗ Login failed: {state.message}</Text>
				<Box marginTop={1}>
					<Text>Please try again or use </Text>
					<Text color="cyan">buttondown login --api-key YOUR_KEY</Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box>
			<Text>Initializing...</Text>
		</Box>
	);
}
