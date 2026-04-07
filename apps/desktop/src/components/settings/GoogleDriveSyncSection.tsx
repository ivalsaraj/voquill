import {
  CloudDoneOutlined,
  CloudOffOutlined,
  CloudSyncOutlined,
  SyncOutlined,
} from "@mui/icons-material";
import {
  Button,
  CircularProgress,
  MenuItem,
  Select,
  type SelectChangeEvent,
  Stack,
  Typography,
} from "@mui/material";
import { FormattedMessage } from "react-intl";
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  updateSyncMode,
} from "../../actions/google-drive.actions";
import { syncNow } from "../../actions/sync-scheduler";
import { useAppStore } from "../../store";
import { ListTile } from "../common/ListTile";
import { Section } from "../common/Section";

export const GoogleDriveSyncSection = () => {
  const email = useAppStore(
    (state) => state.userPrefs?.googleDriveEmail ?? null,
  );
  const syncStatus = useAppStore(
    (state) => state.googleDriveSync.status,
  );
  const syncMode = useAppStore(
    (state) => state.userPrefs?.googleDriveSyncMode ?? "event",
  );
  const lastSynced = useAppStore(
    (state) => state.userPrefs?.googleDriveLastSyncedAt ?? null,
  );
  const errorMessage = useAppStore(
    (state) => state.googleDriveSync.errorMessage,
  );

  const connected = Boolean(email);
  const syncing = syncStatus === "syncing";

  const handleModeChange = (e: SelectChangeEvent) => {
    updateSyncMode(e.target.value as "event" | "interval" | "manual");
  };

  return (
    <Section
      title={<FormattedMessage defaultMessage="Google Drive Sync" />}
      description={
        <FormattedMessage defaultMessage="Sync your data to Google Drive for backup and multi-device use." />
      }
    >
      {!connected ? (
        <ListTile
          title={
            <FormattedMessage defaultMessage="Connect Google Drive" />
          }
          leading={<CloudOffOutlined />}
          onClick={connectGoogleDrive}
          trailing={
            <Button variant="outlined" size="small" onClick={connectGoogleDrive}>
              <FormattedMessage defaultMessage="Connect" />
            </Button>
          }
        />
      ) : (
        <>
          <ListTile
            title={
              <Stack direction="row" alignItems="center" spacing={1}>
                <CloudDoneOutlined color="success" fontSize="small" />
                <Typography variant="body2">
                  <FormattedMessage
                    defaultMessage="Connected as {email}"
                    values={{ email }}
                  />
                </Typography>
              </Stack>
            }
            leading={<CloudSyncOutlined />}
            trailing={
              <Button
                variant="outlined"
                size="small"
                color="error"
                onClick={disconnectGoogleDrive}
              >
                <FormattedMessage defaultMessage="Disconnect" />
              </Button>
            }
          />
          <ListTile
            title={<FormattedMessage defaultMessage="Sync trigger" />}
            leading={<SyncOutlined />}
            trailing={
              <Select
                size="small"
                value={syncMode ?? "event"}
                onChange={handleModeChange}
                sx={{ minWidth: 150 }}
              >
                <MenuItem value="event">
                  <FormattedMessage defaultMessage="On change" />
                </MenuItem>
                <MenuItem value="interval">
                  <FormattedMessage defaultMessage="Periodic" />
                </MenuItem>
                <MenuItem value="manual">
                  <FormattedMessage defaultMessage="Manual only" />
                </MenuItem>
              </Select>
            }
          />
          <ListTile
            title={<FormattedMessage defaultMessage="Sync now" />}
            leading={syncing ? <CircularProgress size={20} /> : <SyncOutlined />}
            onClick={syncing ? undefined : syncNow}
            trailing={
              <Stack alignItems="flex-end">
                {lastSynced && (
                  <Typography variant="caption" color="text.secondary">
                    <FormattedMessage
                      defaultMessage="Last synced: {date}"
                      values={{ date: new Date(lastSynced).toLocaleString() }}
                    />
                  </Typography>
                )}
                {errorMessage && (
                  <Typography variant="caption" color="error">
                    {errorMessage}
                  </Typography>
                )}
              </Stack>
            }
          />
        </>
      )}
    </Section>
  );
};
