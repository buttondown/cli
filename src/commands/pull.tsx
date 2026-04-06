import path from "node:path";
import { Box, Text, useApp } from "ink";
import { useEffect, useReducer } from "react";
import {
  BASE_RESOURCES,
  type Configuration,
  convertAbsoluteToRelativeImages,
  IMAGES_RESOURCE,
  LOCAL_EMAILS_RESOURCE,
  REMOTE_EMAILS_RESOURCE,
  readSyncState,
  writeSyncState,
} from "../sync/index.js";
import type { SyncedImage } from "../sync/state.js";
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

export default function Pull(
  configuration: Configuration & { json?: boolean },
) {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reducer, {
    status: "not_started",
  });

  useEffect(() => {
    const performPull = async () => {
      dispatch({ type: "start_pulling" });
      try {
        // 1. Pull base resources (automations, newsletter, snippets)
        for (const resource of BASE_RESOURCES) {
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

        // 2. Pull images → download to media/ → build URL→localPath mapping
        const remoteImages = await IMAGES_RESOURCE.remote.get(configuration);

        // Preserve existing sync state so that already-synced images keep
        // their original localPath. The server renames uploads to UUID
        // filenames (e.g. photo.png → <uuid>.png), so recomputing the
        // localPath from the remote URL would create a new file on every
        // pull and rewrite email markdown references, causing an endless
        // duplication cycle on subsequent pushes.
        const existingState = await readSyncState(configuration.directory);
        const syncedImages: Record<string, SyncedImage> = {
          ...existingState.syncedImages,
        };

        if (remoteImages) {
          // Skip images already tracked in sync state — they've already
          // been downloaded and their localPath is stable.
          const newImages = remoteImages.filter(
            (image) => !syncedImages[image.id],
          );

          const output = await IMAGES_RESOURCE.local.set(
            newImages,
            configuration,
          );
          dispatch({
            type: "register_new_pull",
            resource: "images",
            result: output,
          });

          // Only record new images; existing entries are left untouched
          // so their localPath (which may differ from the URL basename)
          // stays consistent with what emails reference on disk.
          for (const image of newImages) {
            const filename = path.basename(image.image);
            const localPath = path.join(
              configuration.directory,
              "media",
              filename,
            );
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
          const imageMap = Object.fromEntries(
            Object.entries(syncedImages).map(([k, v]) => [
              k,
              { localPath: v.localPath, url: v.url },
            ]),
          );

          const processedEmails = remoteEmails.map((email) => ({
            ...email,
            body: email.body
              ? convertAbsoluteToRelativeImages(email.body, emailsDir, imageMap)
              : email.body,
          }));

          const output = await LOCAL_EMAILS_RESOURCE.set(
            processedEmails,
            configuration,
          );
          dispatch({
            type: "register_new_pull",
            resource: "emails",
            result: output,
          });
        }

        // 4. Write sync state
        await writeSyncState(configuration.directory, { syncedImages });

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
    if (state.status === "pulled" || state.status === "error") {
      const timer = setTimeout(() => {
        exit();
      }, 500);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [state.status, exit]);

  if (configuration.json) {
    if (state.status === "pulled") {
      return (
        <Text>
          {JSON.stringify({
            status: "pulled",
            directory: configuration.directory,
            resources: state.stats,
          })}
        </Text>
      );
    }
    if (state.status === "error") {
      return (
        <Text>{JSON.stringify({ status: "error", error: state.error })}</Text>
      );
    }
  }

  return (
    <Box flexDirection="column">
      {state.status === "error" ? (
        <Text color="red">Error: {state.error}</Text>
      ) : state.status === "pulled" ? (
        <>
          {Object.entries(state.stats).map(([resource, result]) => (
            <Box key={resource}>
              <Text color="green">{`${resource}: ${result.updated} updated, ${result.created} created, ${result.deleted} deleted, ${result.failed} failed`}</Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <Text>
              directory: {configuration.directory}
            </Text>
          </Box>
        </>
      ) : state.status === "pulling" ? (
        <Text color="blue">Pulling...</Text>
      ) : null}
    </Box>
  );
}
