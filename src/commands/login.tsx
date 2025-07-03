import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import React, { useState } from "react";
import createConfig from "../config.js";

export default function Login({ apiKey: initialApiKey }: { apiKey?: string }) {
  const config = createConfig();
  const [apiKey, setApiKey] = useState<string>(
    initialApiKey || config.get("apiKey") || ""
  );
  const [submitted, setSubmitted] = useState<boolean>(
    Boolean(config.get("apiKey"))
  );
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
