import type {
  AgentMode,
  DictationPillVisibility,
  Nullable,
  PostProcessingMode,
  TranscriptionMode,
} from "./common.types";

export type UserPreferences = {
  userId: string;
  transcriptionMode: Nullable<TranscriptionMode>;
  transcriptionApiKeyId: Nullable<string>;
  transcriptionDevice: Nullable<string>;
  transcriptionModelSize: Nullable<string>;
  postProcessingMode: Nullable<PostProcessingMode>;
  postProcessingApiKeyId: Nullable<string>;
  postProcessingOllamaUrl: Nullable<string>;
  postProcessingOllamaModel: Nullable<string>;
  activeToneId: Nullable<string>;
  gotStartedAt: Nullable<number>;
  gpuEnumerationEnabled: boolean;
  agentMode: Nullable<AgentMode>;
  agentModeApiKeyId: Nullable<string>;
  openclawGatewayUrl: Nullable<string>;
  openclawToken: Nullable<string>;
  lastSeenFeature: Nullable<string>;
  preferredMicrophone: Nullable<string>;
  ignoreUpdateDialog: boolean;
  incognitoModeEnabled: boolean;
  incognitoModeIncludeInStats: boolean;
  dictationLimitMinutes: number;
  dictationPillVisibility: DictationPillVisibility;
  realtimeOutputEnabled: boolean;
  remoteOutputEnabled: boolean;
  remoteTargetDeviceId: Nullable<string>;
  remoteReceiverPort: Nullable<number>;
  remoteReceiverAutoStart: boolean;
  dictationAudioDim: number;
  pasteKeybind: Nullable<string>;
  googleDriveEmail: Nullable<string>;
  googleDriveSyncMode: Nullable<'event' | 'interval' | 'manual'>;
  googleDriveSyncIntervalMinutes: Nullable<number>;
  googleDriveLastSyncedAt: Nullable<string>;
  updatedAt: Nullable<string>;

  // deprecated
  isEnterprise: boolean;
};

/**
 * Subset of UserPreferences that is safe to write to Google Drive.
 * API key IDs and sensitive tokens are intentionally excluded.
 */
export type SyncablePreferences = Omit<
  UserPreferences,
  | 'transcriptionApiKeyId'
  | 'postProcessingApiKeyId'
  | 'agentModeApiKeyId'
  | 'openclawToken'
  | 'openclawGatewayUrl'
  | 'isEnterprise'
>;
