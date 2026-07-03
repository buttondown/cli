import { type ProgressEvent, pull, push } from "../sync/orchestrate.js";
import type { Configuration, OperationResult } from "../sync/types.js";
import { errorMessage } from "../sync/util.js";
import { performLogin, performLogout } from "./auth.js";
import { createDraft } from "./create-draft.js";

/**
 * --json output is emitted directly to stdout instead of through Ink: Ink
 * lays text out at the terminal width (80 columns when piped), which
 * hard-wraps JSON into an unparseable stream.
 */
const emit = (payload: unknown) => {
	console.log(JSON.stringify(payload));
};

async function runSyncJson(
	status: "pulled" | "pushed",
	events: AsyncGenerator<ProgressEvent>,
	directory: string,
): Promise<void> {
	const resources: Record<string, OperationResult> = {};
	const warnings: string[] = [];
	try {
		for await (const event of events) {
			if (event.type === "resource") resources[event.resource] = event.result;
			if (event.type === "warning") warnings.push(event.message);
			if (event.type === "dry_run_complete") {
				emit({ status: "dry_run", changes: event.changes, warnings });
				return;
			}
		}
	} catch (error) {
		emit({ status: "error", error: errorMessage(error) });
		process.exitCode = 1;
		return;
	}
	emit({ status, directory, resources, warnings });
	if (Object.values(resources).some((result) => result.failed > 0)) {
		process.exitCode = 1;
	}
}

export function runPullJson(configuration: Configuration): Promise<void> {
	return runSyncJson("pulled", pull(configuration), configuration.directory);
}

export function runPushJson(
	configuration: Configuration & { dryRun?: boolean },
): Promise<void> {
	return runSyncJson("pushed", push(configuration), configuration.directory);
}

export async function runCreateJson(
	directory: string,
	title: string,
): Promise<void> {
	try {
		const { filePath, slug } = await createDraft(directory, title);
		emit({ status: "created", path: filePath, slug, title });
	} catch (error) {
		emit({ status: "error", error: errorMessage(error) });
		process.exitCode = 1;
	}
}

export async function runLoginJson(
	apiKey: string | undefined,
	options: { force?: boolean; baseUrl: string },
): Promise<void> {
	if (!apiKey) {
		emit({
			status: "error",
			error: "--json login requires --api-key (interactive prompt disabled)",
		});
		process.exitCode = 1;
		return;
	}
	try {
		const result = await performLogin(apiKey, options);
		emit(result);
		if (result.status === "already_logged_in") {
			process.exitCode = 1;
		}
	} catch (error) {
		emit({ status: "error", error: errorMessage(error) });
		process.exitCode = 1;
	}
}

export function runLogoutJson(): void {
	performLogout();
	emit({ status: "logged_out" });
}
