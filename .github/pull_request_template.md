# Pull Request Template

## Description

<!-- Describe the change and its motivation -->

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Security fix
- [ ] Documentation
- [ ] Dependency update
- [ ] CI/CD / pipeline
- [ ] Refactor

## Security Checklist

- [ ] No secrets, tokens, or API keys in the diff
- [ ] No new dependencies added without `npm audit` review
- [ ] Input handling uses typed interfaces (no raw `any` casts)
- [ ] Sensitive data paths pass through `ContentGuardrails` (if applicable)
- [ ] Tested locally (`npm run typecheck`, `npm run build`)

## ISO 27001 Impact

<!-- Check if this change affects any Annex A controls -->

- [ ] No ISO 27001 control impact
- [ ] A.5 — Organizational controls
- [ ] A.6 — People controls
- [ ] A.7 — Physical controls
- [ ] A.8 — Technological controls

## Related Issues

<!-- Link related issues: [RBR-30](/RBR/issues/RBR-30) -->

## Reviewer Checklist

- [ ] Code follows project conventions
- [ ] No security regressions
- [ ] Tests pass
- [ ] Documentation updated if needed