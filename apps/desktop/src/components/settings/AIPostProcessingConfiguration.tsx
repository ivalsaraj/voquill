import { Stack, Typography } from "@mui/material";
import GraphicEqOutlined from "@mui/icons-material/GraphicEqOutlined";
import { useCallback } from "react";
import { FormattedMessage } from "react-intl";
import {
  setPreferredPostProcessingApiKeyId,
  setPreferredPostProcessingMode,
} from "../../actions/user.actions";
import { useAppStore } from "../../store";
import { isCombinedGeminiModeEligible } from "../../utils/combined-mode.utils";
import { getAllowsChangePostProcessing } from "../../utils/enterprise.utils";
import { ManagedByOrgNotice } from "../common/ManagedByOrgNotice";
import { type PostProcessingMode } from "../../types/ai.types";
import {
  SegmentedControl,
  SegmentedControlOption,
} from "../common/SegmentedControl";
import { ApiKeyList } from "./ApiKeyList";
import { VoquillCloudSetting } from "./VoquillCloudSetting";

type AIPostProcessingConfigurationProps = {
  hideCloudOption?: boolean;
};

export function maybeArrayElements<T>(visible: boolean, values: T[]): T[] {
  return visible ? values : [];
}

export const AIPostProcessingConfiguration = ({
  hideCloudOption,
}: AIPostProcessingConfigurationProps) => {
  const postProcessing = useAppStore(
    (state) => state.settings.aiPostProcessing,
  );
  const allowChange = useAppStore(getAllowsChangePostProcessing);

  const showGeminiRecommendation = useAppStore((state) => {
    if (state.settings.aiPostProcessing.mode !== "api") return false;
    const selectedKey = state.settings.apiKeys.find(
      (k) => k.id === state.settings.aiPostProcessing.selectedApiKeyId,
    );
    if (selectedKey?.provider !== "gemini") return false;

    const tMode = state.settings.aiTranscription.mode;
    if (tMode !== "api") return true;

    const tKey = state.settings.apiKeys.find(
      (k) => k.id === state.settings.aiTranscription.selectedApiKeyId,
    );
    if (!tKey || tKey.provider !== "gemini") return true;

    const isAlreadyCombined = isCombinedGeminiModeEligible({
      transcription: {
        mode: "api",
        provider: "gemini",
        apiKeyId: tKey.id,
        transcriptionModel: tKey.transcriptionModel ?? null,
      },
      postProcessing: {
        mode: "api",
        provider: "gemini",
        apiKeyId: selectedKey.id,
        postProcessingModel: selectedKey.postProcessingModel ?? null,
      },
    });
    return !isAlreadyCombined;
  });

  const handleModeChange = useCallback((mode: PostProcessingMode) => {
    void setPreferredPostProcessingMode(mode);
  }, []);

  const handleApiKeyChange = useCallback((id: string | null) => {
    void setPreferredPostProcessingApiKeyId(id);
  }, []);

  if (!allowChange) {
    return <ManagedByOrgNotice />;
  }

  return (
    <Stack spacing={3} alignItems="flex-start" sx={{ width: "100%" }}>
      <SegmentedControl<PostProcessingMode>
        value={postProcessing.mode}
        onChange={handleModeChange}
        options={[
          ...maybeArrayElements<SegmentedControlOption<PostProcessingMode>>(
            !hideCloudOption,
            [
              {
                value: "cloud",
                label: "Voquill",
              },
            ],
          ),
          { value: "api", label: "API" },
          { value: "none", label: "Off" },
        ]}
        ariaLabel="Post-processing mode"
      />

      {postProcessing.mode === "none" && (
        <Typography variant="body2" color="text.secondary">
          <FormattedMessage defaultMessage="No AI post-processing will run on new transcripts." />
        </Typography>
      )}

      {postProcessing.mode === "api" && (
        <ApiKeyList
          selectedApiKeyId={postProcessing.selectedApiKeyId}
          onChange={handleApiKeyChange}
          context="post-processing"
        />
      )}

      {showGeminiRecommendation && (
        <Stack
          direction="row"
          alignItems="flex-start"
          spacing={1.5}
          sx={{
            p: 1.5,
            borderRadius: 1,
            bgcolor: "action.hover",
          }}
        >
          <GraphicEqOutlined
            fontSize="small"
            sx={{ color: "info.main", mt: 0.25 }}
          />
          <Typography variant="caption" color="text.secondary">
            <FormattedMessage defaultMessage="This Gemini key supports transcription too. Set transcription to use the same key for combined mode — one request instead of two, with faster results." />
          </Typography>
        </Stack>
      )}

      {postProcessing.mode === "cloud" && <VoquillCloudSetting />}
    </Stack>
  );
};
