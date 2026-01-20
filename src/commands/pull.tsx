import { Box, Text, useApp } from "ink";
import { useEffect, useReducer } from "react";
import { type Configuration, RESOURCES } from "../sync/index.js";
import type { OperationResult } from "../sync/types.js";

type State =
	| {
			status: "not_started";
	  }
	| {
			status: "pulling";
			stats: {
				[resource: string]: OperationResult;
			};
	  }
	| {
			status: "pulled";
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
			type: "start_pulling";
	  }
	| {
			type: "register_new_pull";
			resource: string;
			result: OperationResult;
	  }
	| {
			type: "finish_pulling";
	  }
	| {
			type: "register_error";
			error: string;
	  };

const reducer = (state: State, action: Action): State => {
	switch (action.type) {
		case "start_pulling":
			return { status: "pulling", stats: {} };
		case "register_new_pull":
			if (state.status !== "pulling") {
				throw new Error("Cannot register new pull if not pulling");
			}
			return {
				status: "pulling",
				stats: { ...state.stats, [action.resource]: action.result },
			};
		case "finish_pulling":
			if (state.status !== "pulling") {
				throw new Error("Cannot finish pulling if not pulling");
			}
			return { status: "pulled", stats: { ...state.stats } };
		case "register_error":
			return { status: "error", error: action.error };
	}
};

export default function Pull(configuration: Configuration) {
	const { exit } = useApp();
	const [state, dispatch] = useReducer(reducer, {
		status: "not_started",
	});

	useEffect(() => {
		const performPull = async () => {
			try {
				for (const resource of RESOURCES) {
					const data = await resource.remote.get(configuration);
					if (data) {
						const output = await resource.local.set(data as any, configuration);
						dispatch({
							type: "register_new_pull",
							resource: resource.name,
							result: output,
						});
					}
				}
				dispatch({
					type: "finish_pulling",
				});
			} catch (error_) {
				dispatch({
					type: "register_error",
					error: error_ instanceof Error ? error_.message : String(error_),
				});
			}
		};

		performPull();
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

					{state.status === "pulling" && (
						<>
							{Object.entries(state.stats).map(([resource, result]) => (
								<Box key={resource}>
									<Text color="green">{`${resource} pulled: ${result.updated} updated, ${result.created} created, ${result.deleted} deleted, ${result.failed} failed`}</Text>
								</Box>
							))}
							<Box marginTop={1}>
								<Text>All content saved to: {configuration.directory}</Text>
							</Box>
						</>
					)}
				</>
			)}
		</Box>
	);
}
