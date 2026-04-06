import path from "node:path";
import fs from "fs-extra";
import { Box, Text, useApp } from "ink";
import { useEffect, useState } from "react";

type CreateProps = {
  directory: string;
  title: string;
  json?: boolean;
};

export default function Create({ directory, title, json }: CreateProps) {
  const { exit } = useApp();
  const [status, setStatus] = useState<string>("Creating new draft email...");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<boolean>(false);
  const [filePath, setFilePath] = useState<string>("");
  const [slug, setSlug] = useState<string>("");

  useEffect(() => {
    const createDraft = async () => {
      try {
        const emailsDir = path.join(directory, "emails");
        await fs.ensureDir(emailsDir);

        const newSlug = title
          .toLowerCase()
          .replaceAll(/[^a-z\d]+/g, "-")
          .replaceAll(/(^-|-$)/g, "");

        if (!newSlug) {
          setError("Title must contain at least one alphanumeric character");
          return;
        }

        const newFilePath = path.join(emailsDir, `${newSlug}.md`);

        if (await fs.pathExists(newFilePath)) {
          setError(
            `Email with slug "${newSlug}" already exists at ${newFilePath}`,
          );
          return;
        }

        const date = new Date().toISOString();
        const content = `---
subject: ${title}
status: draft
email_type: public
slug: ${newSlug}
created: ${date}
modified: ${date}
---

Write your email content here...
`;

        await fs.writeFile(newFilePath, content);

        setFilePath(newFilePath);
        setSlug(newSlug);
        setStatus(`Created new draft email: ${newFilePath}`);
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

  if (json && created) {
    return (
      <Text>
        {JSON.stringify({
          status: "created",
          path: filePath,
          slug,
          title,
        })}
      </Text>
    );
  }
  if (json && error) {
    return <Text>{JSON.stringify({ status: "error", error })}</Text>;
  }

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
