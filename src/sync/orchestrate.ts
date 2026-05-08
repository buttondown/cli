import path from "node:path";
import { serialize as serializeAutomation } from "./automations.js";
import {
  convertAbsoluteToRelativeImages,
  findRelativeImageReferences,
  resolveRelativeImageReferences,
  serialize as serializeEmail,
} from "./emails.js";
import { uploadImage } from "./images.js";
import {
  AUTOMATIONS_RESOURCE,
  BASE_RESOURCES,
  IMAGES_RESOURCE,
  LOCAL_EMAILS_RESOURCE,
  NEWSLETTER_RESOURCE,
  REMOTE_EMAILS_RESOURCE,
  SNIPPETS_RESOURCE,
} from "./index.js";
import { serialize as serializeSnippet } from "./snippets.js";
import { readSyncState, type SyncedImage, writeSyncState } from "./state.js";
import type { Configuration, OperationResult } from "./types.js";

export type DryRunResult = {
  resource: string;
  count: number;
};

export type ProgressEvent =
  | { type: "start" }
  | { type: "resource"; resource: string; result: OperationResult }
  | { type: "finish" }
  | { type: "dry_run_complete"; changes: DryRunResult[] };

function toImageMap(
  syncedImages: Record<string, SyncedImage>,
): Record<string, { localPath: string; url: string }> {
  return Object.fromEntries(
    Object.entries(syncedImages).map(([k, v]) => [
      k,
      { localPath: v.localPath, url: v.url },
    ]),
  );
}

function diffByIdAndSerialize<T extends { id?: string }>(
  local: T[],
  remote: T[],
  serializeItem: (item: T) => string,
): T[] {
  const remoteById = new Map(
    remote
      .filter((r): r is T & { id: string } => Boolean(r.id))
      .map((r) => [r.id, r]),
  );
  return local.filter((item) => {
    if (!item.id) return true;
    const r = remoteById.get(item.id);
    if (!r) return true;
    return serializeItem(item) !== serializeItem(r);
  });
}

export async function* pull(
  configuration: Configuration,
): AsyncGenerator<ProgressEvent> {
  yield { type: "start" };

  // 1. Pull base resources (automations, newsletter, snippets)
  for (const resource of BASE_RESOURCES) {
    const data = await resource.remote.get(configuration);
    if (data) {
      const result = await resource.local.set(data as any, configuration);
      yield { type: "resource", resource: resource.name, result };
    }
  }

  // 2. Pull images → download to media/ → build URL→localPath mapping.
  // Preserve existing sync state so already-synced images keep their original
  // localPath: the server renames uploads to UUID filenames, so recomputing
  // localPath from the remote URL would create a new file on every pull and
  // rewrite email markdown references, causing an endless duplication cycle
  // on subsequent pushes.
  const remoteImages = await IMAGES_RESOURCE.remote.get(configuration);
  const existingState = await readSyncState(configuration.directory);
  const syncedImages: Record<string, SyncedImage> = {
    ...existingState.syncedImages,
  };

  if (remoteImages) {
    const newImages = remoteImages.filter((image) => !syncedImages[image.id]);

    const result = await IMAGES_RESOURCE.local.set(newImages, configuration);
    yield { type: "resource", resource: "images", result };

    for (const image of newImages) {
      const filename = path.basename(image.image);
      const localPath = path.join(configuration.directory, "media", filename);
      syncedImages[image.id] = {
        id: image.id,
        localPath,
        url: image.image,
        filename,
      };
    }
  }

  // 3. Pull emails → convert absolute URLs to relative paths
  const remoteEmails = await REMOTE_EMAILS_RESOURCE.get(configuration);

  if (remoteEmails) {
    const emailsDir = path.join(configuration.directory, "emails");
    const imageMap = toImageMap(syncedImages);

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

  // 4. Write sync state
  await writeSyncState(configuration.directory, { syncedImages });

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
  let newImageCount = 0;

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
          (img) =>
            img.localPath === absolutePath ||
            img.filename === path.basename(absolutePath),
        );
        if (!alreadySynced) {
          if (configuration.dryRun) {
            newImageCount++;
          } else {
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
    }

    // 4. Replace relative paths with absolute URLs
    const imageMap = toImageMap(syncedImages);

    // 5. Fetch remote emails and diff to find changes
    const remoteEmails =
      (await REMOTE_EMAILS_RESOURCE.get(configuration)) ?? [];

    const resolvedLocalEmails = localEmails.map((email) => ({
      ...email,
      body: email.body
        ? resolveRelativeImageReferences(email.body, emailsDir, imageMap)
        : email.body,
    }));

    const changedEmails = diffByIdAndSerialize(
      resolvedLocalEmails,
      remoteEmails,
      serializeEmail,
    );

    if (configuration.dryRun) {
      if (changedEmails.length > 0) {
        dryRunChanges.push({
          resource: "emails",
          count: changedEmails.length,
        });
      }
    } else {
      // 6. Push only changed emails
      const result = await REMOTE_EMAILS_RESOURCE.set(
        changedEmails,
        configuration,
      );
      yield { type: "resource", resource: "emails", result };
    }
  }

  // 7. Push automations (only changed)
  const localAutomations = await AUTOMATIONS_RESOURCE.local.get(configuration);
  if (localAutomations) {
    const remoteAutomations =
      (await AUTOMATIONS_RESOURCE.remote.get(configuration)) ?? [];
    const changedAutomations = diffByIdAndSerialize(
      localAutomations,
      remoteAutomations,
      serializeAutomation,
    );

    if (configuration.dryRun) {
      if (changedAutomations.length > 0) {
        dryRunChanges.push({
          resource: "automations",
          count: changedAutomations.length,
        });
      }
    } else {
      const result = await AUTOMATIONS_RESOURCE.remote.set(
        changedAutomations,
        configuration,
      );
      yield { type: "resource", resource: "automations", result };
    }
  }

  // 8. Push snippets (only changed)
  const localSnippets = await SNIPPETS_RESOURCE.local.get(configuration);
  if (localSnippets) {
    const remoteSnippets =
      (await SNIPPETS_RESOURCE.remote.get(configuration)) ?? [];
    const changedSnippets = diffByIdAndSerialize(
      localSnippets,
      remoteSnippets,
      serializeSnippet,
    );

    if (configuration.dryRun) {
      if (changedSnippets.length > 0) {
        dryRunChanges.push({
          resource: "snippets",
          count: changedSnippets.length,
        });
      }
    } else {
      const result = await SNIPPETS_RESOURCE.remote.set(
        changedSnippets,
        configuration,
      );
      yield { type: "resource", resource: "snippets", result };
    }
  }

  // 9. Push newsletter (only if changed)
  const localNewsletter = await NEWSLETTER_RESOURCE.local.get(configuration);
  if (localNewsletter) {
    const remoteNewsletter =
      await NEWSLETTER_RESOURCE.remote.get(configuration);
    const newsletterChanged =
      !remoteNewsletter ||
      JSON.stringify(localNewsletter) !== JSON.stringify(remoteNewsletter);

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

  if (configuration.dryRun) {
    if (newImageCount > 0) {
      dryRunChanges.push({ resource: "images", count: newImageCount });
    }
    yield { type: "dry_run_complete", changes: dryRunChanges };
  } else {
    // 10. Write updated sync state
    await writeSyncState(configuration.directory, { syncedImages });
    yield { type: "finish" };
  }
}
