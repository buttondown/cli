#!/usr/bin/env node
import { render } from "ink";
import meow from "meow";
import Create from "./commands/create.js";
import Login from "./commands/login.js";
import Logout from "./commands/logout.js";
import Pull from "./commands/pull.js";
import Push from "./commands/push.js";
import createConfig from "./config.js";

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
    --force, -f     Force operation without confirmation
    --title, -t     Title for new email (with create command)
    --verbose, -v   Verbose output
    --help          Show this help message
    --version       Show the version number

  Examples
    $ buttondown login --api-key=your-api-key
    $ buttondown pull --directory=./my-newsletter
    $ buttondown push --directory=./my-newsletter
    $ buttondown create --title="My New Newsletter" --directory=./my-newsletter
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
				default: "https://api.buttondown.com/v1",
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
			verbose: {
				type: "boolean",
				shortFlag: "v",
			},
			help: {
				type: "boolean",
				shortFlag: "h",
			},
			version: {
				type: "boolean",
				shortFlag: "v",
			},
		},
	},
);

const [command] = cli.input;

if (!command && !cli.flags.help && !cli.flags.version) {
	cli.showHelp();
	process.exit(0);
}

switch (command) {
	case "login": {
		render(<Login apiKey={cli.flags.apiKey} force={cli.flags.force} />);
		break;
	}

	case "logout": {
		render(<Logout />);
		break;
	}

	case "pull": {
		const config = createConfig();
		const apiKey = cli.flags.apiKey ?? config.get("apiKey");
		if (!apiKey) {
			console.error(
				"Error: --api-key is required for the pull command, or run 'buttondown login' first",
			);
			process.exit(1);
		}
		render(
			<Pull
				directory={cli.flags.directory}
				baseUrl={cli.flags.baseUrl}
				apiKey={apiKey}
			/>,
		);
		break;
	}

	case "push": {
		const config = createConfig();
		const apiKey = cli.flags.apiKey ?? config.get("apiKey");
		if (!apiKey) {
			console.error(
				"Error: --api-key is required for the push command, or run 'buttondown login' first",
			);
			process.exit(1);
		}
		render(
			<Push
				directory={cli.flags.directory}
				baseUrl={cli.flags.baseUrl}
				apiKey={apiKey}
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
