import { AppTarget } from "@voquill/types";
import { invoke } from "@tauri-apps/api/core";
import { BaseRepo } from "./base.repo";

export type AppTargetUpsertParams = {
  id: string;
  name: string;
  toneId: string | null;
  iconPath: string | null;
  pasteKeybind: string | null;
};

export abstract class BaseAppTargetRepo extends BaseRepo {
  abstract listAppTargets(): Promise<AppTarget[]>;
  abstract upsertAppTarget(params: AppTargetUpsertParams): Promise<AppTarget>;
  abstract deleteAppTarget(id: string): Promise<void>;
  listAppTargetsAll?(): Promise<AppTarget[]>;
}

export class LocalAppTargetRepo extends BaseAppTargetRepo {
  async listAppTargets(): Promise<AppTarget[]> {
    return invoke<AppTarget[]>("app_target_list");
  }

  async upsertAppTarget(params: AppTargetUpsertParams): Promise<AppTarget> {
    return invoke<AppTarget>("app_target_upsert", {
      args: params,
    });
  }

  async deleteAppTarget(id: string): Promise<void> {
    await invoke<void>("app_target_delete", { id });
  }

  async listAppTargetsAll(): Promise<AppTarget[]> {
    return invoke<AppTarget[]>("app_target_list_all");
  }
}
