import { Box, Text, useApp } from "ink";
import { useEffect, useReducer } from "react";
import type { Configuration } from "../sync/index.js";
import { type DryRunResult, push } from "../sync/orchestrate.js";
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
      try {
        for await (const event of push(configuration)) {
          switch (event.type) {
            case "start":
              dispatch({ type: "start_pushing" });
              break;
            case "resource":
              dispatch({
                type: "register_new_push",
                resource: event.resource,
                result: event.result,
              });
              break;
            case "finish":
              dispatch({ type: "finish_pushing" });
              break;
            case "dry_run_complete":
              dispatch({ type: "finish_dry_run", changes: event.changes });
              break;
          }
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
        Object.entries(state.stats).map(([resource, result]) => (
          <Box key={resource}>
            <Text color="green">{`${resource}: ${result.updated} updated, ${result.created} created, ${result.deleted} deleted, ${result.failed} failed`}</Text>
          </Box>
        ))
      ) : state.status === "pushing" ? (
        <Text color="blue">Pushing...</Text>
      ) : null}
    </Box>
  );
}
