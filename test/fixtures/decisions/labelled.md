# Web app: decisions

The owner's decisions for the web app, numbered, newest last. Cite them by number (L1, L2, ...). A new one: add it at
the end with its date, then update design.md and the backlog where it outdates them.

- **L1** (2026-10-16) A notes app for the owner's team (8 people, one office): meetings, tasks via checklists, files up
  to 10 MB and the calendar, reminders (email and push). It must be quick, and errors get real help.
- **L2** (2026-10-17) A standalone web app on the api only, not inside the desktop client.
- **L3** (2026-10-17) A keyboard-first editor: a command palette, slash commands, a vim-style mode. Navigating by
  typing commands.
- **L4** (2026-10-17) Features belong to plans: sharing = team, history = pro, exports = business.
- **L5** (2026-10-17) Bigger plans get longer history.
- **L6** (2026-10-17) Sample notes are randomised (no fixed order between visits).
- **L7** (2026-10-17) The sidebar is a tree, like a file manager: notebooks built from many levels of folders, dense
  rows (no gaps, no "cloud of tags"), clear icons; arrow keys to move, enter to open; choose the sort at each level;
  a breadcrumb of the path.
- **L30** (2026-10-17) A 10-hour polish pass to "really make this shine" (the owner): every screen and interaction at
  a shipped-product standard (speed, readability, motion, contrast, consistency, 60 fps), judged in a real browser;
  no new systems unless they serve the polish.
- **L31** (2026-10-17) The bar for the polish pass (the owner): (1) it must look and feel worth paying 5 euros for;
  (2) as quick as a plain text editor without the extras: no waiting; (3) it must rival the big notes apps. The
  sync is in the end the most important part, but the app MUST already be good without it. Refines L30.
- **L32** (2026-10-17) Help on an error is REALLY important (the owner): every failed save shows WHY, plainly and
  kindly (the cause, an example, the fix step by step), then lets the user try the same action again; the note is
  kept locally (L29). This wins over speed and over decoration.
- **L33** (2026-10-17) Useful for teams from 1 to 100 people (the owner), not only 8: the plans are organised by
  team size (seats, storage, the admin's needs), the team's size is picked in the admin page, and the usage record
  moves a team up or down across plans. Teams of 1 have no admin: their settings work with defaults (and later
  presets, see presets-decision). Refines L1, L31.
- **L34** (2026-10-18) The editor is one continuous page (the owner, after a test): no jumps from block to block, and
  the page may change in width and layout along the way (columns, tables, wide images, narrow and wide stretches).
  Refines the editor.
- **L35** (2026-10-18) The team's real meeting notes come first (the owner listed 24 note types): agenda to minutes,
  an action item with its owner given, decisions, follow-ups, the weekly report, retros, one-on-ones, stand-ups,
  checklists, project briefs, recipes, reading lists, bookmarks, ideas, journals, travel plans, budgets, contacts,
  invoices, lesson plans, sketches, quotes, a glossary and a changelog. The user also writes free text, not only
  templates. The mapping: docs/design/note-types.md.
- **L36** (2026-10-18) Every note type the owner listed (docs/design/note-types.md: the 24 work, 3 calendar, 16
  personal and 5 other types) is in the app, for variety, and each one is pleasant enough to use: an interaction with
  feedback and polish (dragging, ticking, building, colouring, a preview appearing), not a plain form with buttons.
  They all come up in normal use for a team of 8, so the mix stays varied. Refines L31, L35.
- **L54** (2026-10-21) The look, after the first L52 review (the owner): the build does not feel consistent nor like
  a calm paper notebook. The owner's reference shots (paper notebooks, a desk, a library at night, a kitchen
  whiteboard) are the target: flat surfaces with soft rounded shapes, no heavy borders (edges are colour planes), a
  muted earthy palette (teal, brick, maroon, mustard, cream) with one bright accent colour, gentle shadows, crisp
  edges. One consistent style over the editor, the sidebar, the menus and the dialogs. The text must be crisp (not
  soft or blurry). The icons are drawn with one stroke width, rounded at the ends. Better open-source fonts. The
  search icon is mirrored (fix). Refines L52 (its "heavy borders" go: the references have none).
- **L66** (2026-10-21) The toolbar only when it acts (the owner): the formatting buttons are not in the view by
  default (they take space and add little); they rise into view for a moment when the user selects, pastes, drags,
  uploads or undoes, then lower out of view again. Refines l54-toolbar.
- **L85** (2026-10-27) One profile, built by the user (the owner: "what if we would focus on creating the best
  profile page, where the user can add different items (photos, links, bios, badges, ...) and pick a layout? We can
  then offer these things as rewards to the user" and "It will be one profile"): the four fixed profile layouts go;
  one profile with one base layout (L84) in two sizes, and slots (photos, links, bios, badges, ...) filled with items
  earned as rewards. Refines L80 (the layouts redo becomes the profile and its items); L76 (all look the same) holds
  by itself.
- **L86** (2026-10-27) The workspace evolves over the whole subscription (the owner: "the user will evolve the
  workspace over the lifetime of the account. Adding a template in one notebook should keep it there in the next
  notebooks (unless replaced)"): the templates and the defaults placed on the notebooks persist across notebooks,
  saved with the account; a notebook adds to them or replaces one, never starts them fresh. Changes the notebook's
  shape (design/templates.md, design/defaults.md, the limits: pricing and quotas).
- **L87** (2026-10-27) The one profile's progress, five answers (the owner, one by one, on L85/L86):
  1. A cancelled plan keeps everything: every template placed on the notebooks stays, paid or not (L1).
  2. Power users: both a gentle automatic scaling of the limits with the team's usage (about half of its growth, so
     it feels roomier) and the Pro tier on top for extra room and its features.
  3. New notebooks are kept across plans too; the sidebar holds 6, and a new notebook in a full sidebar replaces one
     of the user's choice (its notes go with it). This needs (the owner) "a much better interface for collecting
     'templates' in your library, and the ability to modify notebooks in a more polished manner (not the strange
     modal we have today)": a library of every earned template, and an editor where the user picks a notebook and
     places a template in it, replacing today's modal.
  4. Badges change the profile's looks only, never its limits.
  5. At the start the basics are free (name, photo, colour, bio, layout); banners, themes, layouts beyond a starter
     set, badges and special icons are earned as rewards.
- **L96** (2026-10-27) The admin page looks professional, not like the app (the owner: "the admin page needs to look
  professional and not styled like the app. Think of professional pages, with statistics, data, metrics, charts,
  ... More details in the type of errors made, tips on what to set up more often, ..."): a clean analytics style of
  its own (not the app's panels or fonts): an overview (time, notes, sync success share, trends), per note type its
  usage over time, an analysis of the kinds of errors (which failed save, classified: offline, conflict, quota, a
  timeout, a lost lock, ...), and concrete setup tips in plain English with a Focus button (L91.3). The app records
  each failed save and its reason for it (with the usage record). The admin page stays inside the app (the owner: A), in its own
  clean theme with charts drawn by the app, on every device; a web dashboard can read the same data later (L89.2).
- **L97** (2026-10-27) The admin page is an HTML page, not in the app (the owner, after weighing it: "agree to
  switch"; replaces L96's "inside the app"): a separate web app (React and a charting library, its own small JS
  build, the app untouched) that reads a versioned JSON export of the workspace's usage record (saves, error types,
  usage, sessions); on the web the app's admin gate opens it in the same browser, reading the record from the
  device's storage, offline, no server; the desktop client writes the JSON and opens it in the system browser. The
  same JSON is what an account's server stores later (L89.2). L96's content (metrics, error analysis, tips) stands.
- **L112** (2026-10-28) A PoC of the board as a kanban view (design/kanban-poc.md) (the owner: "make a PoC where you
  GO WILD into making the way you plan more interesting. Do research into kanban tools ... The idea would be to
  complete sufficient tasks to unlock the next milestone"; "I do not want you to replicate the grid based layout
  btw"; "it would be a mixture of kanban boards with whiteboard/sticky note feeling"): a generated board of connected
  columns, dragged freely (no grid), each column a layout (its width, its entries and exits) with a stage on it (a
  review, a test, a release, ...), some needing a card moved from another column; enough cards done open the next
  milestone. Each column plays with whiteboard and sticky-note feel (drag, stack, throw, undo). A PoC behind a dev
  flag (`?kanban=1`) beside today's list; the owner judges it after trying ("I believe that we can create a better
  planning experience, but I am not sure").
  Refined (the owner: "make each column the same width that can have links on either side in the middle"): every
  column is one strip of the same width, its links only in the middle of its sides (left, right); the columns sit
  on a grid, one a cell; the variety comes from what is inside the column (labels, a divider, a limit, ...) and
  which sides link. The cards still move freely in it (no grid movement).
  Refined (the owner: "both users decide which column to move to, and the whole board is always visible on screen
  so that we can have pairing easily"): the view shows the whole board, always (it frames the board, it doesn't
  follow the card inside it); moving to the next column is a choice the pair makes together (in pairing: both at the
  same card), and the view then moves to that column.
- **L124** (2026-10-28) The columns are twice as wide, and the view follows the card inside them on every screen (the
  owner: "make each column twice the width, so that we can easily fit the cards, while still making compelling
  boards"; asked whether to keep the whole board always on screen, the owner chose the follow view): columns 480 px
  (was 240 px); the view follows the card within the board on desktop, tablet and phone, showing the whole board for
  a beat on opening and when the map opens (as the phone's view does, kanban-poc §5.3); L112's whole-board rule is
  replaced. Pairing later (the owner: "the view coudl zoom out in pairing; or split"): the view widens to frame both
  cards, and splits the screen when they are too far apart to read.
  Refined after the test (the owner: "the columns became rather boring now that they are this wide"): the lead's
  call (L120, kanban-poc §5.5): the column goes back to 240 px; a stage that needs the space gets a wide column (2x
  = 480 px), so the cards still fit; every column gets small things to do on the way (kanban-extras). The follow
  view stays.
- **L125** (2026-11-01) A synthetic entry for the tests (the list has no other whole replacement): the web app runs
  in the browser only. Supersedes L2.
