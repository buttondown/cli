import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import { SyncManager } from '../sync.js';

interface PullProps {
  directory: string;
  force?: boolean;
}

export default function Pull({ directory, force = false }: PullProps) {
  const { exit } = useApp();
  const [status, setStatus] = useState<string>('Starting pull...');
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    emails: { added: number; updated: number; unchanged: number };
    media: { downloaded: number };
    branding: { updated: boolean };
  } | null>(null);

  useEffect(() => {
    const performPull = async () => {
      try {
        setStatus('Initializing sync manager...');
        const syncManager = new SyncManager({ directory, force });
        await syncManager.initialize();
        
        setStatus('Pulling emails...');
        const emailStats = await syncManager.pullEmails();
        
        setStatus('Pulling media files...');
        const mediaStats = await syncManager.pullMedia();
        
        setStatus('Pulling newsletter branding...');
        const brandingStats = await syncManager.pullNewsletterMetadata();
        
        setStats({
          emails: emailStats,
          media: mediaStats,
          branding: brandingStats
        });
        
        setStatus('Pull complete!');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    performPull();
  }, [directory, force]);

  useEffect(() => {
    if (stats || error) {
      // Exit process after a short delay to ensure output is visible
      const timer = setTimeout(() => exit(), 500);
      return () => clearTimeout(timer);
    }
  }, [stats, error, exit]);

  return (
    <Box flexDirection="column">
      {!error ? (
        <>
          <Text color="blue">{status}</Text>
          
          {stats && (
            <>
              <Box marginTop={1}>
                <Text color="green">
                  ✓ {stats.emails.added} emails added, {stats.emails.updated} emails updated, {stats.emails.unchanged} unchanged
                </Text>
              </Box>
              <Box>
                <Text color="green">
                  ✓ {stats.media.downloaded} media files downloaded
                </Text>
              </Box>
              <Box>
                <Text color="green">
                  ✓ Newsletter branding {stats.branding.updated ? 'updated' : 'unchanged'}
                </Text>
              </Box>
              <Box marginTop={1}>
                <Text>All content saved to: {directory}</Text>
              </Box>
            </>
          )}
        </>
      ) : (
        <Text color="red">Error: {error}</Text>
      )}
    </Box>
  );
}