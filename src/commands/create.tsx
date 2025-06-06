import path from "node:path";
import fs from "fs-extra";
import { Box, Text, useApp } from "ink";
import React, { useState, useEffect } from "react";

type CreateProps = {
  directory: string;
  title: string;
};

export default function Create({ directory, title }: CreateProps) {
  const { exit } = useApp();
  const [status, setStatus] = useState<string>("Creating new draft email...");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<boolean>(false);

  useEffect(() => {
    const createDraft = async () => {
      try {
        // Create the emails directory if it doesn't exist
        const emailsDir = path.join(directory, "emails");
        await fs.ensureDir(emailsDir);

        // Create a slug from the title
        const slug = title
          .toLowerCase()
          .replaceAll(/[^a-z\d]+/g, "-")
          .replaceAll(/(^-|-$)/g, "");

        // Create the email file path
        const filePath = path.join(emailsDir, `${slug}.md`);

        // Check if file already exists
        if (await fs.pathExists(filePath)) {
          setError(`Email with slug "${slug}" already exists at ${filePath}`);
          return;
        }

        // Create the email content
        const date = new Date().toISOString();
        const content = `---
subject: ${title}
status: draft
email_type: public
slug: ${slug}
created: ${date}
modified: ${date}
---

# ${title}

Write your email content here...
`;

        // Write the file
        await fs.writeFile(filePath, content);

        setStatus(`Created new draft email: ${filePath}`);
        setCreated(true);
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : String(error_));
      }
    };

    createDraft();
  }, [directory, title]);

  useEffect(() => {
    if (created || error) {
      // Exit process after a short delay to ensure output is visible
      const timer = setTimeout(() => {
        exit();
      }, 500);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [created, error, exit]);

  return (
    <Box flexDirection="column">
      {error ? (
        <Text color="red">Error: {error}</Text>
      ) : (
        <Text color="green">{status}</Text>
      )}
    </Box>
  );
}
