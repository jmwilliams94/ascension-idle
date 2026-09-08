// First-login tutorial step list (admin-only for now — see CLAUDE.md). Each
// step spotlights one real button via its `targetId` (matched against a
// `data-tutorial-id` attribute already sitting on that real, production
// element — no synthetic/fake buttons anywhere) and dims everything else.
// `targetId: null` is the full-dim, no-cutout steps (welcome/completion/the
// socket celebration).
//
// Several steps deliberately reuse the same `targetId` (e.g.
// 'forge-inventory-grid' shows up 5 times, 'forge-confirm' twice) — only one
// instance of any of these is ever mounted at once (whichever Forge
// sub-panel is currently open), so there's no ambiguity, and the different
// `id`s below are what components actually branch on (see
// useTutorialStore's isStepActive) to know which tutorial-guaranteed RPC to
// call.
//
// `requiresManualAdvance` steps show a "Continue" button in the dialogue box
// instead of auto-advancing off some real UI state — used where the player
// needs a moment to actually look at something (the revealed Lucky Lad
// board, the socket-unlock celebration) rather than being yanked straight to
// the next spotlight.
//
// `dialogue` is either one line (the common case) or an array of paragraphs
// for the longer welcome/completion screens — TutorialOverlay renders each
// entry as its own paragraph with normal spacing between them; an empty
// string entry ('') renders as a blank spacer row for extra separation
// between two paragraphs, rather than the usual paragraph gap. Completion's
// '{weaponLevelPhrase}' placeholder is substituted at render time with the
// real current level of the granted tutorial weapon (5 for Wuxia's Backsword
// chain, 8 for Hunter's Bow chain), e.g. "level 5" — or "the required level"
// if it can't be found — see TutorialOverlay.tsx.
export interface TutorialStep {
  id: string
  targetId: string | null
  heading?: string
  dialogue: string | string[]
  requiresManualAdvance?: boolean
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    targetId: null,
    heading: 'Welcome',
    dialogue: [
      'Hi, I’m Jordan — the creator of Ascension Idle. I’ve always wanted to build my own idle game, but never quite found the time to do it justice, until AI came along.',
      'With a lot of help from Claude, that idea finally became this game: a blend of Melvor Idle’s steady progression and Conquer Online’s class fantasy, built as a genuine passion project.',
      '',
      'Welcome — I hope you enjoy playing it as much as I’ve enjoyed building it. Let’s walk through the basics.',
    ],
  },
  {
    id: 'nav-lucky',
    targetId: 'nav-lucky',
    dialogue: 'Every character gets a free roll at Lucky Lad. Tap here to open it.',
  },
  {
    id: 'lucky-free-entry',
    targetId: 'lucky-free-entry',
    dialogue: 'Tap "One Entry" to use your free roll.',
  },
  {
    id: 'lucky-board',
    targetId: 'lucky-board',
    dialogue: 'Tap any chest to open it.',
  },
  {
    id: 'lucky-board-reveal',
    targetId: 'lucky-board',
    dialogue: 'Here’s what was on the board! You won an Experience Potion.',
    requiresManualAdvance: true,
  },
  {
    id: 'nav-forge',
    targetId: 'nav-forge',
    dialogue: 'Nice! Now let’s visit the Forge to strengthen a weapon. Tap here.',
  },
  {
    id: 'forge-tile-standard',
    targetId: 'forge-tile-standard',
    dialogue: 'Tap Forge to upgrade your weapon.',
  },
  {
    id: 'forge-select-weapon-level',
    targetId: 'forge-inventory-grid',
    dialogue: 'A fresh weapon is waiting in your Inventory. Tap it to select it for upgrading.',
  },
  {
    id: 'forge-material-comet',
    targetId: 'forge-inventory-grid',
    dialogue: 'Tap the Comet in your Inventory to begin a Level Upgrade.',
  },
  {
    id: 'forge-confirm-level',
    targetId: 'forge-confirm',
    dialogue: 'Tap Confirm to upgrade your weapon’s level.',
  },
  {
    id: 'forge-socket-celebration',
    targetId: null,
    dialogue: 'Oh my! Did you see those fireworks? You were lucky and just obtained a socket in your weapon!',
    requiresManualAdvance: true,
  },
  {
    id: 'forge-select-weapon-quality',
    targetId: 'forge-inventory-grid',
    dialogue: 'Let’s also improve its quality. Tap your weapon again to select it.',
  },
  {
    id: 'forge-material-fallenstar',
    targetId: 'forge-inventory-grid',
    dialogue: 'Tap the Fallen Star in your Inventory to begin a Quality Upgrade.',
  },
  {
    id: 'forge-confirm-quality',
    targetId: 'forge-confirm',
    dialogue: 'Tap Confirm to upgrade your weapon’s quality.',
  },
  {
    id: 'forge-back-to-hub',
    targetId: 'forge-back',
    dialogue: 'Tap here to go back to the Forge menu.',
  },
  {
    id: 'forge-tile-sockets',
    targetId: 'forge-tile-sockets',
    dialogue: 'Your weapon just unlocked a socket! Tap Sockets to place a gem into it.',
  },
  {
    id: 'forge-select-weapon-sockets',
    targetId: 'forge-inventory-grid',
    dialogue: 'Tap your weapon to select it.',
  },
  {
    id: 'forge-drag-gem-to-socket',
    targetId: 'forge-sockets-drag-area',
    dialogue: 'Drag your Iris Gem straight onto the socket to place it.',
  },
  {
    id: 'forge-confirm-socket',
    targetId: 'forge-confirm-socket',
    dialogue: 'Tap Confirm Socket to lock it in.',
  },
  {
    id: 'nav-idling',
    targetId: 'nav-idling',
    dialogue: 'Great weapon! Let’s put it to use — tap Idling to head out and fight.',
  },
  {
    id: 'combat-mode-switcher',
    targetId: 'combat-mode-switcher',
    dialogue:
      'This switches your character between Hunting and Mining. Only one of your characters can Hunt at a time — any other character on your account can Mine for gems here instead while this one’s off fighting.',
    requiresManualAdvance: true,
  },
  {
    id: 'combat-zone-monster',
    targetId: 'combat-zone-monster',
    dialogue: 'Pick which Zone and Monster to fight here — each zone has its own level range and rewards.',
    requiresManualAdvance: true,
  },
  {
    id: 'combat-fight',
    targetId: 'combat-fight-button',
    dialogue: 'Tap Fight to start hunting!',
  },
  {
    id: 'combat-player-stats',
    targetId: 'combat-player-stats',
    dialogue:
      'You’re hunting now! Your Health (HP) is shown here, and your Mana (MP) below it if your class uses any. Kills earn Gold, EXP, and loot automatically, even while you’re away.',
    requiresManualAdvance: true,
  },
  {
    id: 'completion',
    targetId: null,
    dialogue: [
      'That’s the basics! The weapon you just upgraded is waiting in your Inventory — it’ll be ready to equip once your character reaches {weaponLevelPhrase}.',
      '',
      'From here, it’s all about growing your character: take on events, chase down kills, and grind your way to the top. Explore the rest of Ascension Idle at your own pace!',
    ],
  },
]

export const TUTORIAL_STEP_IDS = {
  welcome: 'welcome',
  navLucky: 'nav-lucky',
  luckyFreeEntry: 'lucky-free-entry',
  luckyBoard: 'lucky-board',
  luckyBoardReveal: 'lucky-board-reveal',
  navForge: 'nav-forge',
  forgeTileStandard: 'forge-tile-standard',
  forgeSelectWeaponLevel: 'forge-select-weapon-level',
  forgeMaterialComet: 'forge-material-comet',
  forgeConfirmLevel: 'forge-confirm-level',
  forgeSocketCelebration: 'forge-socket-celebration',
  forgeSelectWeaponQuality: 'forge-select-weapon-quality',
  forgeMaterialFallenStar: 'forge-material-fallenstar',
  forgeConfirmQuality: 'forge-confirm-quality',
  forgeBackToHub: 'forge-back-to-hub',
  forgeTileSockets: 'forge-tile-sockets',
  forgeSelectWeaponSockets: 'forge-select-weapon-sockets',
  forgeDragGemToSocket: 'forge-drag-gem-to-socket',
  forgeConfirmSocket: 'forge-confirm-socket',
  navIdling: 'nav-idling',
  combatModeSwitcher: 'combat-mode-switcher',
  combatZoneMonster: 'combat-zone-monster',
  combatFight: 'combat-fight',
  combatPlayerStats: 'combat-player-stats',
  completion: 'completion',
} as const
