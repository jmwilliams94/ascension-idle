# Greybox Idle

A Vite + React + TypeScript foundation for a future idle game prototype.

## Structure

- src/components: React UI chrome, including the game canvas host
- src/game: Phaser scenes, entities, and grid math for the game viewport
- src/game/scenes: Phaser scene definitions
- src/game/utils: shared grid helpers and coordinate math

## Current foundation

- Tailwind-based shell with a top bar and side HUD placeholder
- Phaser canvas mounted inside a React component with clean teardown on unmount
- An isometric 10x10 tile grid with a placeholder hero that moves by tile using tweened animation
- Arrow-key and click-to-move controls for the hero
