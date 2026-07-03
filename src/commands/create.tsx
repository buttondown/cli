import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { errorMessage } from "../sync/util.js";
import { createDraft } from "./create-draft.js";
import { useExitWhenSettled } from "./sync-command.js";

type CreateProps = {
	directory: string;
	title: string;
};

export default function Create({ directory, title }: CreateProps) {
	const [status, setStatus] = useState<string>("Creating new draft email...");
	const [error, setError] = useState<string | null>(null);
	const [created, setCreated] = useState<boolean>(false);

	useEffect(() => {
		const run = async () => {
			try {
				const { filePath } = await createDraft(directory, title);
				setStatus(`Created new draft email: ${filePath}`);
				setCreated(true);
			} catch (error_) {
				setError(errorMessage(error_));
			}
		};

		run();
	}, [directory, title]);

	useExitWhenSettled(created || error !== null, error !== null);

	return (
		<Box flexDirection="column">
			{error ? (
				<Text color="red">Error: {error}</Text>
			) : (
				<Text color="green">{status}</Text>
			)}
		</Box>
	);
}
