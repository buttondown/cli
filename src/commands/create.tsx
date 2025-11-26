import path from "node:path";
import fs from "fs-extra";
import { Box, Text, useApp } from "ink";
import { useEffect, useState } from "react";

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
        const emailsDir = path.join(directory, "emails");
        await fs.ensureDir(emailsDir);

        const slug = title
          .toLowerCase()
          .replaceAll(/[^a-z\d]+/g, "-")
          .replaceAll(/(^-|-$)/g, "");

        const filePath = path.join(emailsDir, `${slug}.md`);

        if (await fs.pathExists(filePath)) {
          setError(`Email with slug "${slug}" already exists at ${filePath}`);
          return;
        }

        const date = new Date().toISOString();
        const content = `---
subject: ${title}
status: draft
email_type: public
slug: ${slug}
created: ${date}
modified: ${date}
---

Write your email content here...
`;

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
