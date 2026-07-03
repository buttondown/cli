import { Box, Text } from "ink";
import type { Configuration } from "../sync/index.js";
import { push } from "../sync/orchestrate.js";
import { ResourceResults, useSyncCommand, Warnings } from "./sync-command.js";

type PushProps = Configuration & { dryRun?: boolean };

export default function Push(configuration: PushProps) {
	const state = useSyncCommand(() => push(configuration), [configuration]);

	const warnings =
		state.status === "running" ||
		state.status === "done" ||
		state.status === "dry_run"
			? state.warnings
			: [];

	return (
		<Box flexDirection="column">
			<Warnings warnings={warnings} />
			{state.status === "error" ? (
				<Text color="red">Error: {state.error}</Text>
			) : state.status === "dry_run" ? (
				<>
					{state.changes.length === 0 ? (
						<Text>No changes to push.</Text>
					) : (
						<>
							<Text>Would push the following changes:</Text>
							{state.changes.map(({ resource, count }) => (
								<Box key={resource}>
									<Text>{`  ${resource}: ${count} changed`}</Text>
								</Box>
							))}
						</>
					)}
					<Box marginTop={1}>
						<Text color="blue">No changes made.</Text>
					</Box>
				</>
			) : state.status === "done" ? (
				Object.keys(state.stats).length === 0 ? (
					<Text color="green">Everything up to date.</Text>
				) : (
					<ResourceResults stats={state.stats} />
				)
			) : state.status === "running" ? (
				<Text color="blue">Pushing...</Text>
			) : null}
		</Box>
	);
}
