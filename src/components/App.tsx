import { Box, Text, useApp } from "ink";
import React, { useEffect, useState } from "react";
import ButtondownApi from "../api.js";

interface AppProps {
  command: string;
  options: Record<string, any>;
}

export default function App({ command, options }: AppProps) {
  const { exit } = useApp();
  const [status, setStatus] = useState<string>("Starting...");
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState<boolean>(false);

  useEffect(() => {
    const runCommand = async () => {
      try {
        if (!ButtondownApi.isConfigured() && command !== "login") {
          setError("You need to run `buttondown login` first to authenticate.");
          setComplete(true);
          return;
        }

        switch (command) {
          case "login":
            setStatus("Configuring API credentials...");
            ButtondownApi.configure({
              apiKey: options.apiKey,
              baseUrl: options.baseUrl,
            });
            setStatus("Successfully authenticated!");
            break;

          case "logout":
            setStatus("Clearing credentials...");
            ButtondownApi.clearConfig();
            setStatus("Successfully logged out.");
            break;

          default:
            setError(`Unknown command: ${command}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setComplete(true);
      }
    };

    runCommand();

    return () => {
      // Cleanup if needed
    };
  }, [command, options]);

  useEffect(() => {
    if (complete) {
      // Exit process after a short delay to ensure output is visible
      const timer = setTimeout(() => exit(), 100);
      return () => clearTimeout(timer);
    }
  }, [complete, exit]);

  return (
    <Box flexDirection="column">
      {!error ? (
        <Text color="green">{status}</Text>
      ) : (
        <Text color="red">Error: {error}</Text>
      )}
    </Box>
  );
}
