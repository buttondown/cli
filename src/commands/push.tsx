import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useReducer } from "react";
import { type Configuration, RESOURCES } from "../sync/index.js";
import type { OperationResult } from "../sync/types.js";

type PushProps = {
	directory: string;
	baseUrl: string;
	apiKey?: string;
	accessToken?: string;
};

type State =
	| { status: "not_started" }
	| { status: "pushing"; stats: Record<string, OperationResult> }
	| { status: "pushed"; stats: Record<string, OperationResult> }
	| { status: "error"; error: string };

type Action =
	| { type: "start_pushing" }
	| { type: "register_push"; resource: string; result: OperationResult }
	| { type: "finish_pushing" }
	| { type: "register_error"; error: string };

const reducer = (state: State, action: Action): State => {
	switch (action.type) {
		case "start_pushing":
			return { status: "pushing", stats: {} };
		case "register_push":
			if (state.status !== "pushing") {
				return state;
			}
			return {
				status: "pushing",
				stats: { ...state.stats, [action.resource]: action.result },
			};
		case "finish_pushing":
			if (state.status !== "pushing") {
				return state;
			}
			return { status: "pushed", stats: state.stats };
		case "register_error":
			return { status: "error", error: action.error };
	}
};

export default function Push({
	directory,
	baseUrl,
	apiKey,
	accessToken,
}: PushProps) {
	const { exit } = useApp();
	const [state, dispatch] = useReducer(reducer, { status: "not_started" });

	useEffect(() => {
		const performPush = async () => {
			dispatch({ type: "start_pushing" });

			const configuration: Configuration = {
				directory,
				baseUrl,
				apiKey,
				accessToken,
			};

			try {
				for (const resource of RESOURCES) {
					const data = await resource.local.get(configuration);
					if (data) {
						const result = await resource.remote.set(
							data as any,
							configuration,
						);
						dispatch({
							type: "register_push",
							resource: resource.name,
							result,
						});
					}
				}
				dispatch({ type: "finish_pushing" });
			} catch (error) {
				dispatch({
					type: "register_error",
					error: error instanceof Error ? error.message : String(error),
				});
			}
		};

		performPush();
	}, [directory, baseUrl, apiKey, accessToken]);

	useEffect(() => {
		if (state.status === "pushed" || state.status === "error") {
			const timer = setTimeout(() => {
				exit();
			}, 500);
			return () => clearTimeout(timer);
		}
	}, [state.status, exit]);

	if (state.status === "error") {
		return (
			<Box flexDirection="column">
				<Text color="red">✗ Error: {state.error}</Text>
			</Box>
		);
	}

	if (state.status === "pushing") {
		return (
			<Box flexDirection="column">
				<Box>
					<Text color="blue">
						<Spinner type="dots" />
					</Text>
					<Text> Pushing to Buttondown...</Text>
				</Box>
				{Object.entries(state.stats).map(([resource, result]) => (
					<Box key={resource} marginLeft={2}>
						<Text color="green">
							✓ {resource}: {result.updates} updates, {result.creations}{" "}
							creations, {result.noops} no-ops, {result.deletions} deletions
						</Text>
					</Box>
				))}
			</Box>
		);
	}

	if (state.status === "pushed") {
		return (
			<Box flexDirection="column">
				<Text color="green">✓ Push complete!</Text>
				{Object.entries(state.stats).map(([resource, result]) => (
					<Box key={resource} marginLeft={2}>
						<Text>
							{resource}: {result.updates} updates, {result.creations}{" "}
							creations, {result.noops} no-ops, {result.deletions} deletions
						</Text>
					</Box>
				))}
			</Box>
		);
	}

	return (
		<Box>
			<Text>Initializing...</Text>
		</Box>
	);
}
