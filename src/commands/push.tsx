import path from "node:path";
import { Box, Text, useApp } from "ink";
import { useEffect, useReducer } from "react";
import { serialize as serializeAutomation } from "../sync/automations.js";
import { serialize } from "../sync/emails.js";
import {
  AUTOMATIONS_RESOURCE,
  type Configuration,
  findRelativeImageReferences,
  LOCAL_EMAILS_RESOURCE,
  NEWSLETTER_RESOURCE,
  REMOTE_EMAILS_RESOURCE,
  SNIPPETS_RESOURCE,
  readSyncState,
  resolveRelativeImageReferences,
  uploadImage,
  writeSyncState,
} from "../sync/index.js";
import { serialize as serializeSnippet } from "../sync/snippets.js";
import type { OperationResult } from "../sync/types.js";

type DryRunResult = {
  resource: string;
  count: number;
};

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
      status: "dry_run";
      changes: DryRunResult[];
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
      type: "finish_dry_run";
      changes: DryRunResult[];
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
    case "finish_dry_run":
      return { status: "dry_run", changes: action.changes };
    case "register_error":
      return { status: "error", error: action.error };
  }
};

type PushProps = Configuration & { dryRun?: boolean; json?: boolean };

export default function Push(configuration: PushProps) {
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

        // Collect changes for dry-run reporting
        const dryRunChanges: DryRunResult[] = [];
        let newImageCount = 0;

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
                  const result = await uploadImage(
                    configuration,
                    absolutePath,
                  );
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
          const imageMap = Object.fromEntries(
            Object.entries(syncedImages).map(([k, v]) => [
              k,
              { localPath: v.localPath, url: v.url },
            ]),
          );

          // 5. Fetch remote emails and diff to find changes
          const remoteEmailsById = new Map(
            ((await REMOTE_EMAILS_RESOURCE.get(configuration)) ?? []).map(
              (e) => [e.id, e],
            ),
          );

          const changedEmails = localEmails
            .map((email) => ({
              ...email,
              body: email.body
                ? resolveRelativeImageReferences(
                    email.body,
                    emailsDir,
                    imageMap,
                  )
                : email.body,
            }))
            .filter((email) => {
              if (!email.id) return true;
              const remote = remoteEmailsById.get(email.id);
              if (!remote) return true;
              return serialize(email) !== serialize(remote);
            });

          if (configuration.dryRun) {
            if (changedEmails.length > 0) {
              dryRunChanges.push({
                resource: "emails",
                count: changedEmails.length,
              });
            }
          } else {
            // 6. Push only changed emails
            const emailResult = await REMOTE_EMAILS_RESOURCE.set(
              changedEmails,
              configuration,
            );
            dispatch({
              type: "register_new_push",
              resource: "emails",
              result: emailResult,
            });
          }
        }

        // 7. Push automations (only changed)
        const localAutomations =
          await AUTOMATIONS_RESOURCE.local.get(configuration);
        if (localAutomations) {
          const remoteAutomations =
            (await AUTOMATIONS_RESOURCE.remote.get(configuration)) ?? [];
          const remoteAutomationsById = new Map(
            remoteAutomations
              .filter((a) => a.id)
              .map((a) => [a.id, a]),
          );
          const changedAutomations = localAutomations.filter((a) => {
            if (!a.id) return true;
            const remote = remoteAutomationsById.get(a.id);
            if (!remote) return true;
            return serializeAutomation(a) !== serializeAutomation(remote);
          });

          if (configuration.dryRun) {
            if (changedAutomations.length > 0) {
              dryRunChanges.push({
                resource: "automations",
                count: changedAutomations.length,
              });
            }
          } else {
            const output = await AUTOMATIONS_RESOURCE.remote.set(
              changedAutomations,
              configuration,
            );
            dispatch({
              type: "register_new_push",
              resource: "automations",
              result: output,
            });
          }
        }

        // 8. Push snippets (only changed)
        const localSnippets =
          await SNIPPETS_RESOURCE.local.get(configuration);
        if (localSnippets) {
          const remoteSnippets =
            (await SNIPPETS_RESOURCE.remote.get(configuration)) ?? [];
          const remoteSnippetsById = new Map(
            remoteSnippets
              .filter((s) => s.id)
              .map((s) => [s.id, s]),
          );
          const changedSnippets = localSnippets.filter((s) => {
            if (!s.id) return true;
            const remote = remoteSnippetsById.get(s.id);
            if (!remote) return true;
            return serializeSnippet(s) !== serializeSnippet(remote);
          });

          if (configuration.dryRun) {
            if (changedSnippets.length > 0) {
              dryRunChanges.push({
                resource: "snippets",
                count: changedSnippets.length,
              });
            }
          } else {
            const output = await SNIPPETS_RESOURCE.remote.set(
              changedSnippets,
              configuration,
            );
            dispatch({
              type: "register_new_push",
              resource: "snippets",
              result: output,
            });
          }
        }

        // 9. Push newsletter (only if changed)
        const localNewsletter =
          await NEWSLETTER_RESOURCE.local.get(configuration);
        if (localNewsletter) {
          const remoteNewsletter =
            await NEWSLETTER_RESOURCE.remote.get(configuration);
          const newsletterChanged =
            !remoteNewsletter ||
            JSON.stringify(localNewsletter) !==
              JSON.stringify(remoteNewsletter);

          if (configuration.dryRun) {
            if (newsletterChanged) {
              dryRunChanges.push({
                resource: "newsletter",
                count: 1,
              });
            }
          } else {
            if (newsletterChanged) {
              const output = await NEWSLETTER_RESOURCE.remote.set(
                localNewsletter,
                configuration,
              );
              dispatch({
                type: "register_new_push",
                resource: "newsletter",
                result: output,
              });
            }
          }
        }

        if (configuration.dryRun) {
          if (newImageCount > 0) {
            dryRunChanges.push({
              resource: "images",
              count: newImageCount,
            });
          }
          dispatch({
            type: "finish_dry_run",
            changes: dryRunChanges,
          });
        } else {
          // 10. Write updated sync state
          await writeSyncState(configuration.directory, { syncedImages });

          dispatch({
            type: "finish_pushing",
          });
        }
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
    if (
      state.status === "pushed" ||
      state.status === "dry_run" ||
      state.status === "error"
    ) {
      const timer = setTimeout(() => {
        exit();
      }, 500);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [state.status, exit]);

  if (configuration.json) {
    if (state.status === "pushed") {
      return (
        <Text>
          {JSON.stringify({
            status: "pushed",
            directory: configuration.directory,
            resources: state.stats,
          })}
        </Text>
      );
    }
    if (state.status === "dry_run") {
      return (
        <Text>
          {JSON.stringify({
            status: "dry_run",
            changes: state.changes,
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
      ) : state.status === "dry_run" ? (
        <>
          {state.changes.length === 0 ? (
            <Text>No changes to push.</Text>
          ) : (
            <>
              <Text>Would push the following changes:</Text>
              {state.changes.map(({ resource, count }) => (
                <Box key={resource}>
                  <Text>{`  ${resource}: ${count} changed`}</Text>
                </Box>
              ))}
            </>
          )}
          <Box marginTop={1}>
            <Text color="blue">No changes made.</Text>
          </Box>
        </>
      ) : state.status === "pushed" ? (
        <>
          {Object.entries(state.stats).map(([resource, result]) => (
            <Box key={resource}>
              <Text color="green">{`${resource}: ${result.updated} updated, ${result.created} created, ${result.deleted} deleted, ${result.failed} failed`}</Text>
            </Box>
          ))}
        </>
      ) : state.status === "pushing" ? (
        <Text color="blue">Pushing...</Text>
      ) : null}
    </Box>
  );
}
