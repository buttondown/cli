import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import createConfig from "../config.js";

type State = "not_started" | "logging_out" | "logged_out";

export default function Logout() {
	const config = createConfig();
	const [state, setState] = useState<State>("not_started");

	useEffect(() => {
		setState("logging_out");
		config.clear();
		setState("logged_out");
	}, []);

	return (
		<Box flexDirection="column">
			{state === "not_started" && <Text>Logging out...</Text>}
			{state === "logging_out" && <Text>Logging out...</Text>}
			{state === "logged_out" && <Text>Logged out!</Text>}
		</Box>
	);
}
