import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import React, { useState } from "react";
import createConfig from "../config.js";

export default function Login({
  apiKey: initialApiKey,
  force,
}: { apiKey?: string; force?: boolean }) {
  const config = createConfig();
  const existingApiKey = config.get("apiKey");

  // When force is true, start with empty string; otherwise use existing or initial API key
  const [apiKey, setApiKey] = useState<string>(
    initialApiKey || (force ? "" : existingApiKey || ""),
  );
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // If already logged in and not forcing, show already logged in message
  if (existingApiKey && !force && !submitted) {
    return (
      <Box flexDirection="column">
        <Text color="green">✓ You're already logged in!</Text>
        <Box marginTop={1}>
          <Text>To use a different API key, run: </Text>
          <Text color="cyan">buttondown login --force</Text>
        </Box>
      </Box>
    );
  }

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

  return (
    <Box flexDirection="column">
      {submitted ? (
        <>
          <Text color="green">✓ Successfully configured API key!</Text>
          <Box marginTop={1}>
            <Text>To use a different API key, run this command again.</Text>
          </Box>
        </>
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
