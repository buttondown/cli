import { Box, Text, useApp } from "ink";
import path from "node:path";
import { useEffect, useReducer } from "react";
import {
	BASE_RESOURCES,
	type Configuration,
	findRelativeImageReferences,
	LOCAL_EMAILS_RESOURCE,
	readSyncState,
	REMOTE_EMAILS_RESOURCE,
	resolveRelativeImageReferences,
	uploadImage,
	writeSyncState,
} from "../sync/index.js";
import type { SyncedImage } from "../sync/state.js";
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
			dispatch({ type: "start_pushing" });
			try {
				// 1. Read sync state
				const syncState = await readSyncState(configuration.directory);
				const syncedImages = { ...syncState.syncedImages };

				// 2. Read local emails and find relative image references
				const localEmails = await LOCAL_EMAILS_RESOURCE.get(configuration);
				const emailsDir = path.join(configuration.directory, "emails");

				if (localEmails) {
					// 3. Collect all referenced images, upload new ones
					for (const email of localEmails) {
						if (!email.body) continue;
						const refs = findRelativeImageReferences(email.body);
						for (const ref of refs) {
							const absolutePath = path.resolve(emailsDir, ref.relativePath);
							const alreadySynced = Object.values(syncedImages).find(
								(img) => img.localPath === absolutePath,
							);
							if (!alreadySynced) {
								const result = await uploadImage(configuration, absolutePath);
								syncedImages[result.id] = {
									id: result.id,
									localPath: absolutePath,
									url: result.url,
									filename: result.filename,
								};
							}
						}
					}

					// 4. Replace relative paths with absolute URLs
					const imageMap = Object.fromEntries(
						Object.entries(syncedImages).map(([k, v]) => [
							k,
							{ localPath: v.localPath, url: v.url },
						]),
					);

					const resolvedEmails = localEmails.map((email) => ({
						...email,
						body: email.body
							? resolveRelativeImageReferences(email.body, emailsDir, imageMap)
							: email.body,
					}));

					// 5. Push resolved emails
					const emailResult = await REMOTE_EMAILS_RESOURCE.set(
						resolvedEmails,
						configuration,
					);
					dispatch({
						type: "register_new_push",
						resource: "emails",
						result: emailResult,
					});
				}

				// 6. Push remaining base resources
				for (const resource of BASE_RESOURCES) {
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

				// 7. Write updated sync state
				await writeSyncState(configuration.directory, { syncedImages });

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
