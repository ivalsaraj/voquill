import {
  CloudDoneOutlined,
  ErrorOutlineOutlined,
} from "@mui/icons-material";
import { CircularProgress, Tooltip, Typography } from "@mui/material";
import { FormattedMessage } from "react-intl";
import { useAppStore } from "../../store";

export const SyncStatusIndicator = () => {
  const connected = useAppStore(
    (state) => Boolean(state.userPrefs?.googleDriveEmail),
  );
  const status = useAppStore((state) => state.googleDriveSync.status);
  const errorMessage = useAppStore(
    (state) => state.googleDriveSync.errorMessage,
  );

  if (!connected) return null;

  if (status === "syncing") {
    return (
      <Tooltip title={<FormattedMessage defaultMessage="Syncing..." />}>
        <CircularProgress size={18} sx={{ color: "text.secondary" }} />
      </Tooltip>
    );
  }

  if (status === "error") {
    return (
      <Tooltip
        title={
          <Typography variant="caption">
            {errorMessage ?? <FormattedMessage defaultMessage="Sync error" />}
          </Typography>
        }
      >
        <ErrorOutlineOutlined fontSize="small" color="error" />
      </Tooltip>
    );
  }

  return (
    <Tooltip title={<FormattedMessage defaultMessage="Google Drive synced" />}>
      <CloudDoneOutlined fontSize="small" sx={{ color: "text.secondary" }} />
    </Tooltip>
  );
};
