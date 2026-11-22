# Gradient

Gradient is an idle game about the history of life. You start with a puddle of prebiotic chemistry and end with a self-sustaining planet. On the way you evolve the RNA world, the first true cell (LUCA), photosynthesis, the eukaryotic cell, plastids and multicellular bodies. Every rule in the game is real biochemistry, with a sourced science card behind it.

## How it plays

Each act is a stage in the history of life with its own goal, chemistry and colour theme. When every condition in the goal bar is ticked, an **Advance** button appears; there is no rush, you can keep evolving first. Between acts, an interlude shows a deep-time timeline, your lineage so far and what carried over.

### The acts

| Act | Title | What you are building | Goal |
|---|---|---|---|
| 0 | The spark | A hydrothermal vent and a shallow pond make organics, nucleotides and fatty acids. Wet–dry cycles join nucleotides into RNA. | Grow strands long enough, gather vesicles, and wait for one self-copying strand inside a vesicle. |
| I | Protocells | Replicating ribozymes in fatty-acid vesicles. | Build a lipid-making ribozyme and a proto-ribosome without crossing the error threshold. |
| II | LUCA | Proteins replace ribozymes; DNA, proofreading, ATP synthase and carbon fixation arrive. | Stage 1: assemble LUCA. Stage 2: outlast the vent's hydrogen running out. |
| III | Waste is food | Your bacteria learn to eat sugar; their lactate and H₂ feed the next species you raise. The archaea split off and live on that H₂ (syntrophy). Phages hit whoever is commonest. | Get through the sugar crash as a community: three or more species coexisting, your archaea thriving. |
| IV | The oxygen we made | One branch of your bacteria uses light, first in the dim middle water, then at the surface with day and night. Its oxygen rusts the sea's iron, then builds up. | Carry the community through the oxidation event: archaea moved to the sediment, oxygen breathers established. |
| V | Two become one | Your archaea (host) and your oxygen breathers (partner) merge. Keep the exchange fair; move the partner's genes to the nucleus. | Make the partner an organelle and wrap the genome in a nucleus. |
| VI | Algae and hunters | Your eukaryotes meet your cyanobacteria. One branch keeps a captive (algae), another digests it (hunters); their numbers rise and fall together. | Turn the captive into a chloroplast, keep both branches with the predator–prey waves calm. |
| VII | Many become one | Choose which branch builds a body first: algae (seaweed) or hunters (animals). Cell types, germ and soma, cheating cells. | Separate germ from soma and evolve a developmental network. |
| Finale | Biosphere | Every species you raised, on one planet powered by light. Species lost along the way are missing, and their jobs go undone. | Keep every guild and gas in balance for 300 seconds straight. |

### Currencies

- **Variation** (magenta). The genetic variety your population builds up as it copies itself, with copying errors as its source. Spend it to evolve traits.
- **Biomass** (lime). Living matter. Spend it to expand into new niches so more cells can live.
- **The act's raw material** (the act's colour: fatty acids, amino acids, fixed carbon, light, and so on). Big steps need it as well as Variation.
- In Act 0 you spend raw molecules instead: organics, nucleotides and fatty acids.
- **Reserves** (gold). When an act ends, half your Variation and a tenth of your Biomass carry over, and leftover raw material is stored as Reserves (like the polyphosphate, glycogen or lipid droplets real cells keep). Click the Reserves coin to turn some back into the current act's raw material at half efficiency.
- Owning every upgrade in an act gives a permanent +10% Variation income.

### Evolving traits: the gene pool

1. In the Evolve tab, **release** a trait into the shared gene pool. It costs Variation (and sometimes raw material).
2. Nobody is forced to carry it. Every species picks pooled genes up at its own rate: short genes travel faster than long ones, and some traits change how much a species takes up (in Act I, tighter phospholipid membranes take up less).
3. Cells that gain the same set of genes join one species; a new combination becomes a new species once enough cells share it. Species compete, and selection decides which combinations win.
4. The Gene pool panel shows how far each released gene has spread. A gene that cells keep rejecting is reported.

This follows Woese's idea of an early "Darwinian threshold": before LUCA, genes moved freely between protocells; later the routes narrow (transformation in bacteria, sex in eukaryotes). The hint on each card ("Bottleneck", "Not limiting", "Failed before") is read from the model's flux control coefficients.

### The World: one community across the acts

From Act III on you raise a community, not one species. Every species you raise lives on in later acts as part of the World, and comes back as the key actor: your archaea and oxygen breathers merge in Act V, your eukaryotes eat your cyanobacteria in Act VI.
- The current act's species runs on the full cell model; the World couples it to the others through shared resources (sugar, lactate, H₂, dead cells, oxygen, iron, methane).
- Your success slowly changes the world, and that becomes the next problem: the seeps run dry, acid builds up, the iron sink fills and oxygen rises. Each has a gauge with its danger line.
- **Community traits** (the Community tab in the drawer) found new specialists, move species to safer layers, and improve them.
- Species can be lost: oxygen kills strict anaerobes outside the sediment, and a starved partner escapes. Lost species are missing from later acts and from the finale.

### Achievements and challenges

The **Records** screen holds about 60 achievements in rows by act (each +2% Variation income for good) and seven **act challenges**: replay a finished act with a twist (parasites from the start, half the sugar, little iron…) while your game waits; finishing one is a bigger permanent bonus.

### The genome burden

Every trait takes genome space.
- In Act I, a genome longer than about 1 ÷ (error rate) letters crosses the error threshold. Most copies then break and replication stalls; better copying fidelity raises the threshold.
- Later, the genome is limited by how many genes the copying machinery can handle and by how much energy each gene costs. This is why eukaryotes needed mitochondria.

The Genome panel shows the genome of the species you are viewing as a bar of genes (width = length), dashed ghosts for pooled genes it has not picked up, and lines at its limits. Because every gene costs length, the leanest set that does the job usually wins: not every species should carry everything.

### Screens

- **Cells (or Vessel, Body, Planet).** The live population drawn as line art, in three depth layers. Each cell shows its species' real anatomy, crawls or swims, divides by a furrow that pinches it in two, and bursts when it dies, spilling its contents. Food drifts in the water and is absorbed. **Inside the cell** lists every molecule with its recent level and the levels at which it switches steps on or off, or becomes harmful. Click a species to view its genome and pathway.
- **Pathway.** The cell's metabolism, drawn as a textbook diagram.
  - Molecules are circles, sized by amount.
  - Enzymes are labels on the arrows.
  - +ATP and −ATP tags show energy made or spent.
  - Moving dots show molecules flowing, faster where there is more flux.
  - The red step is the bottleneck.
  - Click anything to inspect it and evolve it in place.
  - Experiment on any enzyme in a test tube: knock it out, inhibit it or make five times more, and see what growth does (your population is not touched).
- **World** (from Act III). An ocean cross-section: sunlit surface, dim middle water and dark sediment, with banded iron building up on the seafloor. Each swarm is one of your species; particles show what passes between them; gauges show what the community is doing to the world; a chart shows everyone's numbers over the last five minutes.
- **Records.** Achievements and act challenges.
- **Lineages.** Your population's family tree. Each branch is a variant; it thickens as it spreads and fades if it dies out. You can zoom it, scroll and drag along time, and rename variants.
- **Codex.** Every science card: the claim, the number and the source, with an evidence level (Established, Likely, Contested or Convenience).

Press **F** (or the Full button in the side bar) for fullscreen: more room without shrinking the text.

## Run

```bash
npm install
npm run dev        # http://localhost:5173  (add ?dev for speed/skip/jump controls in Settings)
npm run build      # content check + typecheck + production build into dist/
npm test           # sim and pathway-layout tests
npm run typecheck
npm run bot -- greedy 0 8 16 1      # headless bot: strategy, first act, last act, max hours, seed
npm run probe:net -- 2               # steady state, conservation and control coefficients of an act's network
npm run probe:svalues -- 2           # selection coefficient of every adaptation in an act
```

## Architecture

The simulation and the interface are separate programs that talk by messages. The sim runs in a Web Worker and owns all game state; the UI sends commands and draws the snapshots it gets back, and never changes game state itself.

```
src/
  main.tsx                  entry: fonts, styles, React root
  content/                  data only: one JSON per act + cards.json (science cards), index.ts loads them
  sim/                      pure TypeScript, no DOM; runs in the worker, in tests and in Node scripts
    game.ts                 the Game class: acts, population, evolution, commands, snapshots (sections listed at the top)
    state.ts                what is saved: save types, newState, migrate
    growth.ts               growth tables over food and their interpolation
    cell.ts, linalg.ts      the cell model: rate laws, stiff solver, steady states, control coefficients
    act0.ts, finale.ts      prebiotic chemistry (Act 0) and the closed biosphere (finale)
    world.ts                the community from Act III on: guilds, shared resources, community traits
    achievements.ts         achievements and act challenges
    designs.ts              cell anatomy chosen from a lineage's traits
    snapshot.ts, types.ts   the message protocol (Snapshot, Command) and the content schema
    num.ts, rng.ts          big numbers and formatting; seeded randomness
    worker.ts               worker entry: tick loop, commands, autosave
  ui/
    App.tsx, store.ts       layout, routing between screens, the zustand store that ingests snapshots
    simClient.ts            worker lifecycle, commands, saves
    hooks.ts, theme.ts      canvas loop, fullscreen; colours, act moods, fonts
    art.ts                  cell line art: interior sprites, live outlines for division and lysis
    map/layout.ts           pathway layout and geometry (pure, tested)
    components/             chrome (top bar, goal bar, nav), drawer panels, overlays, icons
    screens/                one folder or file per screen
      vessel/               Act 0: Vessel.tsx (overlays), vent.ts and pond.ts (scenes), StrandChart.tsx
      CellView, MapView, TreeView, WorldView, Records, Body, Planet, Codex, VirusGame
    styles/                 index.css imports tokens → base → frame → controls → panels → screens
    audio/                  the generative Web Audio score
scripts/
  bot.ts                    headless balance bot
  check-content.mjs         fails the build if a science card lacks a source or evidence level
  tools/                    numeric probes for designing act content
```

- **Cell model** (`cell.ts`): ds/dt = N·v(s) with Michaelis–Menten rate laws, multiplicative regulation, conserved pools enforced by reprojection, a linearly implicit stiff solver, steady states by pseudo-transient continuation, and flux control coefficients (metabolic control analysis).
- **Population** (`game.ts`): competing lineages each have a growth table from their own cell model; dynamics follow the replicator equation in a chemostat; Variation follows V̇ = k·U·g·ln(1+N); background mutations establish with probability 2s.
- **Loading**: the Pathway, Lineages, Codex, Body and Planet screens load on demand; libraries and act content are separate chunks that stay cached between releases.
- **Styles**: one flat design language ("Neon Lab"): near-black panels, one accent per act set on `.app`, fixed currency colours, no `!important` overrides.

Saves are versioned JSON, LZ-compressed in `localStorage`, with an export string. RDKit.js (BSD) draws molecule structures; it ships in `public/rdkit/` and loads lazily.
