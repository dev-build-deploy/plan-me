# De Leertoren: decisions

The user's decisions for this game, numbered, newest last. Cite them by number (L1, L2, ...). A new one: add it at
the end with its date, then update design.md and the backlog where it outdates them.

- **L1** (2026-10-16) A learning game for the user's son (8, groep 5): ei/ij, d/t via verlengen, tafels 1–10 and the
  tens, klokkijken (analog and digital). It must be fun, and mistakes get real help.
- **L2** (2026-10-17) A standalone game on the engine only, not inside Birchling.
- **L3** (2026-10-17) A roguelike card game: Slay the Spire's map and cards, Peglin's peg-board shot, a Balatro-style
  combo. Fighting by answering questions.
- **L4** (2026-10-17) Subjects belong to actions: attack = spelling, defence = maths, items = the clock.
- **L5** (2026-10-17) Better cards ask harder questions.
- **L6** (2026-10-17) Questions are randomised (no fixed order between runs).
- **L7** (2026-10-17) The world is seen in first person, like Shroom and Gloom: a 3D place built from many layers of 2D
  cut-out sprites, dense walls (no gaps, no "circle of blobs"), nice lighting; WASD/arrows to walk, the mouse to look;
  choose the path at forks; a minimap of the level.
- **L30** (2026-10-17) A 10-hour polish pass to "really make this AAA" (the user): every screen and interaction at a
  shipped-game standard (feel, readability, motion, lighting, consistency, 60 fps), judged in a real browser; no new
  systems unless they serve the polish.
- **L31** (2026-10-17) The bar for the polish pass (the user): (1) it must look and feel worth paying 30 euros for;
  (2) as addictive and fun as a roguelike without the learning: endless replayability; (3) it must rival all Dutch
  educational software (Squla and more). The learning is in the end the most important part, but the game MUST
  already be fun without it. Refines L30.
- **L32** (2026-10-17) Teaching on a mistake is REALLY important (the user): every wrong answer shows WHY, visually and
  kindly (the rule, a worked example, the right answer built up step by step), then lets the child try the same idea
  again; the item comes back later (L29). This wins over speed and over decoration.
- **L33** (2026-10-17) Useful for learning from groep 1 to groep 8 (the user), not only groep 5: the questions are
  organised by groep (SLO kerndoelen, the methods' order), the child's groep is picked in the parents' portal, and
  the learning record moves a child up or down across groep bands. Groep 1-2 cannot read yet: their questions work
  with pictures (and later voice, see audio-decision). Refines L1, L31.
- **L34** (2026-10-18) The walk is one continuous journey (the user, after a playtest): no jumps from room to room,
  and the world may change in height and width along the way (stairs, hills, slopes, narrow and wide stretches).
  Refines the 3D walk.
- **L35** (2026-10-18) The son's real groep 5 homework comes first (the user listed 24 exercise types): picture to word,
  a word in a sentence with its first letter given, ei/ij, ch(t), the pech-versje, meervoud, hoofdletters, samenstellingen,
  tweetekenklanken, rara wat is het, rijmwoorden, eeuw/ieuw, au/ou, werkwoord herkennen en vinden, uw, vraagteken of
  punt, rebus, aardrijkskundige namen, zelfstandig naamwoord invullen, lidwoord vinden, -eren/-enen/-elen, grondwoord en
  verkleinwoord. The child also writes words, not only chooses. The mapping: docs/design/homework-groep5.md.
- **L36** (2026-10-18) Every homework type the user listed (docs/design/homework-groep5.md: the 24 taal, 3 klok,
  16 wiskunde and 5 other types) is in the game, for variety, and each one is engaging enough to play: an interaction
  with feedback and juice (dragging, tapping, building, colouring, a picture appearing), not a plain question with
  buttons. They all come up in normal runs for a groep 5 child, so the mix stays varied. Refines L31, L35.
- **L54** (2026-10-21) The look, after the first L52 playthrough (the user): the build does not feel consistent nor like
  What the Car meets D&D. The user's reference shots of What the Car? (Guardian and Steam screenshots: the race on the
  cliffs, the waterfall jump, the night race with the goose, the robot chef's kitchen) are the target: flat low-poly
  with chunky rounded shapes, no black ink outlines (edges are colour planes), a muted earthy palette (teal, brick,
  maroon, mustard, cream) with one bright hero colour, deep teal aerial fog, crisp edges. One consistent style over the
  3D world, the characters, the held items and the 2D UI. The 3D must be crisp (not soft or blurry). The dice are 3D
  models thrown with physics, rolling around before they land. Better open-source fonts. The shield is held backwards
  (fix). Refines L52 (its "ink edges" go: the references have none).
- **L66** (2026-10-21) The hands only when they act (the user): the arms, weapon and shield are not in the view by
  default (they take space and add little); they rise into view for a moment when he attacks, blocks, throws the
  dice, grabs loot or cheers, then lower out of view again. Refines l54-hands.
- **L85** (2026-10-27) One hero, built by the player (the user: "what if we would focus on creating the best player
  model, where the player can equip different items (hats, clothing, beards, eyes, accessories, ...) and scale in
  height and weight? We can then offer these things as rewards to the player" and "It will be one hero"): the four
  fixed heroes (Sem, Toon, Roel, Dora) go; one avatar with one base body (L84) scaled in height and weight, and
  equipment slots (hats, clothing, beards, eyes, accessories, ...) filled with items earned as rewards. Refines L80
  (the heroes redo becomes the avatar and its items); L76 (all move the same) holds by itself.
- **L86** (2026-10-27) The dice bag evolves over the whole game (the user: "the player will evolve his/her dice over
  the playtime of the game. Adding a skill in one run to a dice, should keep it there in the next runs (unless
  replaced)"): the bag and the skills placed on its dice's faces persist across runs, saved with the child's profile;
  a run adds to it or replaces a face, never starts it fresh. Changes the roguelike's run shape (design/dice.md,
  design/replayability.md, the balance: tuning and sim).
- **L87** (2026-10-27) The one hero's progress, five answers (the user, one by one, on L85/L86):
  1. A lost run keeps everything: every skill placed on his dice stays, win or lose (L1).
  2. Power creep: both a gentle automatic scaling of the tower with his bag's strength (about half of his growth, so
     he feels stronger) and the Torenhoogte on top for extra challenge and its unlocks.
  3. New dice are kept across runs too; the bag holds 6, and a new die in a full bag replaces one of his choice (its
     faces go with it). This needs (the user) "a much better interface for collecting 'faces' (or skills) in your
     skillbook (or anything D&D like), and the ability to modify dices in a more polished manner (not the strange 2D
     fold-out screen we have today)": a D&D-style skill book of every earned skill, and a 3D dice workbench where he
     turns a die to a face and places a skill on it, replacing today's 2D fold-out net.
  4. Items (hats, clothing, beards, eyes, accessories) change his looks only, never his play.
  5. At the start the basics are free (height, weight, skin tone, hair, eye shape); hats, capes, clothing beyond a
     starter outfit, beards, special eyes and accessories are earned as rewards.
- **L96** (2026-10-27) The parents' portal looks professional, not like the game (the user: "the ouder portaal needs
  to look professional and not styled like the game. Think of professional pages, with statistics, data, metrics,
  charts, ... More details in the type of mistakes made, tips on what to practice more often, ..."): a clean
  analytics style of its own (not the game's panels or fonts): an overview (time, questions, first-try share, trends),
  per challenge kind its rating over time, an analysis of the kinds of mistakes (which wrong answer, classified: ei/ij,
  d/t, a neighbouring table, a missed carry, swapped clock hands, ...), and concrete practice tips in plain Dutch with a
  Focus button (L91.3). The game records each wrong answer and its reason for it (with the ratings' record). The portal stays inside the game (the user: A), in its own
  clean theme with charts drawn by the engine, on every host; a web dashboard can read the same data later (L89.2).
- **L97** (2026-10-27) The parents' portal is an HTML page, not in the game (the user, after weighing it: "agree to
  switch"; replaces L96's "inside the game"): a separate web app (React and a charting library, its own small JS build,
  the game untouched) that reads a versioned JSON export of the profile's learning record (answers, mistake types,
  ratings, sessions); on the web the game's parents' gate opens it in the same browser, reading the record from the
  device's storage, offline, no server; the desktop app writes the JSON and opens it in the system browser. The same
  JSON is what an account's server stores later (L89.2). L96's content (metrics, mistake analysis, tips) stands.
- **L112** (2026-10-28) A PoC of the walk as a dungeon crawl (design/crawl-poc.md) (the user: "make a PoC where you
  WILD into making the game loop where you walk more interesting. Do research into Vampire Crawlers ... The idea would
  be to complete sufficient challenges to unlock the final boss"; "I do not want you to replicate the grid based
  walking btw"; "it would be a mixture of vampire crawlers (or any other dungeon crawler) with overcooked/moving
  out/what the car feeling"): a procedurally generated map of connected rooms, walked freely in 3D (no grid), each
  room a layout (its shape, its entries and exits) with an activity on it (a fight, a drag puzzle, an event, ...), some
  needing a thing fetched from another room; enough challenges cleared open the final boss. Each room plays with
  Overcooked/Moving Out/What the Car? physical comedy (shove, carry, throw, comic failure). A PoC behind a dev flag
  (`?crawl=1`) beside today's road; the user judges it after playing ("I believe that we can create a better immersive
  D&D experience, but I am not sure").
  Refined (the user: "make each room the same size (a square) that can have exits on either direction in the
  middle"): every room is one square of the same size, its exits only in the middle of its sides (N, E, S, W); the
  rooms sit on a lattice, one a cell; the variety comes from what is inside the square (pillars, a pit across, a
  low wall, ...) and which sides open. The hero still walks freely in it (no grid movement).
  Refined (the user: "both players decide which room to move to, and the whole room is always visible on screen so
  that we can have local coop easily - like overcooked"): the camera shows the whole room he is in, always, like
  Overcooked's fixed view of the kitchen (it frames the square, it doesn't follow the hero inside it); moving to the
  next room is a choice the party makes together (in co-op: both at the same doorway), and the camera then moves to
  that room.
- **L124** (2026-10-28) The rooms are twice as big, and the camera follows the hero inside them on every screen (the
  user: "make each room twice the tile size, so that we can easily fit the challenges, while still making compelling
  rooms"; asked whether to keep the whole room always on screen, the user chose the follow camera): rooms 24 m (was
  12 m); the camera follows him within the room on desktop, tablet and phone, showing the whole room for a beat on
  entering and when the map opens (as the phone's camera does, crawl-poc §5.3); L112's whole-room rule is replaced.
  Co-op later (the user: "the camera coudl zoom out in coop; or split"): the camera widens to frame both heroes, and
  splits the screen when they are too far apart to read.
  Refined after the playtest (the user: "the rooms became rather boring now that they are this big"): the lead's call
  (L120, crawl-poc §5.5): the cell goes back to 12 m; a room game that needs the space gets a big room (2x2 = 24 m, or
  1x2), so the challenges still fit; every room gets small things to do on the way (crawl-incidentals). The follow
  camera stays.
- **L125** (2026-11-01) A synthetic entry for the tests (the real list has no whole replacement): the game runs in
  the browser only. Supersedes L2.
