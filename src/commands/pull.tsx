import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useReducer } from "react";
import { type Configuration, RESOURCES } from "../sync/index.js";
import type { OperationResult } from "../sync/types.js";

type PullProps = {
  directory: string;
  baseUrl: string;
  apiKey?: string;
  accessToken?: string;
};

type State =
  | { status: "not_started" }
  | { status: "pulling"; stats: Record<string, OperationResult> }
  | { status: "pulled"; stats: Record<string, OperationResult> }
  | { status: "error"; error: string };

type Action =
  | { type: "start_pulling" }
  | { type: "register_pull"; resource: string; result: OperationResult }
  | { type: "finish_pulling" }
  | { type: "register_error"; error: string };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "start_pulling":
      return { status: "pulling", stats: {} };
    case "register_pull":
      if (state.status !== "pulling") {
        return state;
      }
      return {
        status: "pulling",
        stats: { ...state.stats, [action.resource]: action.result },
      };
    case "finish_pulling":
      if (state.status !== "pulling") {
        return state;
      }
      return { status: "pulled", stats: state.stats };
    case "register_error":
      return { status: "error", error: action.error };
  }
};

export default function Pull({
  directory,
  baseUrl,
  apiKey,
  accessToken,
}: PullProps) {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reducer, { status: "not_started" });

  useEffect(() => {
    const performPull = async () => {
      dispatch({ type: "start_pulling" });

      const configuration: Configuration = {
        directory,
        baseUrl,
        apiKey,
        accessToken,
      };

      try {
        for (const resource of RESOURCES) {
          const data = await resource.remote.get(configuration);
          if (data) {
            const result = await resource.local.set(data as any, configuration);
            dispatch({
              type: "register_pull",
              resource: resource.name,
              result,
            });
          }
        }
        dispatch({ type: "finish_pulling" });
      } catch (error) {
        dispatch({
          type: "register_error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    performPull();
  }, [directory, baseUrl, apiKey, accessToken]);

  useEffect(() => {
    if (state.status === "pulled" || state.status === "error") {
      const timer = setTimeout(() => {
        exit();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [state.status, exit]);

  if (state.status === "error") {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Error: {state.error}</Text>
      </Box>
    );
  }

  if (state.status === "pulling") {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="blue">
            <Spinner type="dots" />
          </Text>
          <Text> Pulling from Buttondown...</Text>
        </Box>
        {Object.entries(state.stats).map(([resource, result]) => (
          <Box key={resource} marginLeft={2}>
            <Text color="green">
              ✓ {resource}: {result.updates} updates, {result.creations}{" "}
              creations, {result.noops} no-ops, {result.deletions} deletions
            </Text>
          </Box>
        ))}
      </Box>
    );
  }

  if (state.status === "pulled") {
    return (
      <Box flexDirection="column">
        <Text color="green">✓ Pull complete!</Text>
        {Object.entries(state.stats).map(([resource, result]) => (
          <Box key={resource} marginLeft={2}>
            <Text>
              {resource}: {result.updates} updates, {result.creations}{" "}
              creations, {result.noops} no-ops, {result.deletions} deletions
            </Text>
          </Box>
        ))}
        <Box marginTop={1}>
          <Text dimColor>Content saved to: {directory}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <Text>Initializing...</Text>
    </Box>
  );
}
