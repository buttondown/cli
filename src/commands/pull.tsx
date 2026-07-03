import { Box, Text } from "ink";
import type { Configuration } from "../sync/index.js";
import { pull } from "../sync/orchestrate.js";
import { ResourceResults, useSyncCommand, Warnings } from "./sync-command.js";

export default function Pull(configuration: Configuration) {
	const state = useSyncCommand(() => pull(configuration), [configuration]);

	return (
		<Box flexDirection="column">
			{state.status === "error" ? (
				<Text color="red">Error: {state.error}</Text>
			) : state.status === "done" ? (
				<>
					<Warnings warnings={state.warnings} />
					<ResourceResults stats={state.stats} />
					<Box marginTop={1}>
						<Text>directory: {configuration.directory}</Text>
					</Box>
				</>
			) : state.status === "running" ? (
				<Text color="blue">Pulling...</Text>
			) : null}
		</Box>
	);
}
