import { Box, Text, useApp } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useMemo, useState } from "react";
import createConfig from "../config.js";

export default function Login({
  apiKey: initialApiKey,
  force,
  json,
}: {
  apiKey?: string;
  force?: boolean;
  json?: boolean;
}) {
  const config = createConfig();
  const existingApiKey = config.get("apiKey");
  const { exit } = useApp();

  // Non-interactive: when --api-key is passed, save synchronously on first render
  const nonInteractiveResult = useMemo(() => {
    if (!initialApiKey) return null;
    try {
      config.set("apiKey", initialApiKey);
      config.set("baseUrl", "https://api.buttondown.com");
      return { success: true as const };
    } catch (error_) {
      return {
        success: false as const,
        error: error_ instanceof Error ? error_.message : String(error_),
      };
    }
  }, [initialApiKey]);

  // Exit after rendering the non-interactive result
  useEffect(() => {
    if (nonInteractiveResult) {
      const timer = setTimeout(() => exit(), 100);
      return () => clearTimeout(timer);
    }
  }, [nonInteractiveResult, exit]);

  // Non-interactive path: render result and exit
  if (nonInteractiveResult) {
    if (json) {
      if (nonInteractiveResult.success) {
        return <Text>{JSON.stringify({ status: "logged_in" })}</Text>;
      }
      return (
        <Text>
          {JSON.stringify({
            status: "error",
            error: nonInteractiveResult.error,
          })}
        </Text>
      );
    }
    if (nonInteractiveResult.success) {
      return <Text color="green">Logged in.</Text>;
    }
    return <Text color="red">Error: {nonInteractiveResult.error}</Text>;
  }

  // If already logged in and not forcing, show already logged in message
  if (existingApiKey && !force) {
    if (json) {
      return <Text>{JSON.stringify({ status: "already_logged_in" })}</Text>;
    }
    return (
      <Box flexDirection="column">
        <Text color="green">Already logged in.</Text>
        <Box marginTop={1}>
          <Text>To use a different API key, run: </Text>
          <Text color="cyan">buttondown login --force</Text>
        </Box>
      </Box>
    );
  }

  // Interactive path
  return <LoginInteractive force={force} json={json} />;
}

function LoginInteractive({
  force,
  json,
}: { force?: boolean; json?: boolean }) {
  const config = createConfig();
  const [apiKey, setApiKey] = useState<string>("");
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    try {
      if (!apiKey.trim()) {
        setError("API key cannot be empty");
        return;
      }

      config.set("apiKey", apiKey);
      config.set("baseUrl", "https://api.buttondown.com");
      setSubmitted(true);
      setError(null);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_));
    }
  };

  if (json && submitted) {
    return <Text>{JSON.stringify({ status: "logged_in" })}</Text>;
  }
  if (json && error) {
    return <Text>{JSON.stringify({ status: "error", error })}</Text>;
  }

  return (
    <Box flexDirection="column">
      {submitted ? (
        <Text color="green">Logged in.</Text>
      ) : (
        <>
          <Box marginBottom={1}>
            <Text>Please enter your Buttondown API key:</Text>
          </Box>
          <Box>
            <TextInput
              value={apiKey}
              onChange={setApiKey}
              onSubmit={handleSubmit}
              placeholder="Enter your API key..."
              showCursor
            />
          </Box>
          {error && (
            <Box marginTop={1}>
              <Text color="red">{error}</Text>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
