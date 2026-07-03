#!/usr/bin/env node
import { render } from "ink";
import meow from "meow";
import Create from "./commands/create.js";
import {
	runCreateJson,
	runLoginJson,
	runLogoutJson,
	runPullJson,
	runPushJson,
} from "./commands/json-runners.js";
import Login from "./commands/login.js";
import Logout from "./commands/logout.js";
import Pull from "./commands/pull.js";
import Push from "./commands/push.js";
import createConfig from "./config.js";

const COMMAND_HELP: Record<string, string> = {
	login: `
  Usage
    $ buttondown login [options]

  Options
    --api-key, -k   Your Buttondown API key
    --force, -f     Overwrite existing credentials
    --json          Output result as JSON (requires --api-key)

  Examples
    $ buttondown login --api-key=btn_abc123
    $ buttondown login --api-key=btn_abc123 --force
    $ buttondown login
`,
	logout: `
  Usage
    $ buttondown logout [options]

  Options
    --json          Output result as JSON

  Examples
    $ buttondown logout
`,
	pull: `
  Usage
    $ buttondown pull [options]

  Options
    --api-key, -k   Your Buttondown API key (or run 'buttondown login' first)
    --directory, -d  Directory to save content (default: ./buttondown)
    --base-url, -b   API base URL (default: https://api.buttondown.com/v1)
    --json           Output result as JSON

  Examples
    $ buttondown pull
    $ buttondown pull --directory=./my-newsletter
    $ buttondown pull --api-key=btn_abc123 --directory=./content
`,
	push: `
  Usage
    $ buttondown push [options]

  Options
    --api-key, -k   Your Buttondown API key (or run 'buttondown login' first)
    --directory, -d  Directory to read content from (default: ./buttondown)
    --base-url, -b   API base URL (default: https://api.buttondown.com/v1)
    --dry-run        Preview changes without uploading
    --json           Output result as JSON

  Examples
    $ buttondown push
    $ buttondown push --directory=./my-newsletter
    $ buttondown push --dry-run
    $ buttondown push --api-key=btn_abc123 --dry-run --json
`,
	create: `
  Usage
    $ buttondown create [options]

  Options
    --title, -t      Title for the new email (required)
    --directory, -d  Directory to create email in (default: ./buttondown)
    --json           Output result as JSON

  Examples
    $ buttondown create --title="Weekly Update"
    $ buttondown create --title="Launch Announcement" --directory=./my-newsletter
`,
};

const cli = meow(
	`
  Usage
    $ buttondown <command> [options]

  Commands
    login           Configure your Buttondown API key
    logout          Clear stored credentials
    pull            Download emails and media from Buttondown
    push            Upload local emails and media to Buttondown
    create          Create a new draft email locally

  Options
    --api-key, -k   Your Buttondown API key (for login)
    --base-url, -b  Your Buttondown API base URL (default: https://api.buttondown.com/v1)
    --directory, -d Directory to store or read Buttondown content (default: ./buttondown)
    --dry-run       Preview changes without uploading (push only)
    --force, -f     Overwrite existing credentials (login only)
    --json          Output result as JSON (machine-readable)
    --title, -t     Title for new email (with create command)
    --help          Show this help message
    --version       Show the version number

  Examples
    $ buttondown login --api-key=btn_abc123
    $ buttondown pull --directory=./my-newsletter
    $ buttondown push --dry-run
    $ buttondown push --directory=./my-newsletter --json
    $ buttondown create --title="My New Newsletter"

  Run 'buttondown <command> --help' for details on a specific command.
`,
	{
		importMeta: import.meta,
		// A typo'd flag must fail loudly: silently ignoring e.g. --dryrun would
		// run a real, mutating push.
		allowUnknownFlags: false,
		flags: {
			apiKey: {
				type: "string",
				shortFlag: "k",
			},
			baseUrl: {
				type: "string",
				shortFlag: "b",
				default: "https://api.buttondown.com/v1",
			},
			directory: {
				type: "string",
				shortFlag: "d",
				default: "./buttondown",
			},
			dryRun: {
				type: "boolean",
				default: false,
			},
			force: {
				type: "boolean",
				shortFlag: "f",
				default: false,
			},
			json: {
				type: "boolean",
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

// Per-command --help
if (cli.flags.help && command && COMMAND_HELP[command]) {
	console.log(COMMAND_HELP[command]);
	process.exit(0);
}

if (!command && !cli.flags.help && !cli.flags.version) {
	cli.showHelp();
	process.exit(0);
}

const resolveApiKey = (commandName: string): string => {
	const config = createConfig();
	const apiKey = cli.flags.apiKey ?? config.get("apiKey");
	if (!apiKey) {
		console.error(
			`Error: No API key specified.
  buttondown ${commandName} --api-key <your-api-key>
  Or run 'buttondown login --api-key <your-api-key>' first.`,
		);
		process.exit(1);
	}
	return apiKey;
};

switch (command) {
	case "login": {
		if (cli.flags.json) {
			await runLoginJson(cli.flags.apiKey, {
				force: cli.flags.force,
				baseUrl: cli.flags.baseUrl,
			});
			break;
		}
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
		if (cli.flags.json) {
			runLogoutJson();
			break;
		}
		render(<Logout />);
		break;
	}

	case "pull": {
		const configuration = {
			directory: cli.flags.directory,
			baseUrl: cli.flags.baseUrl,
			apiKey: resolveApiKey("pull"),
			username: createConfig().get("username"),
		};
		if (cli.flags.json) {
			await runPullJson(configuration);
			break;
		}
		render(<Pull {...configuration} />);
		break;
	}

	case "push": {
		const configuration = {
			directory: cli.flags.directory,
			baseUrl: cli.flags.baseUrl,
			apiKey: resolveApiKey("push"),
			username: createConfig().get("username"),
			dryRun: cli.flags.dryRun,
		};
		if (cli.flags.json) {
			await runPushJson(configuration);
			break;
		}
		render(<Push {...configuration} />);
		break;
	}

	case "create": {
		if (!cli.flags.title) {
			console.error(
				`Error: No title specified.
  buttondown create --title "My New Email"
  buttondown create --title "Launch Announcement" --directory ./my-newsletter`,
			);
			process.exit(1);
		}

		if (cli.flags.json) {
			await runCreateJson(cli.flags.directory, cli.flags.title);
			break;
		}
		render(<Create directory={cli.flags.directory} title={cli.flags.title} />);
		break;
	}

	default: {
		if (command) {
			console.error(
				`Unknown command: ${command}\n  Run 'buttondown --help' for available commands.`,
			);
			process.exit(1);
		}
	}
}
