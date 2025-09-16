import { Box, Text, useApp } from "ink";
import React, { useEffect, useState } from "react";
import { type Output, SyncManager } from "../sync.js";

type PushProps = {
  directory: string;
  force?: boolean;
  verbose?: boolean;
  baseUrl?: string;
  apiKey?: string;
};

export default function Push({
  directory,
  force = false,
  verbose = false,
  baseUrl,
  apiKey,
}: PushProps) {
  const { exit } = useApp();
  const [status, setStatus] = useState<string>("Starting push...");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Output | null>(null);

  useEffect(() => {
    const performPush = async () => {
      try {
        setStatus("Initializing sync manager...");
        const syncManager = new SyncManager({
          directory,
          force,
          baseUrl,
          apiKey,
        });
        await syncManager.initialize();

        setStatus("Pushing media files...");
        const mediaStats = await syncManager.pushMedia();

        setStatus("Pushing emails...");
        const emailStats = await syncManager.pushEmails();

        setStatus("Pushing newsletter branding...");
        const brandingStats = await syncManager.pushNewsletterMetadata();

        setStats({
          emails: emailStats,
          media: mediaStats,
          branding: brandingStats,
        });

        setStatus("Push complete!");
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : String(error_));
      }
    };

    performPush();
  }, [directory, force]);

  useEffect(() => {
    if (stats || error) {
      const timer = setTimeout(() => {
        exit();
      }, 500);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [stats, error, exit]);

  return (
    <Box flexDirection="column">
      {error ? (
        <Text color="red">Error: {error}</Text>
      ) : (
        <>
          <Text color="blue">{status}</Text>

          {stats && (
            <>
              <Box marginTop={1}>
                <Text color="green">
                  ✓ {stats.emails.added} emails created, {stats.emails.updated}{" "}
                  emails updated, {stats.emails.unchanged} unchanged
                </Text>
              </Box>
              <Box>
                <Text color="green">
                  ✓ {stats.media.downloaded} media files downloaded,{" "}
                  {stats.media.uploaded} media files uploaded
                </Text>
              </Box>
              <Box>
                <Text color="green">
                  ✓ Newsletter branding{" "}
                  {stats.branding.updated ? "updated" : "unchanged"}
                </Text>
              </Box>
              <Box marginTop={1}>
                <Text>Content pushed from: {directory}</Text>
              </Box>
            </>
          )}
        </>
      )}
    </Box>
  );
}
