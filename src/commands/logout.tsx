import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { performLogout } from "./auth.js";

type State = "not_started" | "logged_out";

export default function Logout() {
	const [state, setState] = useState<State>("not_started");

	useEffect(() => {
		performLogout();
		setState("logged_out");
	}, []);

	return (
		<Box flexDirection="column">
			{state === "not_started" && <Text>Logging out...</Text>}
			{state === "logged_out" && <Text>Logged out.</Text>}
		</Box>
	);
}
