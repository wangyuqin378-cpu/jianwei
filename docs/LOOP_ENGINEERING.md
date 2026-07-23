# Product completion loop

The project vendors the upstream `loop-engineer` skill under
`.claude/skills/loop-engineer` from commit
`4b9915415e9fcbecab36b2fbd77b59c4a3ebbb7a`. The upstream Bash templates target
Claude Code, so this Windows/Codex project does not execute them blindly. It uses their
evaluator-optimizer contract and five mandatory guardrails directly.

## Pattern

- **Generator:** Codex implements one bounded set of confirmed product fixes.
- **Critic:** Kimi may provide a fresh source-free adversarial review after an explicit external-send
  checkpoint. Its output is untrusted; Codex verifies every finding against source and tests.
- **Anchor/holdout:** real human-reviewed facts, authorized image labels, generated-card audits,
  physical-device runs and cohort reports are independent evidence. Synthetic self-tests always
  state `releaseEvidence=0`.

## Binary exit condition

The loop is complete only when the real evidence file exists and this command exits `0`:

```powershell
node scripts\check-beta-readiness.mjs evaluation\beta-evidence.json
```

The gate directly includes current knowledge readiness and refuses mixed app/model/catalog versions,
hand-entered card/cohort/cloud claims, test signing and automated-only TalkBack evidence. It also
requires the exact evidence bytes to carry a fresh Ed25519 signature from a trusted
`beta_release_approver`; the release CLI loads the repository policy, refuses path overrides, and
requires its exact digest to match protected external `JIANWEI_EVIDENCE_TRUST_POLICY_SHA256`.
Cloud evidence must additionally bind a separately signed `beta_deployment_attestor` receipt for
the endpoint, Function Compute revision, backend Release and actual ACR OCI digest. Changing the
evidence, policy, issuer, key or deployment receipt fails closed. An independent
`beta_assembly_attestor` must also sign the approved manifest plus all eight exact artifact digests
and lengths. Policy validation and the final gate force deployment, assembly, and release roles to
use distinct issuer IDs, key IDs, and Ed25519 SPKI fingerprints. The final eight-artifact assembly
re-verifies the exact deployment-receipt bytes against the repository-pinned Ed25519 policy and
rejects a self-consistent forged cloud result. The release-signed schema v3 evidence binds the
approved assembly-manifest SHA-256; the final checker reloads that manifest and all eight fixed-path
artifacts, verifies the assembly signature, deterministically reassembles them, and requires an exact
match. A single release, assembly, or deployment key therefore cannot produce GO. A passing unit
test, unsigned assembled bundle, or Kimi `GO` is not the exit condition.

## Guardrails

1. **Verifiable exit:** the real Beta evidence gate above.
2. **Iteration cap:** Kimi review rounds default to a hard maximum of 20 and cannot exceed 100.
3. **Budget cap:** each Kimi call is limited to 32,768 output tokens and 50,000 estimated total
   tokens; the script stops before the API call if the cap would be exceeded.
4. **Sandbox:** Kimi receives `SAFE_PACKET` only. Source-snapshot mode is disabled. Local edits stay
   in the user workspace and no unattended push/deploy occurs.
5. **Human checkpoint:** Kimi external send requires `KIMI_EXTERNAL_SEND_CONFIRMED=YES`; signing,
   deploy, fixture upload and every external/irreversible action retain separate explicit checks.
   Knowledge review additionally requires an accountable human workbench session, an explicit
   browser finalization checkbox, and a separate terminal apply command; the workbench cannot apply
   its own output.

Hitting the round or token cap returns a stopped loop, not product completion. The operator must
review the remaining blockers before starting another bounded run.
