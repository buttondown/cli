import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import React, { useState } from "react";
import ButtondownApi from "../api.js";

interface LoginProps {
  apiKey?: string;
}

export default function Login({ apiKey: initialApiKey }: LoginProps) {
  const [apiKey, setApiKey] = useState<string>(initialApiKey || "");
  const [submitted, setSubmitted] = useState<boolean>(Boolean(initialApiKey));
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    try {
      if (!apiKey.trim()) {
        setError("API key cannot be empty");
        return;
      }

      ButtondownApi.configure({ apiKey });
      setSubmitted(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Box flexDirection="column">
      {!submitted ? (
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
      ) : (
        <Text color="green">✓ Successfully configured API key!</Text>
      )}
    </Box>
  );
}
