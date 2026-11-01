# Decisions

The owner's decisions, numbered, newest last: the newest truth. They win over any design doc or plan that says
otherwise. Backlog items name the decisions they carry (`decisions: "16, 17"`) and design docs name the ones that
outdate them (`superseded_by: [..., "decisions 8, 12"]`): both by number, from this list. Open work is in
[backlog.md](backlog.md), the designs in [design.md](design.md).

**Adding one:** the next number, the date, one short entry in the owner's words (what and why, 1-4 lines). Then
update the docs it outdates and the backlog items it changes. Don't renumber or delete: a decision that replaces an
older one says so ("replaces 9").

Decisions 1-17 were first written in the kick-off notes ([archive/kick-off.md](archive/kick-off.md)), 18 in
[archive/review-2.md](archive/review-2.md).

## 2026-10-10 (kick-off)

1. **Notes sync only over the account:** no peer-to-peer sync between devices; the sync (devices, conflicts,
   history) goes through the account's server in the sync service.
2. **Tags are fine, but flat:** a short list; no nested tags, tag colours or tag rules.
3. **Every edit is saved, both ways:** a local save, and past a tunable delay a server save and a sync.
4. **The editor stops at the page edge** (soft wrap): it wraps long lines, folds code blocks, and only a wide table
   scrolls sideways.
5. **A plain-text core** (markdown underneath) is the direction for the editor.
6. **Record the screenshots against a white background.**
7. **The team's shared notebooks come from the workspace (the Team plan), and it starts with 0 members.** Personal
   notebooks stay private: a share link is read-only.
8. **The search goes into the first run, from day one,** with a better hand-off (the welcome note, the sample
   notebook, the first search, the shortcut hint, the empty state) and a short line explaining why the search is
   local first. The onboarding's pacing changes to fit (the welcome → the sample → the first note; no pile-up of new
   things on the first screen).
9. **Attachments get the new uploader only after the owner signs off on the editor.** (Lifted by 14.)
10. **Every page must load fast, with no spinners:** skeletons and cached lists (notes, tags, notebooks, shares,
    search), prefetching on hover, an instant switch at every click.

## 2026-10-11 (review 2)

38. **An idle tab loses its lock: once the editor is closed, every other device may edit** (owner-decisions 18): with
    the tab closed, the note's lock is released and the other devices edit at once (lock_ttl 0); no slow
    lock-timeout drain.
39. **The weekly digest leaves the free plan** (pricing question 2): the free plan keeps the daily summary (decision 32).
40. **Reminders shrink to a few fixed times** (reminders question 3): morning, noon and evening; the free-form
    reminder picker goes.
41. **The web clipper is in the beta** (clipper question 3): select, clip and file a page into a notebook, a menu
    entry in release 1.
42. **The legacy importer is dropped** (owner-decisions 20): the new importer handles every format (at the old
    importer's speed); a workspace with nothing to import skips it. **A new workspace starts with the tour once the
    owner has tried `?dev=tour` and signed it off** (until then it stays off).
43. **Themes mix as new ones unlock** (2026-10-11, the after-launch question): each new theme joins the earlier ones
    in the picker (light and dark together), and every newly unlocked theme is listed before the ones before it.
44. **The onboarding is a guided tour of a sample notebook** (2026-10-11, after trying `?dev=tour`): the owner walks a
    sample notebook in a guided overlay (the real app below as the backdrop); the overlay stays still and the
    highlights stay within the screen, step by step through the main features. It can be skipped: the tour closes
    and the first empty note opens (as before). Replaces the static welcome page as the onboarding; decision 42's
    sign-off waits for this version. **The tour is the help centre's format** (the steps as data, a fixed order,
    not videos): the onboarding is its preview, and the help centre's guides work the same way. Long guides play in
    the side panel, read while working.
45. **Avatars: a quick fix on step 1** (2026-10-12, avatars.md question 1): keep the live, uploaded image; crop it to
    a circle and clip it to the avatar box (no border below the badge). Step 2 (its own cached thumbnail) later.
79. **Longer trials (B)** (49; trial-length.md): from the second workspace on, every trial gets a third week (~21
    days); the first workspace keeps the short first taste; the pricing follows (about 1.6x the seats).
80. **Trials 1-2 a bit longer** (2026-10-12): more seats and the new limits from trial 1, a real taste of the team
    plan, still free for everyone.
81. **Wider shares also strengthen the audit** (sharing round 4): each level adds a little logging and review, so a
    wider share never makes a note harder to audit.
82. **Trial and grace lengths in data: 14 days of trial, 14 of grace (14/7 to try)** (2026-10-12, refines 79; the owner:
    "about 14 days for trial and 14 for grace ... maybe 21/7.. 21/14 ... 14/14 is the optimum I think, or 14/7"): both
    lengths are plain data (plans.json: trial_days, grace_days), set to 14 days of trial and 14 of grace, with dev
    launches to try 14/14, 14/7 and 21/14 side by side; the owner picks by trying. The first workspace keeps the short
    first taste; from the second the weeks fill the trial's length (the pricing of 79 and 80).
124. **Settings questions 84-92 answered** (2026-10-16, the owner): Walked through one by one: plan prices keep their
    per-seat prices in the config, the plan holds the totals and tools/plan_prices.mjs keeps them equal (84 A); the
    admin extends member, the billing contact extends viewer, the other roles stay plain members; a role today is
    only a badge, a name and texts, and roles with real permissions (export, delete, invite) are a later design talk
    (85); a setting may say ui = false (the app sets it itself): the beta toggle becomes one, the debug, trace and
    demo flags are leftovers that won't return in the release and are removed (86); the export's files are the
    archive's attachments (87 A); every note template (blank, meeting, journal, todo, recipe, project) becomes a
    setting extending template, and the default (its name, folder, shortcut) moves from the config's line into the
    setting's defaults (88 B); a plan's limit stays per plan in plans.json, the workspace has its usage (89 A); notes
    and files archive the same way: the file gets an archive block bound to its notebook and age (file, as notes in
    a folder; later images in the gallery), an archived one comes back on search like a restored note, the trash's
    purge goes and its setting maps to the file's archive age (90, generalised B); the export's file names in
    English are fine (91 A); the welcome note is shown at the first login and doesn't repeat (92 A). And the README
    names tools/design.mjs sync.
125. **Data as generic settings, behaviour as plain functions** (2026-10-16, the owner): Settings and plans stay
    tight, generic and easily extendible: data (settings) read by one generic reader with shared groups and
    per-workspace values, the groups the schema; behaviour (onboarding, reminders, the tour's logic, rules) as plain
    functions with app verbs, branching with plain if, paths between named steps, a named step the saved state. A
    design doc first (docs/design/settings.md), the owner reviews it before any refactor; reader-touching items wait
    for it.
126. **The upload budget is the server's** (2026-10-16, the owner): Q93: the server keeps the upload budget: upload.ts
    never accepts more bytes than the plan's budget (a hard stop after the compression), whatever the client sends;
    the upload test checks the size stays within it.
127. **The editor keeps its preview** (2026-10-16, the owner): Q36 A: the editor keeps its live preview and wins the
    time back elsewhere (11.1 ms a keystroke): the first ~2 ms renders, the syntax colours re-measured, cheaper
    off-screen blocks; no thinning of the preview.
128. **Backlog on GitHub issues (plan-me), docs to the Wiki (docs-me)** (2026-10-25, the owner): The backlog moves to
    GitHub issues, one Projects v2 board per component (api, web, mobile), run by the deterministic tool plan-me (CLI,
    Action, MCP; no AI inside); the markdown backlogs are imported once and then retired. Docs stay in the repository
    and are published one way to the GitHub Wiki by docs-me. Development needs are met by standalone tools LLMs can
    drive efficiently, never by AI-dependent ones.
129. **Decisions as files, managed by plan-me** (2026-11-01, the owner): one file per decision with an index that
    plan-me generates; replaces 10 (a synthetic entry for the tests: the list has no other whole replacement).
