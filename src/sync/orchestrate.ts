import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
	canonicalizeForDiff as canonicalizeAutomation,
	readLocalAutomations,
	serialize as serializeAutomation,
} from "./automations.js";
import {
	canonicalizeForDiff as canonicalizeEmail,
	convertAbsoluteToRelativeImages,
	editorModeFromBody,
	findRelativeImageReferences,
	type LocalEmail,
	readLocalEmails,
	resolveRelativeImageReferences,
	serialize as serializeEmail,
} from "./emails.js";
import { downloadImages, uploadImage } from "./images.js";
import {
	AUTOMATIONS_RESOURCE,
	IMAGES_RESOURCE,
	LOCAL_EMAILS_RESOURCE,
	LOCAL_NEWSLETTER_RESOURCE,
	NEWSLETTER_RESOURCE,
	REMOTE_EMAILS_RESOURCE,
	SNIPPETS_RESOURCE,
} from "./index.js";
import type { LocalFileEntry, SkippedFile } from "./local-files.js";
import { canonicalizeForDiff as canonicalizeNewsletter } from "./newsletter.js";
import {
	canonicalizeForDiff as canonicalizeSnippet,
	readLocalSnippets,
	serialize as serializeSnippet,
} from "./snippets.js";
import {
	readSyncState,
	resolveSyncedImagePath,
	type SyncedImage,
	writeSyncState,
} from "./state.js";
import type { Configuration, OperationResult, SetHooks } from "./types.js";
import { emptyResult } from "./types.js";
import { toPosixPath } from "./util.js";

export type DryRunResult = {
	resource: string;
	count: number;
};

export type ProgressEvent =
	| { type: "start" }
	| { type: "resource"; resource: string; result: OperationResult }
	| { type: "warning"; message: string }
	| { type: "finish" }
	| { type: "dry_run_complete"; changes: DryRunResult[] };

function toImageMap(
	directory: string,
	syncedImages: Record<string, SyncedImage>,
): Record<string, { localPath: string; url: string }> {
	return Object.fromEntries(
		Object.entries(syncedImages).map(([k, v]) => [
			k,
			{ localPath: resolveSyncedImagePath(directory, v), url: v.url },
		]),
	);
}

function isChanged<T extends { id?: string }>(
	item: T,
	remoteById: Map<string, T>,
	canonicalize: (item: T) => string,
): boolean {
	if (!item.id) return true;
	const remote = remoteById.get(item.id);
	if (!remote) return true;
	return canonicalize(item) !== canonicalize(remote);
}

function byId<T extends { id?: string }>(items: T[]): Map<string, T> {
	return new Map(
		items
			.filter((item): item is T & { id: string } => Boolean(item.id))
			.map((item) => [item.id, item]),
	);
}

/**
 * Pushes one file-backed resource: surfaces skipped files, diffs local
 * entries against the remote by canonical form, and — outside dry runs —
 * writes changed items, recording server-assigned ids back into the source
 * files so the next push updates instead of re-creating. Emails don't fit
 * this shape (image resolution, editor-mode inheritance) and stay bespoke.
 */
async function* pushChangedResource<T extends { id?: string }>(
	configuration: Configuration & { dryRun?: boolean },
	dryRunChanges: DryRunResult[],
	options: {
		name: string;
		read: () => Promise<{
			entries: LocalFileEntry<T>[];
			skipped: SkippedFile[];
		}>;
		fetchRemote: () => Promise<T[] | null>;
		set: (items: T[], hooks: SetHooks) => Promise<OperationResult>;
		canonicalize: (item: T) => string;
		serializeFile: (item: T) => string;
	},
): AsyncGenerator<ProgressEvent> {
	const { entries, skipped } = await options.read();
	for (const skippedFile of skipped) {
		yield {
			type: "warning",
			message: `Skipping ${skippedFile.file}: ${skippedFile.error}`,
		};
	}
	if (entries.length === 0) return;

	const remoteById = byId((await options.fetchRemote()) ?? []);
	const changed = entries.filter((entry) =>
		isChanged(entry.value, remoteById, options.canonicalize),
	);
	if (changed.length === 0) return;

	if (configuration.dryRun) {
		dryRunChanges.push({ resource: options.name, count: changed.length });
		return;
	}

	const entryByItem = new Map(
		changed.map((entry) => [entry.value as unknown, entry]),
	);
	const result = await options.set(
		changed.map((entry) => entry.value),
		{
			onCreated: async (item, id) => {
				const entry = entryByItem.get(item);
				if (!entry) return;
				await writeFile(
					entry.filePath,
					options.serializeFile({ ...entry.value, id }),
				);
			},
		},
	);
	yield { type: "resource", resource: options.name, result };
}

export async function* pull(
	configuration: Configuration,
): AsyncGenerator<ProgressEvent> {
	yield { type: "start" };

	const existingState = await readSyncState(configuration.directory);
	const syncedImages: Record<string, SyncedImage> = {
		...existingState.syncedImages,
	};

	try {
		// 1. Pull base resources (automations, newsletter, snippets)
		for (const resource of [
			AUTOMATIONS_RESOURCE,
			NEWSLETTER_RESOURCE,
			SNIPPETS_RESOURCE,
		]) {
			const data = await resource.remote.get(configuration);
			if (data) {
				const result = await resource.local.set(data as any, configuration);
				yield { type: "resource", resource: resource.name, result };
			}
		}

		// 2. Pull images → download to media/ → build URL→localPath mapping.
		// Preserve existing sync state so already-synced images keep their
		// original localPath: the server renames uploads to UUID filenames, so
		// recomputing localPath from the remote URL would create a new file on
		// every pull and rewrite email markdown references, causing an endless
		// duplication cycle on subsequent pushes.
		const remoteImages = await IMAGES_RESOURCE.remote.get(configuration);

		if (remoteImages) {
			const newImages = remoteImages.filter((image) => !syncedImages[image.id]);
			const takenFilenames = Object.values(syncedImages).map(
				(image) => image.filename,
			);
			const { synced, result } = await downloadImages(
				newImages,
				configuration,
				takenFilenames,
			);
			// Only successful downloads enter the sync state; failed ones must be
			// retried next pull instead of being referenced as missing files.
			for (const image of synced) {
				syncedImages[image.id] = image;
			}
			yield { type: "resource", resource: "images", result };
		}

		// 3. Pull emails → convert absolute URLs to relative paths
		const remoteEmails = await REMOTE_EMAILS_RESOURCE.get(configuration);

		if (remoteEmails) {
			const emailsDir = path.join(configuration.directory, "emails");
			const imageMap = toImageMap(configuration.directory, syncedImages);

			const processedEmails = remoteEmails.map((email) => ({
				...email,
				body: email.body
					? convertAbsoluteToRelativeImages(email.body, emailsDir, imageMap)
					: email.body,
			}));

			const result = await LOCAL_EMAILS_RESOURCE.set(
				processedEmails,
				configuration,
			);
			yield { type: "resource", resource: "emails", result };
		}
	} finally {
		// Even a partially failed pull must record its completed downloads, or
		// the next push re-uploads them as duplicates.
		await writeSyncState(configuration.directory, { syncedImages });
	}

	yield { type: "finish" };
}

export async function* push(
	configuration: Configuration & { dryRun?: boolean },
): AsyncGenerator<ProgressEvent> {
	yield { type: "start" };

	// 1. Read sync state
	const syncState = await readSyncState(configuration.directory);
	const syncedImages = { ...syncState.syncedImages };

	const dryRunChanges: DryRunResult[] = [];
	const newImagePaths = new Set<string>();

	try {
		// 2. Read local emails (tracking source files) and surface invalid ones
		const { entries: emailEntries, skipped: skippedEmails } =
			await readLocalEmails(configuration);
		for (const skipped of skippedEmails) {
			yield {
				type: "warning",
				message: `Skipping ${skipped.file}: ${skipped.error}`,
			};
		}

		// 3. Collect referenced images, upload new ones. Relative references
		// resolve against the referencing file's own directory, and a failed
		// upload marks the email unpushable instead of aborting everything.
		const imageResult = emptyResult();
		const unpushableFiles = new Set<string>();
		for (const entry of emailEntries) {
			if (!entry.value.body) continue;
			const baseDir = path.dirname(entry.filePath);
			const refs = findRelativeImageReferences(entry.value.body);
			for (const ref of refs) {
				const absolutePath = path.resolve(baseDir, ref.relativePath);
				const alreadySynced = Object.values(syncedImages).find(
					(img) =>
						resolveSyncedImagePath(configuration.directory, img) ===
						absolutePath,
				);
				if (alreadySynced) continue;

				if (configuration.dryRun) {
					newImagePaths.add(absolutePath);
					continue;
				}

				try {
					const result = await uploadImage(configuration, absolutePath);
					const relativePath = path.relative(
						path.resolve(configuration.directory),
						absolutePath,
					);
					syncedImages[result.id] = {
						id: result.id,
						localPath:
							relativePath.startsWith("..") || path.isAbsolute(relativePath)
								? absolutePath
								: toPosixPath(relativePath),
						url: result.url,
						filename: result.filename,
					};
					imageResult.created++;
				} catch (error) {
					imageResult.failed++;
					imageResult.errors.push(
						`${ref.relativePath} (in ${path.basename(entry.filePath)}): ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
					unpushableFiles.add(entry.filePath);
				}
			}
		}
		if (
			!configuration.dryRun &&
			(imageResult.created > 0 || imageResult.failed > 0)
		) {
			yield { type: "resource", resource: "images", result: imageResult };
		}

		// 4. Replace relative paths with absolute URLs
		const imageMap = toImageMap(configuration.directory, syncedImages);

		// 5. Fetch remote emails and diff to find changes
		const remoteEmails =
			(await REMOTE_EMAILS_RESOURCE.get(configuration)) ?? [];
		const remoteEmailsById = byId(remoteEmails as LocalEmail[]);

		const resolvedEntries = emailEntries.map((entry) => {
			const resolved: LocalEmail = {
				...entry.value,
				body: entry.value.body
					? resolveRelativeImageReferences(
							entry.value.body,
							path.dirname(entry.filePath),
							imageMap,
						)
					: entry.value.body,
			};
			// A file that doesn't declare an editor mode inherits the remote's:
			// pushing must never silently flip an email between markdown and HTML
			// (and a legacy sigil-free file must not diff forever against a
			// remote body that carries the sigil).
			if (!resolved.editor_mode && resolved.id) {
				const remote = remoteEmailsById.get(resolved.id);
				const inherited = editorModeFromBody(remote?.body);
				if (inherited) {
					resolved.editor_mode = inherited;
				}
			}
			return { ...entry, resolved };
		});

		// An email whose body still contains relative references (missing file,
		// failed upload) must never be pushed: the relative path would replace
		// the working image URL in the remote copy.
		const pushableEntries = [];
		for (const entry of resolvedEntries) {
			if (unpushableFiles.has(entry.filePath)) {
				yield {
					type: "warning",
					message: `Skipping ${path.basename(entry.filePath)}: image upload failed`,
				};
				continue;
			}
			const remaining = entry.resolved.body
				? findRelativeImageReferences(entry.resolved.body)
				: [];
			if (remaining.length > 0) {
				yield {
					type: "warning",
					message: `Skipping ${path.basename(entry.filePath)}: unresolved image reference(s): ${remaining
						.map((r) => r.relativePath)
						.join(", ")}`,
				};
				continue;
			}
			pushableEntries.push(entry);
		}

		const changedEntries = pushableEntries.filter((entry) =>
			isChanged(entry.resolved, remoteEmailsById, canonicalizeEmail),
		);

		if (configuration.dryRun) {
			if (changedEntries.length > 0) {
				dryRunChanges.push({
					resource: "emails",
					count: changedEntries.length,
				});
			}
		} else if (changedEntries.length > 0) {
			// 6. Push only changed emails; write server-assigned ids back into the
			// source files so the next push updates instead of re-creating.
			const entryByEmail = new Map(
				changedEntries.map((entry) => [entry.resolved as unknown, entry]),
			);
			const result = await REMOTE_EMAILS_RESOURCE.set(
				changedEntries.map((entry) => entry.resolved as never),
				configuration,
				{
					onCreated: async (item, id) => {
						const entry = entryByEmail.get(item);
						if (!entry) return;
						await writeFile(
							entry.filePath,
							serializeEmail({ ...entry.value, id }),
						);
					},
				},
			);
			yield { type: "resource", resource: "emails", result };
		}

		// 7. Push automations and snippets (only changed)
		yield* pushChangedResource(configuration, dryRunChanges, {
			name: "automations",
			read: () => readLocalAutomations(configuration),
			fetchRemote: () => AUTOMATIONS_RESOURCE.remote.get(configuration),
			set: (items, hooks) =>
				AUTOMATIONS_RESOURCE.remote.set(items as never, configuration, hooks),
			canonicalize: canonicalizeAutomation,
			serializeFile: serializeAutomation,
		});

		yield* pushChangedResource(configuration, dryRunChanges, {
			name: "snippets",
			read: () => readLocalSnippets(configuration),
			fetchRemote: () => SNIPPETS_RESOURCE.remote.get(configuration),
			set: (items, hooks) =>
				SNIPPETS_RESOURCE.remote.set(items as never, configuration, hooks),
			canonicalize: canonicalizeSnippet,
			serializeFile: serializeSnippet,
		});

		// 8. Push newsletter (only if changed)
		const localNewsletter = await LOCAL_NEWSLETTER_RESOURCE.get(configuration);
		if (localNewsletter) {
			const remoteNewsletter =
				await NEWSLETTER_RESOURCE.remote.get(configuration);
			const newsletterChanged =
				!remoteNewsletter ||
				canonicalizeNewsletter(localNewsletter) !==
					canonicalizeNewsletter(remoteNewsletter);

			if (configuration.dryRun) {
				if (newsletterChanged) {
					dryRunChanges.push({ resource: "newsletter", count: 1 });
				}
			} else if (newsletterChanged) {
				const result = await NEWSLETTER_RESOURCE.remote.set(
					localNewsletter,
					configuration,
				);
				yield { type: "resource", resource: "newsletter", result };
			}
		}
	} finally {
		// 9. Persist state even when the push aborts partway: uploaded images
		// must never be forgotten, or the next run re-uploads duplicates.
		if (!configuration.dryRun) {
			await writeSyncState(configuration.directory, { syncedImages });
		}
	}

	if (configuration.dryRun) {
		if (newImagePaths.size > 0) {
			dryRunChanges.push({ resource: "images", count: newImagePaths.size });
		}
		yield { type: "dry_run_complete", changes: dryRunChanges };
	} else {
		yield { type: "finish" };
	}
}
