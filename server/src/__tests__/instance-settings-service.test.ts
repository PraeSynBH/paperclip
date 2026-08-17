import { describe, expect, it } from "vitest";
import { normalizeExperimentalSettings } from "../services/instance-settings.js";

describe("instance settings service", () => {
  it("ignores retired experimental flags without resetting current settings", () => {
    expect(normalizeExperimentalSettings({
      enableEnvironments: true,
      enableIsolatedWorkspaces: true,
      enableIssuePlanDecompositions: true,
      enableExperimentalFileViewer: true,
      enableTaskWatchdogs: true,
      enableCloudSync: true,
      enableServerInfoDebugView: true,
      autoRestartDevServerWhenIdle: true,
      enableIssueGraphLivenessAutoRecovery: true,
      issueGraphLivenessAutoRecoveryLookbackHours: 48,
      enableNewestFirstIssueThread: true,
    })).toEqual({
      enableEnvironments: true,
      enableIsolatedWorkspaces: true,
      enableStreamlinedLeftNavigation: true,
      enableConferenceRoomChat: true,
      enableExternalObjects: false,
      enablePipelines: false,
      enableIssuePlanDecompositions: true,
      enableExperimentalFileViewer: true,
      enableTaskWatchdogs: true,
      enableCloudSync: true,
      enableServerInfoDebugView: true,
      autoRestartDevServerWhenIdle: true,
      enableIssueGraphLivenessAutoRecovery: true,
      issueGraphLivenessAutoRecoveryLookbackHours: 48,
    });
  });

  it("defaults enableConferenceRoomChat to true for empty and legacy stored settings (PRA-648)", () => {
    expect(normalizeExperimentalSettings(undefined).enableConferenceRoomChat).toBe(true);
    expect(normalizeExperimentalSettings({}).enableConferenceRoomChat).toBe(true);
    // Rows persisted before the flag existed (PAP-137) must normalize to on in v0.4.0.
    expect(
      normalizeExperimentalSettings({ enableStreamlinedLeftNavigation: true }).enableConferenceRoomChat,
    ).toBe(true);
  });

  it("defaults enableTaskWatchdogs to false for empty and legacy stored settings", () => {
    expect(normalizeExperimentalSettings(undefined).enableTaskWatchdogs).toBe(false);
    expect(normalizeExperimentalSettings({}).enableTaskWatchdogs).toBe(false);
    expect(
      normalizeExperimentalSettings({ enableExperimentalFileViewer: true }).enableTaskWatchdogs,
    ).toBe(false);
  });

  it("defaults enableServerInfoDebugView to false for empty and legacy stored settings", () => {
    expect(normalizeExperimentalSettings(undefined).enableServerInfoDebugView).toBe(false);
    expect(normalizeExperimentalSettings({}).enableServerInfoDebugView).toBe(false);
    expect(
      normalizeExperimentalSettings({ autoRestartDevServerWhenIdle: true }).enableServerInfoDebugView,
    ).toBe(false);
  });

  it("round-trips an enableConferenceRoomChat patch through the update merge (PRA-648)", () => {
    // updateExperimental merges `{ ...normalize(current), ...patch }` and
    // re-normalizes; emulate that to prove the flag survives the roundtrip
    // without disturbing other settings. With the v0.4.0 default of true,
    // the initial state has the flag on.
    const current = normalizeExperimentalSettings({});
    expect(current.enableConferenceRoomChat).toBe(true);

    // Explicitly disable — should survive the roundtrip.
    const disabled = normalizeExperimentalSettings({ ...current, enableConferenceRoomChat: false });
    expect(disabled.enableConferenceRoomChat).toBe(false);
    expect(disabled.enableStreamlinedLeftNavigation).toBe(true);

    // Re-enable — should go back to true.
    const reEnabled = normalizeExperimentalSettings({ ...disabled, enableConferenceRoomChat: true });
    expect(reEnabled.enableConferenceRoomChat).toBe(true);
    expect(reEnabled.enableStreamlinedLeftNavigation).toBe(true);
  });

  it("rejects non-boolean enableConferenceRoomChat values back to the default of true (PRA-648)", () => {
    expect(
      normalizeExperimentalSettings({ enableConferenceRoomChat: "yes" }).enableConferenceRoomChat,
    ).toBe(true);
  });
});
