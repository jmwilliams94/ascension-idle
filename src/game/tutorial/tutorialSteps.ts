// First-login tutorial step list (admin-only for now — see CLAUDE.md). Each
// step spotlights one real button via its `targetId` (matched against a
// `data-tutorial-id` attribute already sitting on that real, production
// element — no synthetic/fake buttons anywhere) and dims everything else.
// `targetId: null` is the two full-dim, no-cutout steps (welcome/completion).
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
// board) rather than being yanked straight to the next spotlight.
export interface TutorialStep {
  id: string
  targetId: string | null
  dialogue: string
  requiresManualAdvance?: boolean
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    targetId: null,
    dialogue: 'Welcome to Ascension Idle! Let’s walk through a few of the basics.',
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
    id: 'forge-tap-socket',
    targetId: 'forge-socket-slot-0',
    dialogue: 'Tap the socket.',
  },
  {
    id: 'forge-tap-gem',
    targetId: 'forge-inventory-grid',
    dialogue: 'Now tap your Iris Gem to place it into the socket.',
  },
  {
    id: 'forge-confirm-socket',
    targetId: 'forge-confirm-socket',
    dialogue: 'Tap Confirm Socket to lock it in.',
  },
  {
    id: 'completion',
    targetId: null,
    dialogue:
      'That’s the basics! The weapon you just upgraded is sitting in your Inventory ready to equip whenever you like. Explore the rest of Ascension Idle at your own pace.',
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
  forgeSelectWeaponQuality: 'forge-select-weapon-quality',
  forgeMaterialFallenStar: 'forge-material-fallenstar',
  forgeConfirmQuality: 'forge-confirm-quality',
  forgeBackToHub: 'forge-back-to-hub',
  forgeTileSockets: 'forge-tile-sockets',
  forgeSelectWeaponSockets: 'forge-select-weapon-sockets',
  forgeTapSocket: 'forge-tap-socket',
  forgeTapGem: 'forge-tap-gem',
  forgeConfirmSocket: 'forge-confirm-socket',
  completion: 'completion',
} as const
