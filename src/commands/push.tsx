import { Box, Text, useApp } from "ink";
import { useEffect, useReducer } from "react";
import { type Configuration, RESOURCES } from "../sync/index.js";
import type { OperationResult } from "../sync/types.js";

type State =
	| {
			status: "not_started";
	  }
	| {
			status: "pushing";
			stats: {
				[resource: string]: OperationResult;
			};
	  }
	| {
			status: "pushed";
			stats: {
				[resource: string]: OperationResult;
			};
	  }
	| {
			status: "error";
			error: string;
	  };

type Action =
	| {
			type: "start_pushing";
	  }
	| {
			type: "register_new_push";
			resource: string;
			result: OperationResult;
	  }
	| {
			type: "finish_pushing";
	  }
	| {
			type: "register_error";
			error: string;
	  };

const reducer = (state: State, action: Action): State => {
	switch (action.type) {
		case "start_pushing":
			return { status: "pushing", stats: {} };
		case "register_new_push":
			if (state.status !== "pushing") {
				throw new Error("Cannot register new push if not pushing");
			}
			return {
				status: "pushing",
				stats: { ...state.stats, [action.resource]: action.result },
			};
		case "finish_pushing":
			if (state.status !== "pushing") {
				throw new Error("Cannot finish pushing if not pushing");
			}
			return { status: "pushed", stats: { ...state.stats } };
		case "register_error":
			return { status: "error", error: action.error };
	}
};

export default function Push(configuration: Configuration) {
	const { exit } = useApp();
	const [state, dispatch] = useReducer(reducer, {
		status: "not_started",
	});

	useEffect(() => {
		const performPush = async () => {
			try {
				for (const resource of RESOURCES) {
					const data = await resource.local.get(configuration);
					if (data) {
						const output = await resource.remote.set(
							data as any,
							configuration,
						);
						dispatch({
							type: "register_new_push",
							resource: resource.name,
							result: output,
						});
					}
				}

				dispatch({
					type: "finish_pushing",
				});
			} catch (error_) {
				dispatch({
					type: "register_error",
					error: error_ instanceof Error ? error_.message : String(error_),
				});
			}
		};

		performPush();
	}, [configuration]);

	useEffect(() => {
		if (state.status !== "not_started") {
			const timer = setTimeout(() => {
				exit();
			}, 500);
			return () => {
				clearTimeout(timer);
			};
		}
	}, [state.status, exit]);

	return (
		<Box flexDirection="column">
			{state.status === "error" ? (
				<Text color="red">Error: {state.error}</Text>
			) : (
				<>
					<Text color="blue">{state.status}</Text>

					{state.status === "pushing" &&
						Object.entries(state.stats).map(([resource, result]) => (
							<Box key={resource}>
								<Text color="green">{`${resource} pushed: ${result.updated} updated, ${result.created} created, ${result.deleted} deleted, ${result.failed} failed`}</Text>
							</Box>
						))}
				</>
			)}
		</Box>
	);
}
