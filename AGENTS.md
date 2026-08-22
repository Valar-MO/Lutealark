# Project documentation rule

- Every user-visible feature improvement or change to pages, routes, APIs, data/security behavior, OpenTrek status, configuration, or verified test results must update both `README.md` and `docs/FEATURES.md` in the same change.
- Changes to OpenTrek prompts, workflows, schemas, deployment steps, or evaluation gates must also update `opentrek/README.md`.
- Test counts and verification claims may be updated only after the corresponding commands have actually run.
- Never place APP_KEY values, passwords, session tokens, internal signed URLs, or real user data in documentation, examples, logs, or screenshots.
