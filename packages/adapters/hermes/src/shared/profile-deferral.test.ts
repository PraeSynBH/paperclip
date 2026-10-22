import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE_DEFERRED_RETRY_AFTER_S,
  MAX_PROFILE_DEFERRED_RETRY_AFTER_S,
  PROFILE_DEFERRED_CAPACITY_ERROR_CODE,
  TURN_NOT_ADMITTED_EXIT_CODE,
  readProfileDeferral,
} from "./profile-deferral.js";

const PARKED_STDERR =
  "Gateway deferred: profile_deferred_capacity (retryAfterS=300, retryable=true, profile=nwc): no slot among 17 served of 43 installed (ceiling 17)";
const STREAM_RECORD = JSON.stringify({
  type: "result",
  exit_code: 75,
  duration_ms: 75293,
  error: "Gateway deferred: profile_deferred_capacity (retryAfterS=300, retryable=true, profile=nwc)",
});

describe("readProfileDeferral", () => {
  it("classifies exit 75 as a deferral carrying the ceiling's numbers", () => {
    expect(readProfileDeferral({ exitCode: 75, stdout: STREAM_RECORD, stderr: PARKED_STDERR })).toMatchObject({
      errorCode: PROFILE_DEFERRED_CAPACITY_ERROR_CODE,
      retryAfterS: 300,
      retryable: true,
      profile: "nwc",
      exitCode: TURN_NOT_ADMITTED_EXIT_CODE,
    });
  });

  it("prefers the stderr line so the ceiling evidence survives", () => {
    expect(readProfileDeferral({ exitCode: 75, stdout: STREAM_RECORD, stderr: PARKED_STDERR })?.message).toBe(
      PARKED_STDERR,
    );
  });

  it("still classifies a deferral when the exit status is lost but the reason code is on the wire", () => {
    expect(readProfileDeferral({ exitCode: null, stderr: PARKED_STDERR })).toMatchObject({
      errorCode: PROFILE_DEFERRED_CAPACITY_ERROR_CODE,
      retryAfterS: 300,
    });
  });

  it("falls back to Hermes' default wait and caps an absurd retryAfterS", () => {
    expect(readProfileDeferral({ exitCode: 75, stderr: "Gateway deferred: profile_deferred_capacity" })?.retryAfterS).toBe(
      DEFAULT_PROFILE_DEFERRED_RETRY_AFTER_S,
    );
    expect(
      readProfileDeferral({ exitCode: 75, stderr: "profile_deferred_capacity (retryAfterS=99999999)" })?.retryAfterS,
    ).toBe(MAX_PROFILE_DEFERRED_RETRY_AFTER_S);
  });

  it("leaves ordinary failures alone", () => {
    expect(readProfileDeferral({ exitCode: 1, stderr: "Error: provider exploded" })).toBeNull();
    expect(readProfileDeferral({ exitCode: 0, stderr: "" })).toBeNull();
  });
});
