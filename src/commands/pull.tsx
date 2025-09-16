import { Box, Text, useApp } from "ink";
import React, { useEffect, useState } from "react";
import { type Output, SyncManager } from "../sync.js";

type PullProps = {
  directory: string;
  force?: boolean;
  baseUrl?: string;
  apiKey?: string;
};

export default function Pull({
  directory,
  force = false,
  baseUrl,
  apiKey,
}: PullProps) {
  const { exit } = useApp();
  const [status, setStatus] = useState<string>("Starting pull...");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Output | null>(null);

  useEffect(() => {
    const performPull = async () => {
      try {
        setStatus("Initializing sync manager...");
        const syncManager = new SyncManager({
          directory,
          force,
          baseUrl,
          apiKey,
        });
        await syncManager.initialize();

        setStatus("Pulling emails...");
        const emailStats = await syncManager.pullEmails();

        setStatus("Pulling media files...");
        const mediaStats = await syncManager.pullMedia();

        setStatus("Pulling newsletter branding...");
        const brandingStats = await syncManager.pullNewsletterMetadata();

        setStats({
          emails: emailStats,
          media: mediaStats,
          branding: brandingStats,
        });

        setStatus("Pull complete!");
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : String(error_));
      }
    };

    performPull();
  }, [directory, force]);

  useEffect(() => {
    if (stats || error) {
      // Exit process after a short delay to ensure output is visible
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
                  ✓ {stats.emails.added} emails added, {stats.emails.updated}{" "}
                  emails updated, {stats.emails.unchanged} unchanged
                </Text>
              </Box>
              <Box>
                <Text color="green">
                  ✓ {stats.media.downloaded} media files downloaded
                </Text>
              </Box>
              <Box>
                <Text color="green">
                  ✓ Newsletter branding{" "}
                  {stats.branding.updated ? "updated" : "unchanged"}
                </Text>
              </Box>
              <Box marginTop={1}>
                <Text>All content saved to: {directory}</Text>
              </Box>
            </>
          )}
        </>
      )}
    </Box>
  );
}
