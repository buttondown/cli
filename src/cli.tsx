#!/usr/bin/env node
import { render } from "ink";
import meow from "meow";
import Create from "./commands/create.js";
import Login from "./commands/login.js";
import Logout from "./commands/logout.js";
import Pull from "./commands/pull.js";
import Push from "./commands/push.js";
import createConfig from "./config.js";
import {
	calculateTokenExpiresAt,
	isTokenExpired,
	refreshAccessToken,
} from "./lib/auth.js";

const cli = meow(
	`
  Usage
    $ buttondown <command> [options]

  Commands
    login           Log in to Buttondown (opens browser for OAuth)
    logout          Clear stored credentials
    pull            Download emails, media, and settings from Buttondown
    push            Upload local changes to Buttondown
    create          Create a new draft email locally

  Authentication
    By default, 'login' opens your browser to authenticate via OAuth.
    For CI/automation, use --api-key to authenticate with an API key instead.

  Options
    --api-key, -k   Use API key authentication (skips browser OAuth)
    --base-url, -b  API base URL (default: https://api.buttondown.com)
    --directory, -d Content directory (default: ./buttondown)
    --force, -f     Force re-login or overwrite existing content
    --title, -t     Title for new email (used with 'create')
    --help          Show this help message
    --version       Show version number

  Examples
    $ buttondown login                        # OAuth login via browser
    $ buttondown login --api-key=sk_xxx       # API key login for CI
    $ buttondown pull                         # Download your newsletter
    $ buttondown push                         # Upload local changes
    $ buttondown create --title="Hello World" # Create a new draft
`,
	{
		importMeta: import.meta,
		flags: {
			apiKey: {
				type: "string",
				shortFlag: "k",
			},
			baseUrl: {
				type: "string",
				shortFlag: "b",
				default: "https://api.buttondown.com",
			},
			directory: {
				type: "string",
				shortFlag: "d",
				default: "./buttondown",
			},
			force: {
				type: "boolean",
				shortFlag: "f",
				default: false,
			},
			title: {
				type: "string",
				shortFlag: "t",
			},
			help: {
				type: "boolean",
				shortFlag: "h",
			},
			version: {
				type: "boolean",
			},
		},
	},
);

const [command] = cli.input;

if (!command && !cli.flags.help && !cli.flags.version) {
	cli.showHelp();
	process.exit(0);
}

// Helper to get auth credentials from config or flags
async function getAuthCredentials(): Promise<{
	apiKey?: string;
	accessToken?: string;
	baseUrl: string;
}> {
	const config = createConfig();
	const baseUrl = cli.flags.baseUrl;

	// If --api-key flag is provided, use it
	if (cli.flags.apiKey) {
		return { apiKey: cli.flags.apiKey, baseUrl };
	}

	// Check for stored credentials
	const storedApiKey = config.get("apiKey");
	const storedAccessToken = config.get("accessToken");
	const storedRefreshToken = config.get("refreshToken");

	if (storedApiKey) {
		return { apiKey: storedApiKey, baseUrl };
	}

	if (storedAccessToken && storedRefreshToken) {
		// Check if token needs refresh
		if (isTokenExpired(config.store)) {
			try {
				const tokens = await refreshAccessToken(storedRefreshToken, baseUrl);
				config.set("accessToken", tokens.accessToken);
				config.set("refreshToken", tokens.refreshToken);
				config.set("tokenExpiresAt", calculateTokenExpiresAt(tokens.expiresIn));
				return { accessToken: tokens.accessToken, baseUrl };
			} catch {
				// Token refresh failed, user needs to re-login
				console.error("Session expired. Please run: buttondown login");
				process.exit(1);
			}
		}
		return { accessToken: storedAccessToken, baseUrl };
	}

	return { baseUrl };
}

switch (command) {
	case "login": {
		render(
			<Login
				apiKey={cli.flags.apiKey}
				force={cli.flags.force}
				baseUrl={cli.flags.baseUrl}
			/>,
		);
		break;
	}

	case "logout": {
		render(<Logout />);
		break;
	}

	case "pull": {
		const auth = await getAuthCredentials();
		if (!auth.apiKey && !auth.accessToken) {
			console.error("Not logged in. Please run: buttondown login");
			process.exit(1);
		}
		render(
			<Pull
				directory={cli.flags.directory}
				baseUrl={auth.baseUrl}
				apiKey={auth.apiKey}
				accessToken={auth.accessToken}
			/>,
		);
		break;
	}

	case "push": {
		const auth = await getAuthCredentials();
		if (!auth.apiKey && !auth.accessToken) {
			console.error("Not logged in. Please run: buttondown login");
			process.exit(1);
		}
		render(
			<Push
				directory={cli.flags.directory}
				baseUrl={auth.baseUrl}
				apiKey={auth.apiKey}
				accessToken={auth.accessToken}
			/>,
		);
		break;
	}

	case "create": {
		if (!cli.flags.title) {
			console.error("Error: --title is required for the create command");
			process.exit(1);
		}

		render(<Create directory={cli.flags.directory} title={cli.flags.title} />);
		break;
	}

	default: {
		if (command) {
			console.error(`Unknown command: ${command}`);
			cli.showHelp();
			process.exit(1);
		}
	}
}
