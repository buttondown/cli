import { Box, Text, useApp } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useState } from "react";
import createConfig from "../config.js";
import { errorMessage } from "../sync/util.js";
import { type LoginResult, performLogin } from "./auth.js";

type LoginState =
	| { status: "idle" }
	| { status: "validating" }
	| { status: "done"; result: LoginResult }
	| { status: "error"; error: string };

export default function Login({
	apiKey: initialApiKey,
	force,
	baseUrl,
}: {
	apiKey?: string;
	force?: boolean;
	baseUrl: string;
}) {
	// Non-interactive when --api-key is passed; interactive prompt otherwise.
	if (initialApiKey !== undefined) {
		return (
			<LoginRunner apiKey={initialApiKey} force={force} baseUrl={baseUrl} />
		);
	}
	if (!force && createConfig().get("apiKey")) {
		return <AlreadyLoggedIn />;
	}
	return <LoginInteractive force={force} baseUrl={baseUrl} />;
}

function AlreadyLoggedIn() {
	const { exit } = useApp();
	useEffect(() => {
		const timer = setTimeout(() => exit(), 100);
		return () => clearTimeout(timer);
	}, [exit]);
	return (
		<LoginStatus
			state={{ status: "done", result: { status: "already_logged_in" } }}
		/>
	);
}

function LoginRunner({
	apiKey,
	force,
	baseUrl,
}: {
	apiKey: string;
	force?: boolean;
	baseUrl: string;
}) {
	const { exit } = useApp();
	const [state, setState] = useState<LoginState>({ status: "validating" });

	useEffect(() => {
		const run = async () => {
			try {
				const result = await performLogin(apiKey, { force, baseUrl });
				setState({ status: "done", result });
			} catch (error) {
				setState({ status: "error", error: errorMessage(error) });
			}
		};
		run();
	}, [apiKey, force, baseUrl]);

	useEffect(() => {
		if (state.status === "done" || state.status === "error") {
			if (
				state.status === "error" ||
				(state.status === "done" && state.result.status === "already_logged_in")
			) {
				process.exitCode = 1;
			}
			const timer = setTimeout(() => exit(), 100);
			return () => clearTimeout(timer);
		}
	}, [state, exit]);

	return <LoginStatus state={state} />;
}

function LoginInteractive({
	force,
	baseUrl,
}: {
	force?: boolean;
	baseUrl: string;
}) {
	const { exit } = useApp();
	const [apiKey, setApiKey] = useState<string>("");
	const [state, setState] = useState<LoginState>({ status: "idle" });

	const handleSubmit = async () => {
		setState({ status: "validating" });
		try {
			const result = await performLogin(apiKey, { force, baseUrl });
			setState({ status: "done", result });
		} catch (error) {
			setState({ status: "error", error: errorMessage(error) });
		}
	};

	useEffect(() => {
		if (state.status === "done") {
			const timer = setTimeout(() => exit(), 100);
			return () => clearTimeout(timer);
		}
	}, [state, exit]);

	if (state.status === "idle" || state.status === "error") {
		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text>Please enter your Buttondown API key:</Text>
				</Box>
				<Box>
					<TextInput
						value={apiKey}
						onChange={setApiKey}
						onSubmit={handleSubmit}
						placeholder="Enter your API key..."
						showCursor
					/>
				</Box>
				{state.status === "error" && (
					<Box marginTop={1}>
						<Text color="red">{state.error}</Text>
					</Box>
				)}
			</Box>
		);
	}

	return <LoginStatus state={state} />;
}

function LoginStatus({ state }: { state: LoginState }) {
	if (state.status === "validating") {
		return <Text color="blue">Validating API key...</Text>;
	}
	if (state.status === "error") {
		return <Text color="red">Error: {state.error}</Text>;
	}
	if (state.status === "done") {
		if (state.result.status === "already_logged_in") {
			return (
				<Box flexDirection="column">
					<Text color="green">Already logged in.</Text>
					<Box marginTop={1}>
						<Text>To use a different API key, run: </Text>
						<Text color="cyan">buttondown login --force</Text>
					</Box>
				</Box>
			);
		}
		return <Text color="green">Logged in.</Text>;
	}
	return null;
}
