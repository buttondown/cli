import { Box, Text, useApp } from "ink";
import { useEffect, useReducer } from "react";
import type { DryRunResult, ProgressEvent } from "../sync/orchestrate.js";
import type { OperationResult } from "../sync/types.js";
import { errorMessage } from "../sync/util.js";

export type Stats = { [resource: string]: OperationResult };

export type SyncState =
	| { status: "not_started" }
	| { status: "running"; stats: Stats; warnings: string[] }
	| { status: "done"; stats: Stats; warnings: string[] }
	| { status: "dry_run"; changes: DryRunResult[]; warnings: string[] }
	| { status: "error"; error: string };

type SyncAction = ProgressEvent | { type: "error"; error: string };

const reducer = (state: SyncState, action: SyncAction): SyncState => {
	switch (action.type) {
		case "start":
			return { status: "running", stats: {}, warnings: [] };
		case "resource":
			if (state.status !== "running") {
				throw new Error("Cannot register a resource result while not running");
			}
			return {
				...state,
				stats: { ...state.stats, [action.resource]: action.result },
			};
		case "warning":
			if (state.status !== "running") {
				return state;
			}
			return { ...state, warnings: [...state.warnings, action.message] };
		case "finish":
			if (state.status !== "running") {
				throw new Error("Cannot finish while not running");
			}
			return { ...state, status: "done" };
		case "dry_run_complete":
			return {
				status: "dry_run",
				changes: action.changes,
				warnings: state.status === "running" ? state.warnings : [],
			};
		case "error":
			return { status: "error", error: action.error };
	}
};

export const hasFailures = (stats: Stats): boolean =>
	Object.values(stats).some((result) => result.failed > 0);

/**
 * Exits the Ink app shortly after the command settles, non-zero when it
 * failed. The delay lets the final frame render before teardown.
 */
export function useExitWhenSettled(settled: boolean, failed: boolean) {
	const { exit } = useApp();
	useEffect(() => {
		if (!settled) return;
		if (failed) {
			process.exitCode = 1;
		}
		const timer = setTimeout(() => {
			exit();
		}, 500);
		return () => {
			clearTimeout(timer);
		};
	}, [settled, failed, exit]);
}

/**
 * Drives a pull/push generator: progress events feed the shared reducer, and
 * the app exits (with the right code) once the run settles. `deps` guards the
 * effect the same way the caller's generator inputs would.
 */
export function useSyncCommand(
	run: () => AsyncGenerator<ProgressEvent>,
	deps: unknown[],
): SyncState {
	const [state, dispatch] = useReducer(reducer, { status: "not_started" });

	useEffect(() => {
		const perform = async () => {
			try {
				for await (const event of run()) {
					dispatch(event);
				}
			} catch (error) {
				dispatch({ type: "error", error: errorMessage(error) });
			}
		};

		perform();
	}, deps);

	useExitWhenSettled(
		state.status === "done" ||
			state.status === "dry_run" ||
			state.status === "error",
		state.status === "error" ||
			(state.status === "done" && hasFailures(state.stats)),
	);

	return state;
}

export function Warnings({ warnings }: { warnings: string[] }) {
	return (
		<>
			{warnings.map((warning) => (
				<Box key={warning}>
					<Text color="yellow">Warning: {warning}</Text>
				</Box>
			))}
		</>
	);
}

export function ResourceResults({ stats }: { stats: Stats }) {
	return (
		<>
			{Object.entries(stats).map(([resource, result]) => (
				<Box key={resource} flexDirection="column">
					<Text color={result.failed > 0 ? "yellow" : "green"}>
						{`${resource}: ${result.updated} updated, ${result.created} created, ${result.deleted} deleted, ${result.failed} failed`}
					</Text>
					{result.errors.map((error) => (
						<Text key={error} color="red">{`  ${error}`}</Text>
					))}
				</Box>
			))}
		</>
	);
}
