import { describe, it, expect } from "vitest";
import { resolveDefaultAgentInstructionsBundleRole } from "../services/default-agent-instructions.js";

describe("resolveDefaultAgentInstructionsBundleRole", () => {
  it("resolves ceo by name", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "CEO", role: "ceo" });
    expect(result).toBe("ceo");
  });

  it("resolves coo by name", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "COO", role: "cfo" });
    expect(result).toBe("coo");
  });

  it("resolves cto by name", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "CTO", role: "cto" });
    expect(result).toBe("cto");
  });

  it("resolves cpa by name", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "CPA", role: "cfo" });
    expect(result).toBe("cpa");
  });

  it("resolves hr-manager by name", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "HR Manager", role: "cfo" });
    expect(result).toBe("hr-manager");
  });

  it("resolves chief-marketing-officer by name", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "Chief Marketing Officer", role: "agent" });
    expect(result).toBe("chief-marketing-officer");
  });

  it("resolves uxdesigner by name", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "UXDesigner", role: "designer" });
    expect(result).toBe("uxdesigner");
  });

  it("resolves content by name", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "Content", role: "content" });
    expect(result).toBe("content");
  });

  it("resolves uxdesigner by role", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "Unknown", role: "uxdesigner" });
    expect(result).toBe("uxdesigner");
  });

  it("resolves content by role", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "Unknown", role: "content" });
    expect(result).toBe("content");
  });

  it("normalizes whitespace in name", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "  HR   Manager  ", role: "cfo" });
    expect(result).toBe("hr-manager");
  });

  it("falls back to role when name is not recognized", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "Unknown", role: "ceo" });
    expect(result).toBe("ceo");
  });

  it("falls back to role when name is empty", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "", role: "cto" });
    expect(result).toBe("cto");
  });

  it("falls back to default when neither name nor role match", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "Badger", role: "mustelid" });
    expect(result).toBe("default");
  });

  it("falls back to default when both name and role are empty", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "", role: "" });
    expect(result).toBe("default");
  });

  it("falls back to default when agent is fully empty", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({});
    expect(result).toBe("default");
  });

  it("prefers name over role when both map to different bundles", () => {
    // COO has role=cfo but name=COO; name takes priority over role
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "COO", role: "ceo" });
    expect(result).toBe("coo");
  });

  it("resolves coder by name", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "Coder", role: "coder" });
    expect(result).toBe("coder");
  });

  it("resolves coder by role", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "Unknown", role: "coder" });
    expect(result).toBe("coder");
  });

  it("resolves platformengineer by name", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "PlatformEngineer", role: "platformengineer" });
    expect(result).toBe("platformengineer");
  });

  it("resolves platformengineer by role", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "Unknown", role: "platformengineer" });
    expect(result).toBe("platformengineer");
  });

  it("resolves security-engineer by name", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "Security Engineer", role: "engineer" });
    expect(result).toBe("security-engineer");
  });

  it("resolves security-engineer by role", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "Unknown", role: "security-engineer" });
    expect(result).toBe("security-engineer");
  });

  it("resolves qa by name", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "QA", role: "qa" });
    expect(result).toBe("qa");
  });

  it("resolves qa by role", () => {
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "Unknown", role: "qa" });
    expect(result).toBe("qa");
  });

  it("prefers name over role for security-engineer", () => {
    // Security Engineer has role=engineer but name=Security Engineer; name takes priority
    const result = resolveDefaultAgentInstructionsBundleRole({ name: "Security Engineer", role: "engineer" });
    expect(result).toBe("security-engineer");
  });
});