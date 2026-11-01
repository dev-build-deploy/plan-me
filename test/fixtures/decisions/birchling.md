# Decisions

The user's decisions, numbered, newest last: the newest truth. They win over any design doc or plan that says
otherwise. Backlog items name the decisions they carry (`decisions: "16, 17"`) and design docs name the ones that
outdate them (`superseded_by: [..., "decisions 8, 12"]`): both by number, from this list. Open work is in
[backlog.md](backlog.md), the designs in [design.md](design.md).

**Adding one:** the next number, the date, one short entry in the user's words (what and why, 1-4 lines). Then
update the docs it outdates (CLAUDE.md, "Backlog and design docs": `status`, `superseded_by`, a status note, the
index row) and the backlog items it changes. Don't renumber or delete: a decision that replaces an older one says so
("replaces 9").

Decisions 1-17 were first written in the session 14 handover
([archive/handover-session-14.md](archive/handover-session-14.md)), 18 in
[archive/handover-session-15.md](archive/handover-session-15.md).

## 2026-10-10 (session 13 close)

1. **Upgrades only in the upgrade tree:** no level-up cards during nights; the night's power (toys, levels,
   synergies) is bought with sparkles in the tree's night branch.
2. **Combos are fine, but simple:** a short chain; no juggling, launchers or style meters.
3. **Every hit is physical, both ways:** a push, and past a tunable threshold a tumble (ragdoll) and a get-up.
4. **The swing stops at contact** (real impact): it bounces off hard things, sinks into soft ones, and only a miss
   plays the full follow-through.
5. **A physics-driven body** (the active ragdoll) is the direction for the hero's motion.
6. **Record animations against a white background.**
7. **The night's helpers come from the guild (the Night Watch), and it starts at 0 members.** Ordinary villagers
   don't fight: at dusk they go into their houses to protect themselves.
8. **The fight goes into the story, every night from night one,** with a better transition (dusk: Hazel's warning,
   villagers hurrying home, doors closing, the light going down, the first Gloomies rising) and a story line
   explaining why the villagers hide indoors. The tutorial's pacing changes to fit (the tent → the campfire → night
   one; no pile-up of new things on the first evening).
9. **Gathering gets the combat feel only after the user signs off on combat.** (Lifted by 14.)
10. **Every night must be compelling, exciting, with dopamine bursts:** crowds and mixed kinds with their own attacks
    (biters, goo throwers, slammers, thieves, swarmers), waves that build to a peak, a burst of pops and sparkles at
    every peak.

## 2026-10-11 (session 17)

38. **Standing still loses a night: once the fire is out, every Gloomy hunts the hero** (user-decisions 18): with the
    camp's fire snuffed, the night's creatures stop the camp mischief and come for the hero wherever they are
    (camp_far 0); no slow awake-meter drain.
39. **The evening tunes leave the day loop** (day-loop-options question 2): dusk is the lighting race (decision 32).
40. **Hearts and wishes shrink to a few story wishes** (day-loop-options question 3): hand-written wishes that move the
    story; the generic hearts/wishes loop goes.
41. **The rod's night pull is in the demo** (fishing-play question 3): cast, hook and pull a paddling night creature
    ashore, a night-branch node in beat 1.
42. **A swing's carry is dropped** (user-decisions 20): the stick steers through the whole swing (at the swing's steer
    share); a hero standing still stays still. **A new game starts with the opening night once the user has played
    `?dev=opening_night` and signed it off** (until then it stays off).
43. **Enemies mix as new ones unlock** (2026-10-11, the after-Stone-Peak question): each new enemy kind joins the
    earlier ones in the nights (folk and Gloomies together), and every newly unlocked kind is stronger than the ones
    before it.
44. **The opening fight is an aerial bullet hell against the dragon** (2026-10-11, after playing `?dev=opening_night`):
    the hero rides a great bird on a play plane high above the world (the world below as the backdrop); the camera
    stays still and the hero stays within the screen, twin-stick shooting against the dragon's bullet patterns. It
    can't be won: the hero falls into the sea and wakes at dawn on the small island (as before). Replaces the
    Stone Peak ground battle as the opening; decision 42's sign-off waits for this version. **The sky fight is the
    late game's flying mechanic** (the planes' height above the world, a fixed height, not aeroplanes): the opening is
    its preview, and the late game's flyers fight the same way. Big battles play on the ground below, seen while
    flying.
45. **3D portraits: a quick fix on step 1** (2026-10-12, portraits-3d.md question 1): keep the live, world-lit model;
    turn its face to the camera and clip it to the portrait box (no body below the bubble). Step 2 (its own cached
    render) later.
79. **Longer nights (B)** (49; day-night-pacing.md): from night 2 on, every night gets a third peak (~2:34); night 1
    stays the short first taste; the rebalance follows (about 1.6x the creatures).
80. **Nights 1-2 a bit harder** (2026-10-12): more creatures and the new aggression from night 1, a real dent in the
    awake meter, still winnable by everyone.
81. **Wider glow also strengthens the hold** (lantern-night-payoff round 4): each level adds a little slow and weaken,
    so a wider ring never makes a path harder to hold.
82. **Day and night lengths in data: 3 minutes of day, 3 of night (3/2 to try)** (2026-10-12, refines 79; the user:
    "about 3 min for day and 3 min for night ... maybe 4/2.. 4/3 ... 3/3 is the optimum I think, or 3/2"): both lengths
    are plain data (nights.feel: day_minutes, night_minutes), set to 3:00 of day and 3:00 of night, with dev launches
    to try 3/3, 3/2 and 4/3 side by side; the user picks by playing. Night 1 stays the short first taste; from night 2 the waves fill
    the night's length (the rebalance of 79 and 80).
124. **Entity questions 84-92 answered** (2026-10-16, the user): Walked through one by one: stage costs keep their
    per-piece prices in the assets, the entity holds the stage totals and tools/stage_costs.mjs keeps them equal (84
    A); Bram extends woodcutter, Hazel camper, the other named villagers stay plain villagers; a job today is only a
    look, voice and texts, and jobs with real behaviour (work, tools, pace) are a later design talk (85); an entity
    may say model = false (the game draws its look): the tornado becomes one, the marble, marble_drop and golf_flag
    are sandbox leftovers that won't return in the story and are removed (86); the sky fight's shots are the great
    eagle's attacks (87 A); every tree variant (birch, wide, lean, tall, conifer_tall, conifer_squat) becomes an
    entity extending tree or fir, and the stump (its model, cut height, hinge) moves from the asset's break line into
    the entity's breaks (88 B); a tool's damage stays per tool in tools.lua, the target has its health (89 A); trees
    and rocks grow the same way: the boulder gets a grow block bound to its ground and biome (rock, as trees on grass;
    later palms on the dunes' sand), a broken one comes back elsewhere like a felled tree, the quarry zone's regrowth
    goes and its upgrade maps to the boulder's grow pace (90, generalised B); Pelle's boat mooring bow-in is fine (91
    A); Pelle's greeting lesson is done at the first sale and doesn't replay (92 A). And CLAUDE.md names
    tools/design.mjs sync.
125. **Data as generic components, behaviour as Lua functions** (2026-10-16, the user): Scripts and entities stay
    tight, generic and easily extendible: data (entities) read by one generic field-table reader with shared
    components and per-entity instances, the field tables the schema; behaviour (lessons, story, cutscene logic,
    minds) as real Lua functions with engine verbs, branching with plain if, paths between named steps, a named step
    the saved state. A design doc first (docs/design/scripts-and-entities.md), the user reviews it before any
    refactor; reader-touching items wait for it.
126. **The grass budget is the engine's** (2026-10-16, the user): Q93: the engine keeps the grass budget: grass.c
    never lays out more tufts than grass.feel's budget (a hard stop after the even thinning), whatever the island
    holds; bmeadow checks the count stays within it.
127. **The sky fight keeps its show** (2026-10-16, the user): Q36 A: the sky fight keeps its battle show and wins the
    frame time back elsewhere (11.1 ms natively): the UI's early ~2 ms frames, the bullet looks re-measured, cheaper
    far-view fleet models; no thinning of the show.
128. **Backlog on GitHub issues (plan-me), docs to the Wiki (docs-me)** (2026-10-25, the user): The backlog moves to
    GitHub issues, one Projects v2 board per component (engine, Birchling, De Leertoren), run by the org's own
    deterministic tool plan-me (CLI, Action, MCP; no AI inside); the markdown backlogs are imported once and then
    retired. Docs stay in the repository and are published one way to the GitHub Wiki by docs-me. SDLC needs are met
    by standalone dev-build-deploy tools LLMs can drive efficiently, never by AI-dependent ones (build-it was an
    experiment).
129. **Decisions as files, managed by plan-me** (2026-11-01, the user): one file per decision with an index that
    plan-me generates; replaces 10 (a synthetic entry for the tests: the real list has no whole replacement).
