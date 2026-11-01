<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# The dev-build-deploy base glossary

Terms a pull request must explain the first time it uses them. pull-me reads one term per line in the form
`- **term**: explanation`; a repository adds its own in `.github/glossary.md` or in `.pull-me.json`.

- **Conventional Commits**: a format for commit messages, `type(scope): summary`, that tools read to version releases
- **REUSE**: a standard for stating the licence and copyright of every file, checked by `reuse lint`
- **SPDX**: short licence identifiers such as `MIT`, written in a comment at the top of each file
- **SBOM**: software bill of materials, the list of every dependency and its licence
- **ncc**: a tool that bundles a Node.js program and its dependencies into one JavaScript file
- **CodeQL**: GitHub's code scanner, which looks for security bugs
- **SARIF**: a JSON format for the results of code scanners, shown by GitHub code scanning
- **Vale**: a linter for prose, configured with rules written in YAML
- **ruleset**: a set of branch protection rules in GitHub, such as required checks before a merge
