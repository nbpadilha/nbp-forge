# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-29
First public release.

### Added
- **Composition engine** (`forge build`): recipes point to reusable **bricks** via
  `<!-- include: <brick> | k=v; k2=v2 -->`; output is a standard, self-contained
  `SKILL.md`/command file carrying a `GENERATED` banner.
- **Parameters & substitution**: `{{var}}` in a brick is replaced by the recipe's value;
  a missing brick or missing parameter is a **build error** (nothing is written).
- A value may contain a literal `;` via the backslash escape `\;` (and a literal `\` via `\\`).
- **Drift-gate** (`forge check`): fails if any generated file was hand-edited or diverged from
  its recipe; CR-insensitive (no false positives from CRLF). `enforceGenerated` flags orphan
  outputs that have no recipe.
- **Lifecycle**: `forge new`, `rename`, `remove` (ref-counted **soft-delete** of the recipe and
  the bricks a skill exclusively owns; shared bricks are kept), `restore`, and `gc` (orphan bricks).
- **Pre-commit hook**: `npm run hooks:install` writes a thin shim delegating to the versioned
  `scripts/hooks/pre-commit` — runs the drift-gate plus a basic secret scan (env files, token-shaped
  strings). Respects `core.hooksPath`.
- **Test suite** (`node --test`, zero deps) covering the engine, lifecycle, and ref-counting.
- Documentation: `README.md`, `SPEC.md`, `SETUP.md`, `SECURITY.md`, and a runnable [`examples/`](examples/) project.

[Unreleased]: https://github.com/nbpadilha/nbp-forge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nbpadilha/nbp-forge/releases/tag/v0.1.0
