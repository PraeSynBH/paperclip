export {
  TEARDOWN_SCOPES,
  TEARDOWN_OP,
  TEARDOWN_ISSUER,
  TEARDOWN_AUDIENCE,
  TEARDOWN_MAX_TTL_SECONDS,
  TEARDOWN_DEFAULT_TTL_SECONDS,
  TEARDOWN_CLOCK_SKEW_SECONDS,
  buildTeardownClaims,
  signTeardownToken,
  verifyTeardownToken,
  deriveTeardownSigningKey,
  mintJti,
  normalizeTeardownScopes,
  type TeardownScope,
  type TeardownOp,
  type TeardownTokenClaims,
  type SignTeardownTokenInput,
  type TeardownJwtHeader,
  type VerifyResult,
} from "./auth.js";

export {
  InMemoryTeardownLedger,
  type TeardownLedger,
  type RedemptionStatus,
  type RedemptionRecord,
  type RedeemResult,
} from "./ledger.js";

export {
  InMemoryApproverResolver,
  checkApprovers,
  type ApproverMember,
  type ApproverResolver,
  type ApproverCheckResult,
} from "./approvers.js";

export {
  InMemoryKillSwitch,
  checkKillSwitch,
  type KillEpoch,
  type KillScope,
  type KillSwitchProbe,
} from "./kill-switch.js";

export {
  InMemoryBreakGlassAfterActionStore,
  RecordingBreakGlassNotifier,
  isAfterActionOverdue,
  BREAK_GLASS_AFTER_ACTION_WINDOW_SECONDS,
  type BreakGlassAfterAction,
  type BreakGlassAfterActionStore,
  type BreakGlassNotifier,
  type BreakGlassNotification,
  type BreakGlassRole,
} from "./break-glass.js";

export {
  TeardownService,
  mintTeardownToken,
  redeemTeardownToken,
  type MintTeardownInput,
  type MintTeardownResult,
  type MintRejectionCode,
  type RedeemTeardownInput,
  type RedeemTeardownResult,
  type RedeemRejectionCode,
  type TeardownServiceDeps,
} from "./service.js";
