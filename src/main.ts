import * as w4 from "./wasm4";

// Constants
const GRAVITY: f32 = 0.4;
const INITIAL_JUMP_FORCE: f32 = -5.5;  // Initial upward velocity
const MIN_JUMP_FORCE: f32 = -3.0;      // Minimum jump height (for short taps)
const MAX_JUMP_FORCE: f32 = -7.0;      // Maximum jump height (for held button)
const JUMP_HOLD_GRAVITY: f32 = 0.25;   // Reduced gravity while holding jump
const MOVE_SPEED: f32 = 1.8;
const GROUND_FRICTION: f32 = 0.8;
const AIR_FRICTION: f32 = 0.95;
const TERMINAL_VELOCITY: f32 = 7.0;
const COYOTE_TIME: u32 = 6; // frames where player can still jump after leaving a platform
const MAX_PLATFORMS: i32 = 20; // maximum number of platforms
const MAX_JUMP_HOLD_FRAMES: u32 = 12; // Maximum frames to hold jump for height control

// Tile system constants
const TILE_SIZE: i32 = 7; // 7x7 tiles for level
const LEVEL_WIDTH: i32 = 23; // 160 / 7 = ~23 tiles wide
const LEVEL_HEIGHT: i32 = 27; // 23 tiles + 4 extra ground rows
const PLAYER_WIDTH: i32 = 8; // 8 pixels wide for player sprites
const PLAYER_HEIGHT: i32 = 12; // 12 pixels tall for player sprites

// Game state
let prevGamepad: u8 = 0;
let cameraY: f32 = 0; // Camera Y position (for vertical scrolling)
let highestPlatformY: i32 = 0; // Track the Y position of the highest platform
let platformsGenerated: i32 = 0; // Track how many platforms have been generated

// Game flow states
enum GameState {
    TitleScreen,
    Playing,
    GameOver
}
let gameState: GameState = GameState.TitleScreen;
let gameOverTimer: u32 = 0; // Timer for game over screen
let showRetryPrompt: boolean = false; // Whether to show "press any key to retry"
let initialLavaY: f32 = 350; // Starting position of lava (farther below screen)

// Lava state
let lavaY: f32 = initialLavaY; // Start with lava far below the screen for title
const LAVA_RISE_SPEED_MIN: f32 = 0.2; // Base speed for lava rise
const LAVA_RISE_SPEED_MAX: f32 = 4.0; // Maximum speed when rubber-banding
const LAVA_RUBBER_BAND_DISTANCE: f32 = 10; // Distance at which rubber-banding begins
let currentLavaSpeed: f32 = LAVA_RISE_SPEED_MIN; // Current speed of the lava
const MAX_LAVA_DROPS: i32 = 10; // Maximum number of lava drops in the stream
const LAVA_STREAM_X: i32 = 140; // X position of the lava stream (right side)

// Lava drop class for the falling stream
class LavaDrop {
    x: f32;
    y: f32;
    size: f32;
    speed: f32;
    xVelocity: f32; // Horizontal movement
    wobblePhase: f32; // For additional side-to-side motion
    wobbleAmount: f32; // How much the drop wobbles

    constructor(y: f32) {
        this.x = f32(LAVA_STREAM_X + (Math.random() * 10) - 5); // Randomize a bit around stream center
        this.y = y;
        this.size = f32(3.0 + Math.random() * 5.0); // Bigger drops: 3-8 pixels
        this.speed = f32(1.5 + Math.random() * 2.0); // Random speed
        this.xVelocity = f32((Math.random() - 0.5) * 0.8); // Random gentle horizontal drift
        this.wobblePhase = f32(Math.random() * 6.28); // Random starting phase (0 to 2π)
        this.wobbleAmount = f32(0.3 + Math.random() * 0.5); // Amount of wobble
    }

    update(): void {
        // Move down with speed
        this.y += this.speed;

        // Apply horizontal movement with wobble effect
        this.x += this.xVelocity;
        this.wobblePhase += 0.1; // Advance wobble phase
        this.x += f32(Math.sin(f64(this.wobblePhase)) * f64(this.wobbleAmount)); // Add wobble motion

        // Keep drops within reasonable bounds of the stream
        if (Math.abs(this.x - f32(LAVA_STREAM_X)) > 20) {
            // Nudge back toward center if drifting too far
            this.x += (f32(LAVA_STREAM_X) - this.x) * 0.05;
        }

        // If hit the lava pool, respawn at top with splash effect
        if (this.y > lavaY - cameraY) {
            // Play splash sound for larger drops (but not for every drop to avoid noise)
            if (this.size > 5.0 && Math.random() < 0.4) {
                w4.tone(300 | (200 << 16), 3, 30, w4.TONE_NOISE);
            }

            this.y = f32(-10 - Math.random() * 20); // Stagger respawn heights
            this.x = f32(LAVA_STREAM_X + (Math.random() * 16) - 8); // More spread for respawning
            this.size = f32(3.0 + Math.random() * 5.0); // Bigger drops
            this.speed = f32(1.5 + Math.random() * 2.0);
            this.xVelocity = f32((Math.random() - 0.5) * 0.8);
            this.wobblePhase = f32(Math.random() * 6.28);
            this.wobbleAmount = f32(0.3 + Math.random() * 0.5);
        }
    }

    draw(): void {
        store<u16>(w4.DRAW_COLORS, 8); // Color 3 (red) for lava

        // Draw bigger oval for larger drops
        const width = u32(this.size);
        const height = u32(this.size * 1.2); // Slightly taller than wide for teardrop effect
        w4.oval(i32(this.x - this.size/2), i32(this.y), width, height);

        // Add a highlight to larger drops
        if (this.size > 5.0) {
            store<u16>(w4.DRAW_COLORS, 1); // Color 0 (light green) for highlight
            w4.oval(i32(this.x - this.size/6), i32(this.y + this.size/4), u32(this.size/4), u32(this.size/4));
        }
    }
}

// Create the lava stream drops
const lavaDrops: LavaDrop[] = [];

// Tile types
enum TileType {
    Empty = 0,
    Solid = 1,
    // Regular platforms (2-4)
    PlatformLeft = 2,
    PlatformMiddle = 3,
    PlatformRight = 4,
    // Jump-through platforms (5-7)
    JumpThroughLeft = 5,
    JumpThroughMiddle = 6,
    JumpThroughRight = 7,
    // Corner tiles for regular platforms (8-9)
    PlatformCornerLeft = 8,
    PlatformCornerRight = 9,
    // Corner tiles for jump-through platforms (10-11)
    JumpThroughCornerLeft = 10,
    JumpThroughCornerRight = 11,
    // Variant middle tiles for platforms (12-13)
    PlatformMiddleVariant1 = 12,
    PlatformMiddleVariant2 = 13,
    // Variant middle tiles for jump-through platforms (14-15)
    JumpThroughMiddleVariant1 = 14,
    JumpThroughMiddleVariant2 = 15
}

// Tile sprites (7x7 pixels)
const tileEmpty = memory.data<u8>([
    0b0000000,
    0b0000000,
    0b0000000,
    0b0000000,
    0b0000000,
    0b0000000,
    0b0000000,
]);

const tileSolid = memory.data<u8>([
    0b1111111,
    0b1111111,
    0b1111111,
    0b1111111,
    0b1111111,
    0b1111111,
    0b1111111,
]);

const tilePlatformLeft = memory.data<u8>([
    0b0000000,
    0b0000000,
    0b0000000,
    0b0000000,
    0b0111111,
    0b1111111,
    0b1111111,
]);

const tilePlatformMiddle = memory.data<u8>([
    0b0000000,
    0b0000000,
    0b0000000,
    0b0000000,
    0b1111111,
    0b1111111,
    0b1111111,
]);

const tilePlatformRight = memory.data<u8>([
    0b0000000,
    0b0000000,
    0b0000000,
    0b0000000,
    0b1111110,
    0b1111111,
    0b1111111,
]);

// Corner tiles for regular platforms
const tilePlatformCornerLeft = memory.data<u8>([
    0b0000000,
    0b0000000,
    0b0000001,
    0b0000011,
    0b0111111,
    0b1111111,
    0b1111111,
]);

const tilePlatformCornerRight = memory.data<u8>([
    0b0000000,
    0b0000000,
    0b1000000,
    0b1100000,
    0b1111110,
    0b1111111,
    0b1111111,
]);

// Variant middle tiles for regular platforms
const tilePlatformMiddleVariant1 = memory.data<u8>([
    0b0000000,
    0b0000000,
    0b0000000,
    0b0001000,
    0b1111111,
    0b1111111,
    0b1111111,
]);

const tilePlatformMiddleVariant2 = memory.data<u8>([
    0b0000000,
    0b0000000,
    0b0000000,
    0b0000000,
    0b1111111,
    0b1110111,
    0b1111111,
]);

// Jump-through platform tiles (player can jump up through these)
const tileJumpThroughLeft = memory.data<u8>([
    0b0000000,
    0b0000000,
    0b0000000,
    0b0000000,
    0b0111111,
    0b0111111,
    0b0110011,
]);

const tileJumpThroughMiddle = memory.data<u8>([
    0b0000000,
    0b0000000,
    0b0000000,
    0b0000000,
    0b1111111,
    0b1111111,
    0b1100111,
]);

const tileJumpThroughRight = memory.data<u8>([
    0b0000000,
    0b0000000,
    0b0000000,
    0b0000000,
    0b1111110,
    0b1111110,
    0b1100110,
]);

// Corner tiles for jump-through platforms
const tileJumpThroughCornerLeft = memory.data<u8>([
    0b0000000,
    0b0000000,
    0b0000001,
    0b0000011,
    0b0111111,
    0b0111111,
    0b0110011,
]);

const tileJumpThroughCornerRight = memory.data<u8>([
    0b0000000,
    0b0000000,
    0b1000000,
    0b1100000,
    0b1111110,
    0b1111110,
    0b1100110,
]);

// Variant middle tiles for jump-through platforms
const tileJumpThroughMiddleVariant1 = memory.data<u8>([
    0b0000000,
    0b0000000,
    0b0000000,
    0b0001000,
    0b1111111,
    0b1111111,
    0b1100111,
]);

const tileJumpThroughMiddleVariant2 = memory.data<u8>([
    0b0000000,
    0b0000000,
    0b0000000,
    0b0000000,
    0b1111111,
    0b1110111,
    0b1100111,
]);

// Level data - 0=empty, 1=solid, 2=platform left, 3=platform middle, 4=platform right
const levelData: u8[] = [
    // Row 0-2 (top of screen) - empty
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,

    // Row 3-4 - first platform
    0,0,2,3,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,

    // Row 5-6 - second platform
    0,0,0,0,0,0,0,0,0,0,0,2,3,3,3,4,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,

    // Row 7-8 - third platform
    0,0,0,0,0,0,2,3,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,

    // Row 9-10 - fourth platform
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,3,3,3,4,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,

    // Row 11-12 - fifth platform
    0,0,0,2,3,3,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,

    // Row 13-14 - sixth platform
    0,0,0,0,0,0,0,0,0,0,0,0,2,3,3,3,3,4,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,

    // Row 15-16 - seventh platform
    0,2,3,3,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,

    // Row 17-18 - eighth platform
    0,0,0,0,0,0,0,0,0,2,3,3,3,3,3,4,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,

    // Row 19-22 - ground
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,

    // Extra rows of ground below the visible area (rows 23-26)
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
];

// Function to get tile at specific coordinates
function getTile(x: i32, y: i32): u8 {
    if (x < 0 || y < 0 || x >= LEVEL_WIDTH || y >= LEVEL_HEIGHT) {
        return 0; // Return empty for out of bounds
    }
    return levelData[y * LEVEL_WIDTH + x];
}

// Convert tile coordinates to world coordinates - x coordinate
function tileToWorldX(tileX: i32): f32 {
    return f32(tileX * TILE_SIZE);
}

// Convert tile coordinates to world coordinates - y coordinate
function tileToWorldY(tileY: i32): f32 {
    return f32(tileY * TILE_SIZE);
}

// Convert world coordinates to tile coordinates - x coordinate
function worldToTileX(worldX: f32): i32 {
    return i32(worldX / f32(TILE_SIZE));
}

// Convert world coordinates to tile coordinates - y coordinate
function worldToTileY(worldY: f32): i32 {
    return i32(worldY / f32(TILE_SIZE));
}

// Check if a tile is solid
function isSolidTile(tileType: u8): boolean {
    return tileType === TileType.Solid;
}

// Check if a tile is a regular platform
function isPlatformTile(tileType: u8): boolean {
    return (tileType >= 2 && tileType <= 4) || // PlatformLeft, Middle, Right
           (tileType >= 8 && tileType <= 9) || // PlatformCornerLeft, CornerRight
           (tileType >= 12 && tileType <= 13); // PlatformMiddleVariant1, Variant2
}

// Check if a tile is a jump-through platform
function isJumpThroughTile(tileType: u8): boolean {
    return (tileType >= 5 && tileType <= 7) || // JumpThroughLeft, Middle, Right
           (tileType >= 10 && tileType <= 11) || // JumpThroughCornerLeft, CornerRight
           (tileType >= 14 && tileType <= 15); // JumpThroughMiddleVariant1, Variant2
}

// Platform class for collision
class Platform {
    x: f32;
    y: f32;
    width: f32;
    height: f32;
    tileTypes: u8[] = [];
    isJumpThrough: boolean = false;

    constructor(x: f32, y: f32, width: f32, height: f32, tileTypes: u8[] = [], isJumpThrough: boolean = false) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.tileTypes = tileTypes;
        this.isJumpThrough = isJumpThrough;
    }

    // draw() method is now handled by the drawGame function with camera support
    draw(): void {
        // This method is no longer used, but kept for compatibility
    }
}

// Create platforms from tilemap
function initPlatforms(): void {
    // Clear existing platforms
    platforms.length = 0;

    // Reset highest platform tracking
    highestPlatformY = LEVEL_HEIGHT;

    // Scan through the tilemap looking for platform sequences
    for (let y = 0; y < LEVEL_HEIGHT; y++) {
        let platformStart = -1;
        let platformTiles: u8[] = [];

        for (let x = 0; x < LEVEL_WIDTH; x++) {
            const tile = getTile(x, y);

            // If this is a platform or solid tile
            if (isPlatformTile(tile) || isSolidTile(tile) || isJumpThroughTile(tile)) {
                // If this is the start of a new platform
                if (platformStart === -1) {
                    platformStart = x;
                }

                // Add this tile to the current platform sequence
                platformTiles.push(tile);
            }
            // If we were building a platform and hit a non-platform tile
            else if (platformStart !== -1) {
                // Calculate platform dimensions
                const worldX = tileToWorldX(platformStart);
                const worldY = tileToWorldY(y);
                const width = f32(platformTiles.length * TILE_SIZE);
                const height = f32(TILE_SIZE);

                // Determine if this is a jump-through platform by checking the first tile type
                const isJumpThroughPlatform = isJumpThroughTile(platformTiles[0]);

                // Create a new platform
                platforms.push(new Platform(worldX, worldY, width, height, platformTiles, isJumpThroughPlatform));

                // Reset for the next platform
                platformStart = -1;
                platformTiles = [];
            }
        }

        // Check if we have a platform at the end of the row
        if (platformStart !== -1) {
            const worldX = tileToWorldX(platformStart);
            const worldY = tileToWorldY(y);
            const width = f32(platformTiles.length * TILE_SIZE);
            const height = f32(TILE_SIZE);

            // Determine if this is a jump-through platform by checking the first tile type
            const isJumpThroughPlatform = isJumpThroughTile(platformTiles[0]);

            platforms.push(new Platform(worldX, worldY, width, height, platformTiles, isJumpThroughPlatform));
        }
    }
}

// Initialize platforms
const platforms: Platform[] = [];
initPlatforms();

// Generate a new platform at a given height
function generatePlatform(yPos: i32): void {
    // Random platform width (3-6 tiles)
    const platformWidth = 3 + Math.floor(Math.random() * 4);

    // Random platform position (leave margin on left and a 20px margin on right for lava stream)
    // 20px is approximately 3 tiles (TILE_SIZE is 7)
    const rightMarginTiles = 3;
    const platformX = i32(1 + Math.floor(Math.random() * (LEVEL_WIDTH - platformWidth - rightMarginTiles - 1)));

    // Create platform tiles array
    const platformTiles: u8[] = [];

    // Decide if this should be a jump-through platform (50% chance after first few platforms)
    const isJumpThrough = (platformsGenerated > 5) && (Math.random() > 0.5);

    // Set the appropriate tile types based on platform type
    if (isJumpThrough) {
        // 20% chance to add a left corner piece
        if (Math.random() < 0.2) {
            platformTiles.push(10); // JumpThroughCornerLeft
        } else {
            platformTiles.push(5); // JumpThroughLeft - standard left edge
        }

        // Middle tiles with variants
        for (let i = 1; i < platformWidth - 1; i++) {
            // Randomly select middle tile variants
            const rand = Math.random();
            if (rand < 0.15) {
                platformTiles.push(14); // JumpThroughMiddleVariant1
            } else if (rand < 0.3) {
                platformTiles.push(15); // JumpThroughMiddleVariant2
            } else {
                platformTiles.push(6); // JumpThroughMiddle - standard middle
            }
        }

        // 20% chance to add a right corner piece
        if (Math.random() < 0.2) {
            platformTiles.push(11); // JumpThroughCornerRight
        } else {
            platformTiles.push(7); // JumpThroughRight - standard right edge
        }
    } else {
        // 20% chance to add a left corner piece
        if (Math.random() < 0.2) {
            platformTiles.push(8); // PlatformCornerLeft
        } else {
            platformTiles.push(2); // PlatformLeft - standard left edge
        }

        // Middle tiles with variants
        for (let i = 1; i < platformWidth - 1; i++) {
            // Randomly select middle tile variants
            const rand = Math.random();
            if (rand < 0.15) {
                platformTiles.push(12); // PlatformMiddleVariant1
            } else if (rand < 0.3) {
                platformTiles.push(13); // PlatformMiddleVariant2
            } else {
                platformTiles.push(3); // PlatformMiddle - standard middle
            }
        }

        // 20% chance to add a right corner piece
        if (Math.random() < 0.2) {
            platformTiles.push(9); // PlatformCornerRight
        } else {
            platformTiles.push(4); // PlatformRight - standard right edge
        }
    }

    // Create and add platform
    const worldX = tileToWorldX(platformX);
    const worldY = tileToWorldY(yPos);
    const width = f32(platformWidth * TILE_SIZE);
    const height = f32(TILE_SIZE);

    platforms.push(new Platform(worldX, worldY, width, height, platformTiles, isJumpThrough));

    // Update highest platform tracking
    if (yPos < highestPlatformY) {
        highestPlatformY = yPos;
    }

    platformsGenerated++;
}

// Player sprites - humanoid character (12x8 pixels, inverted colors)
const playerStanding = memory.data<u8>([
    // 12 rows by 8 columns
    0b11000011, // head
    0b10000001, // head
    0b10100101, // eyes
    0b10000001, // face
    0b11000011, // neck
    0b10000001, // torso
    0b10000001, // torso
    0b10000001, // torso
    0b11000011, // hips
    0b11000011, // legs
    0b10111101, // feet apart
    0b10111101, // feet
]);

const playerRunning1 = memory.data<u8>([
    0b11000011, // head
    0b10000001, // head
    0b10100101, // eyes
    0b10000001, // face
    0b11000011, // neck
    0b10000001, // torso
    0b10000001, // torso
    0b10000001, // torso
    0b11000011, // hips
    0b11100111, // legs running
    0b11100111, // legs
    0b11011011, // feet position 1
]);

const playerRunning2 = memory.data<u8>([
    0b11000011, // head
    0b10000001, // head
    0b10100101, // eyes
    0b10000001, // face
    0b11000011, // neck
    0b10000001, // torso
    0b10000001, // torso
    0b10000001, // torso
    0b11000011, // hips
    0b11000011, // legs running
    0b10111101, // legs
    0b10111101, // feet position 2
]);

const playerJumping = memory.data<u8>([
    0b11000011, // head
    0b10000001, // head
    0b10100101, // eyes
    0b10011001, // excited/surprised face
    0b11000011, // neck (slightly elongated)
    0b10000001, // torso
    0b10000001, // torso (stretched)
    0b10000001, // torso
    0b11000011, // hips
    0b11100111, // legs together
    0b11100111, // legs extended upward
    0b11100111, // feet pointed up
]);

// Jump squat animation (pre-jump, squashed) - shorter version (10 rows instead of 12)
const playerJumpSquat = memory.data<u8>([
    0b11000011, // head
    0b10000001, // head
    0b10100101, // eyes (determined)
    0b10011001, // gritted teeth expression
    0b11000011, // neck
    0b10000001, // torso (wider)
    0b10000001, // torso (compressed)
    0b10000001, // hips (wider)
    0b10111101, // bent legs (wider stance)
    0b11100111, // feet firmly planted
    // Two rows shorter - this will be displayed as 10 rows tall
]);

// Landing animation (squashed on landing)
const playerLanding = memory.data<u8>([
    0b11000011, // head
    0b10000001, // head
    0b10111101, // eyes (squinting from impact)
    0b10111101, // grimace face
    0b11000011, // neck (compressed)
    0b10000001, // torso (wider from impact)
    0b10000001, // torso (wider)
    0b10000001, // torso
    0b10000001, // hips (wider)
    0b10011001, // legs absorbing impact
    0b10000001, // legs bent wide
    0b10111101, // feet planted wide and flat
]);

// Animation state
enum AnimState {
    Standing,
    Running,
    JumpSquat,  // Pre-jump squash
    Jumping,    // Rising
    Falling,    // Falling down
    Landing     // Landing squash
}


// AABB collision detection
function checkCollision(x1: f32, y1: f32, w1: f32, h1: f32, x2: f32, y2: f32, w2: f32, h2: f32): boolean {
    return x1 < x2 + w2 &&
           x1 + w1 > x2 &&
           y1 < y2 + h2 &&
           y1 + h1 > y2;
}

// Player data
class Player {
    x: f32;
    y: f32;
    width: f32;
    height: f32;
    velocityX: f32;
    velocityY: f32;
    isOnGround: boolean;
    animState: AnimState;
    animFrame: u32;
    animCounter: u32;
    facingLeft: boolean;
    coyoteTimeCounter: u32;
    landingTimer: u32;    // Timer for landing animation
    jumpSquatTimer: u32;  // Timer for jump squat animation
    isJumping: boolean;   // Whether player is currently in a jump
    jumpHoldTimer: u32;   // Tracks how long jump button is held
    jumpReleased: boolean; // Whether jump button has been released during jump
    prevJumpButton: boolean; // Track previous frame's jump button state

    constructor() {
        this.x = f32(LEVEL_WIDTH / 2 * TILE_SIZE);
        this.y = 100;
        this.width = f32(PLAYER_WIDTH);
        this.height = f32(PLAYER_HEIGHT);
        this.velocityX = 0;
        this.velocityY = 0;
        this.isOnGround = false;
        this.animState = AnimState.Standing;
        this.animFrame = 0;
        this.animCounter = 0;
        this.facingLeft = false;
        this.coyoteTimeCounter = 0;
        this.landingTimer = 0;
        this.jumpSquatTimer = 0;
        this.isJumping = false;
        this.jumpHoldTimer = 0;
        this.jumpReleased = true;
        this.prevJumpButton = false; // Start with button not pressed
    }

    update(gamepad: u8): void {
        this.updatePhysics(gamepad);
        this.updateAnimation();
    }

    updatePhysics(gamepad: u8): void {
        // Get the just-pressed buttons (not held)
        const justPressed = gamepad & (gamepad ^ prevGamepad);

        // Calculate camera movement this frame for compensation
        const oldCameraY = cameraY;
        // We'll handle camera position changes after updating player state

        // Apply horizontal movement
        if (gamepad & w4.BUTTON_LEFT) {
            this.velocityX = -MOVE_SPEED;
            this.facingLeft = true;
        } else if (gamepad & w4.BUTTON_RIGHT) {
            this.velocityX = MOVE_SPEED;
            this.facingLeft = false;
        } else {
            // Apply friction based on grounded state
            this.velocityX *= this.isOnGround ? GROUND_FRICTION : AIR_FRICTION;

            // Stop tiny movements
            if (Math.abs(this.velocityX) < 0.1) {
                this.velocityX = 0;
            }
        }

        // Get current jump button state
        const jumpButtonPressed = (gamepad & w4.BUTTON_1) !== 0;

        // Detect button press and release transitions
        const jumpButtonJustPressed = jumpButtonPressed && !this.prevJumpButton;
        const jumpButtonJustReleased = !jumpButtonPressed && this.prevJumpButton;

        // Handle jump initiation when button is first pressed
        if (jumpButtonJustPressed && (this.isOnGround || this.coyoteTimeCounter > 0)) {
            // Start jump squat (pre-jump animation)
            if (this.jumpSquatTimer === 0) {
                this.jumpSquatTimer = 3; // 3 frames of jump squat
                this.animState = AnimState.JumpSquat;
                this.jumpReleased = false; // Player is starting a jump with button held
            }
        }

        // Detect when the jump button is released during a jump
        if (jumpButtonJustReleased && this.isJumping && !this.jumpReleased) {
            this.jumpReleased = true;
        }

        // Save current button state for next frame
        this.prevJumpButton = jumpButtonPressed;

        // Process jump squat
        if (this.jumpSquatTimer > 0) {
            this.jumpSquatTimer--;

            // When jump squat is done, apply the initial jump
            if (this.jumpSquatTimer === 0) {
                this.velocityY = INITIAL_JUMP_FORCE; // Start with initial force
                this.isOnGround = false;
                this.coyoteTimeCounter = 0;
                this.animState = AnimState.Jumping;
                this.isJumping = true;
                this.jumpHoldTimer = 0;

                // Play jump sound effect
                w4.tone(200 | (150 << 16), 4, 40, w4.TONE_PULSE1);
            }
        }

        // Variable jump height mechanics
        if (this.isJumping) {
            // If still holding jump button and within max hold time (not released yet)
            if (jumpButtonPressed && !this.jumpReleased && this.jumpHoldTimer < MAX_JUMP_HOLD_FRAMES) {
                // Apply reduced gravity while holding jump to gain more height
                this.velocityY += JUMP_HOLD_GRAVITY;
                this.jumpHoldTimer++;

                // Calculate how far through the jump hold we are (0.0 to 1.0)
                const jumpProgress = f32(this.jumpHoldTimer) / f32(MAX_JUMP_HOLD_FRAMES);

                // Smoothly interpolate between MIN_JUMP_FORCE and MAX_JUMP_FORCE based on hold time
                const targetForce = MIN_JUMP_FORCE + (MAX_JUMP_FORCE - MIN_JUMP_FORCE) * jumpProgress;

                // Apply the interpolated force if it would make us go higher (more negative velocity)
                if (targetForce < this.velocityY) {
                    this.velocityY = targetForce;
                }
            } else {
                // Apply normal gravity once jump button is released or max hold time reached
                this.velocityY += GRAVITY;
            }

            // End jump state when velocity becomes positive (falling)
            if (this.velocityY >= 0) {
                this.isJumping = false;
                this.animState = AnimState.Falling;
            }
        } else if (!this.isOnGround) {
            // Apply normal gravity when not jumping and not on ground
            this.velocityY += GRAVITY;
            // Note: Coyote time is now managed in the ground detection section
        }

        // Clamp terminal velocity
        if (this.velocityY > TERMINAL_VELOCITY) {
            this.velocityY = TERMINAL_VELOCITY;
        }

        // Save old position for collision resolution
        // Note: We're storing absolute world positions, not screen positions
        const oldX = this.x;
        const oldY = this.y;

        // Update position
        this.x += this.velocityX;
        this.y += this.velocityY;

        // Reset grounded state before checking collisions
        const wasOnGround = this.isOnGround;
        this.isOnGround = false;

        // Check for platform collisions
        for (let i = 0; i < platforms.length; i++) {
            const platform = platforms[i];

            // Check if positions overlap
            if (checkCollision(this.x, this.y, this.width, this.height,
                              platform.x, platform.y, platform.width, platform.height)) {

                // For jump-through platforms, special handling
                if (platform.isJumpThrough) {
                    // Only check top collision (landing) for jump-through platforms
                    const feetY = this.y + this.height;
                    const platformTopY = platform.y;

                    // If feet were above the platform in the previous frame and now they're passing through
                    // Note: oldY doesn't include camera movement that happened between frames, so we need to account for that
                    if (oldY + this.height <= platformTopY && feetY > platformTopY && this.velocityY > 0) {
                        // Land on the platform
                        this.y = platformTopY - this.height;
                        this.velocityY = 0;
                        this.isOnGround = true;
                        this.isJumping = false;
                        this.jumpHoldTimer = 0;
                        this.jumpReleased = true;

                        // Play landing sound if we weren't on ground before
                        if (!wasOnGround) {
                            w4.tone(80 | (60 << 16), 5, 50, w4.TONE_NOISE);
                        }
                    }

                    // Skip other collision checks for jump-through platforms
                    continue;
                }

                // For regular platforms, check all collision directions
                // Determine collision direction
                const overlapLeft = this.x + this.width - platform.x;
                const overlapRight = platform.x + platform.width - this.x;
                const overlapTop = this.y + this.height - platform.y;
                const overlapBottom = platform.y + platform.height - this.y;

                // Find the smallest overlap to determine collision direction
                let minOverlap = overlapLeft;
                let collisionDir = 0; // 0=left, 1=right, 2=top, 3=bottom

                if (overlapRight < minOverlap) {
                    minOverlap = overlapRight;
                    collisionDir = 1;
                }
                if (overlapTop < minOverlap) {
                    minOverlap = overlapTop;
                    collisionDir = 2;
                }
                if (overlapBottom < minOverlap) {
                    minOverlap = overlapBottom;
                    collisionDir = 3;
                }

                // We've separated jump-through platform handling above
                // This is now only for regular platforms
                // Only register collisions if we were previously not inside the platform
                // This prevents getting stuck inside platforms
                if (collisionDir === 0 && this.velocityX > 0 &&
                    !checkCollision(oldX, oldY, this.width, this.height,
                                  platform.x, platform.y, platform.width, platform.height)) {
                    // Left collision
                    this.x = platform.x - this.width;
                    this.velocityX = 0;
                }
                else if (collisionDir === 1 && this.velocityX < 0 &&
                         !checkCollision(oldX, oldY, this.width, this.height,
                                       platform.x, platform.y, platform.width, platform.height)) {
                    // Right collision
                    this.x = platform.x + platform.width;
                    this.velocityX = 0;
                }
                else if (collisionDir === 2 && this.velocityY > 0) {
                    // Top collision (player is landing on platform)
                    // We've already handled jump-through platforms with special logic

                    this.y = platform.y - this.height;
                    this.velocityY = 0;
                    this.isOnGround = true;

                    // Reset jump-related variables on landing
                    this.isJumping = false;
                    this.jumpHoldTimer = 0;
                    this.jumpReleased = true;

                    // Play landing sound if we weren't on ground before
                    if (!wasOnGround) {
                        w4.tone(80 | (60 << 16), 5, 50, w4.TONE_NOISE);
                    }
                }
                else if (collisionDir === 3 && this.velocityY < 0) {
                    // Bottom collision (player is hitting head on platform)
                    // We've already handled jump-through platforms with special logic
                    this.y = platform.y + platform.height;
                    this.velocityY = 0;
                }
            }
        }

        // More robust ground detection - check a bit below the player
        const tileX = worldToTileX(this.x + this.width / 2);
        const tileY = worldToTileY(this.y + this.height + 1); // Check slightly below the player
        const belowTile = getTile(tileX, tileY);

        // Determine if we're on ground
        // For jump-through tiles, we need to check if the player's feet are actually on top
        // Additional ground check - see if any platform is directly beneath the player
        let onPlatform = false;
        let platformBelowY: f32 = 0;

        // Check all platforms to see if the player is standing on one
        for (let i = 0; i < platforms.length; i++) {
            const platform = platforms[i];

            // Only check if player's feet are at or slightly above the platform
            const feetY = this.y + this.height;
            const platformTopY = platform.y;
            // More lenient tolerance when camera is moving up (5 pixels)
            const tolerance = 5;
            const withinY = Math.abs(feetY - platformTopY) <= tolerance;

            // Check if player is horizontally over this platform
            const playerCenterX = this.x + this.width / 2;
            const overPlatform =
                playerCenterX >= platform.x &&
                playerCenterX <= platform.x + platform.width;

            if (withinY && overPlatform && this.velocityY >= 0) {
                onPlatform = true;
                platformBelowY = platformTopY;
                break;
            }
        }

        // For tile-based ground detection, check for solid and regular platform tiles
        const onTileGround = isSolidTile(belowTile) || isPlatformTile(belowTile);

        // Combine both ground detection methods
        const onGround = onTileGround || onPlatform;

        if (onGround && this.velocityY >= 0) {
            // Only snap to ground if we're moving down or already on ground
            if (onPlatform) {
                // Use the platform's Y position for more precise snapping
                this.y = platformBelowY - this.height;
            } else {
                // Use the tile-based position
                const worldY = tileToWorldY(tileY);
                this.y = worldY - this.height;
            }
            this.velocityY = 0;

            if (!this.isOnGround) {
                this.isOnGround = true;

                // Reset jump-related variables on landing
                this.isJumping = false;
                this.jumpHoldTimer = 0;
                this.jumpReleased = true;

                // Start landing animation if falling fast enough
                if (this.velocityY > 3) {
                    this.landingTimer = 5; // 5 frames of landing squash
                    this.animState = AnimState.Landing;
                }

                // Play landing sound effect (only when newly landing)
                w4.tone(80 | (60 << 16), 5, 50, w4.TONE_NOISE);
            }
        } else if (this.isOnGround) {
            // We just left the ground, start coyote time
            this.coyoteTimeCounter = COYOTE_TIME;
            this.isOnGround = false;
        }

        // Manage coyote time counter
        if (!this.isOnGround && this.coyoteTimeCounter > 0) {
            this.coyoteTimeCounter--;
        }

        // Screen boundaries
        if (this.x < 0) {
            this.x = 0;
            this.velocityX = 0;
        } else if (this.x + this.width > f32(w4.SCREEN_SIZE)) {
            this.x = f32(w4.SCREEN_SIZE) - this.width;
            this.velocityX = 0;
        }
    }

    updateAnimation(): void {
        // Manage landing animation timer
        if (this.landingTimer > 0) {
            this.landingTimer--;
            this.animState = AnimState.Landing;

            // When landing animation is done, go back to standing
            if (this.landingTimer === 0) {
                if (Math.abs(this.velocityX) > 0.1) {
                    this.animState = AnimState.Running;
                } else {
                    this.animState = AnimState.Standing;
                }
            }
            return; // Skip other animation determination while landing
        }

        // Skip other animation states during jump squat
        if (this.jumpSquatTimer > 0) {
            this.animState = AnimState.JumpSquat;
            return;
        }

        // Determine animation state (only if not in landing or jump squat)
        if (this.isOnGround) {
            if (Math.abs(this.velocityX) > 0.1) {
                this.animState = AnimState.Running;
            } else {
                this.animState = AnimState.Standing;
            }
        } else {
            if (this.velocityY < 0) {
                this.animState = AnimState.Jumping;
            } else if (this.velocityY > 0) {
                this.animState = AnimState.Falling;
            }
            // If velocity is exactly 0, keep the current state
        }

        // Update animation counters
        this.animCounter++;
        if (this.animState == AnimState.Running && this.animCounter >= 6) {
            this.animCounter = 0;
            this.animFrame = (this.animFrame + 1) % 2;
        }
    }

    draw(): void {
        // DRAW_COLORS: bits 0-1 = foreground color (3), bits 2-3 = background color (0)
        store<u16>(w4.DRAW_COLORS, 8); // 8 = 0b1000 = color 3 (red) in foreground

        // Choose sprite based on animation state
        let sprite: usize;
        let width = PLAYER_WIDTH;
        let height = PLAYER_HEIGHT;

        // Apply squash and stretch effects - using vertical offset instead of scaling
        let yOffset: i32 = 0;

        switch (this.animState) {
            case AnimState.Standing:
                sprite = playerStanding;
                break;

            case AnimState.Running:
                sprite = this.animFrame == 0 ? playerRunning1 : playerRunning2;
                break;

            case AnimState.JumpSquat:
                sprite = playerJumpSquat;
                // Use the actual shorter sprite height (10 rows)
                height = 10;
                // Align bottom of sprite with floor (so feet stay at same level)
                yOffset = PLAYER_HEIGHT - 10;
                break;

            case AnimState.Jumping:
                sprite = playerJumping;
                // Simulate stretch by shifting up slightly
                yOffset = -2;
                break;

            case AnimState.Falling:
                sprite = playerJumping;
                // No y-offset for falling
                break;

            case AnimState.Landing:
                sprite = playerLanding;
                // Simulate heavy squash
                yOffset = 3;
                break;

            default:
                sprite = playerStanding;
        }

        // Draw player with correct facing direction and camera offset
        const flags = this.facingLeft ? w4.BLIT_FLIP_X : 0;
        // Apply the y-offset and use the dynamic height for special animations
        // The player's Y position is offset by the camera position
        w4.blit(sprite, i32(this.x), i32(this.y - cameraY) + yOffset, u32(width), u32(height), w4.BLIT_1BPP | flags);
    }
}

// Create player instance
const player = new Player();

// Initialize lava drops
function initLavaDrops(): void {
    lavaDrops.length = 0; // Clear any existing drops
    for (let i = 0; i < MAX_LAVA_DROPS; i++) {
        // Distribute drops evenly from top to bottom of screen
        const yPos = f32(i * (w4.SCREEN_SIZE / MAX_LAVA_DROPS));
        lavaDrops.push(new LavaDrop(yPos));
    }
}

// Function to start the game from title screen
function startGame(): void {
    gameState = GameState.Playing;

    // Reset lava to starting position (which is higher than title screen position)
    lavaY = 250;

    // Start lava speed at a trickle
    currentLavaSpeed = LAVA_RISE_SPEED_MIN * 0.2; // Very slow at first

    // Restore full set of lava drops
    initLavaDrops();

    // Play game start sound
    w4.tone(300 | (400 << 16), 8, 80, w4.TONE_TRIANGLE);
}

// Initialize the game
// Set lava position to starting position for title screen
lavaY = initialLavaY;
// Start with zero lava movement
currentLavaSpeed = 0;
// Initialize initial lava drops (fewer for title screen)
lavaDrops.length = 0;
for (let i = 0; i < MAX_LAVA_DROPS / 2; i++) {
    // Distribute drops evenly from top to bottom of screen
    const yPos = f32(i * (w4.SCREEN_SIZE / (MAX_LAVA_DROPS / 2)));
    lavaDrops.push(new LavaDrop(yPos));
}
// Set initial game state
gameState = GameState.TitleScreen;

// Game update function - runs at 60fps
export function update(): void {
    // Set the 4-color palette (indices 0-3)
    store<u32>(w4.PALETTE, 0xe2f3b3);     // Color 0: Light green (background)
    store<u32>(w4.PALETTE + 4, 0x306850); // Color 1: Dark green (platforms)
    store<u32>(w4.PALETTE + 8, 0x000000); // Color 2: Black (player)
    store<u32>(w4.PALETTE + 12, 0xd13b27); // Color 3: Red (text/accents)

    // Clear screen with color 0 (background color)
    store<u16>(w4.DRAW_COLORS, 1); // DRAW_COLORS uses 1-based indexing for colors
    w4.rect(0, 0, w4.SCREEN_SIZE, w4.SCREEN_SIZE);

    // Read gamepad
    const gamepad = load<u8>(w4.GAMEPAD1);

    // Get the just-pressed buttons (not held)
    const justPressed = gamepad & (gamepad ^ prevGamepad);

    // Handle game state transitions based on input
    if (gameState === GameState.TitleScreen) {
        // Start the game when any button is pressed on title screen
        if (justPressed !== 0) {
            startGame();
        }

        // Even on the title screen, we still update player and basic physics
        // but lava doesn't move up yet
        updateCamera();
        player.update(gamepad);

        // Just update lava drops, not the rising lava
        for (let i = 0; i < lavaDrops.length; i++) {
            lavaDrops[i].update();
        }
    }
    else if (gameState === GameState.Playing) {
        // Normal gameplay updates
        updateCamera();
        player.update(gamepad);
        updateLava();
        checkLavaCollision();
        checkGeneratePlatforms();
        cleanupOffscreenPlatforms();
    }
    else if (gameState === GameState.GameOver) {
        // Update the game over timer
        gameOverTimer++;

        // Show retry prompt after 60 frames (1 second)
        if (gameOverTimer > 60 && !showRetryPrompt) {
            showRetryPrompt = true;
        }

        // If retry prompt is showing and any button is pressed, restart
        if (showRetryPrompt && justPressed !== 0) {
            resetGame();
        }

        // Keep updating lava drops for visual effect
        for (let i = 0; i < lavaDrops.length; i++) {
            lavaDrops[i].update();
        }
    }

    // Draw game
    drawGame();

    // Store current gamepad state for next frame
    prevGamepad = gamepad;
}

// Update camera to follow player vertically
function updateCamera(): void {
    // Target position: keep player in the middle of the screen vertically
    // But only follow upward movement, never move camera down
    const targetCameraY = player.y - f32(w4.SCREEN_SIZE / 2);

    // If player is above the middle of the screen, adjust camera
    if (targetCameraY > cameraY) {
        // Immediate camera follow for falling player
        cameraY = targetCameraY;
    } else {
        // Smooth camera follow for rising player
        cameraY = cameraY + (targetCameraY - cameraY) * 0.1;
    }
}

// Check if we need to generate more platforms
function checkGeneratePlatforms(): void {
    // We want platforms to extend above the screen
    // Determine the highest visible position in tile coordinates
    const highestVisibleTile = worldToTileY(cameraY);

    // If we need more platforms (leaving some buffer space)
    if (highestVisibleTile - 8 < highestPlatformY) {
        // Generate platforms going upward
        // Start at the current highest platform - some gap
        const startY = highestPlatformY - 3; // Gap of 3 tiles

        // Generate multiple platforms with increasing height
        for (let y = startY; y > highestVisibleTile - 15; y -= i32(2 + Math.floor(Math.random() * 3))) {
            generatePlatform(y);
        }
    }
}

// Clean up platforms that are far below the screen
function cleanupOffscreenPlatforms(): void {
    // Calculate the lowest visible position plus some buffer
    const lowestVisibleY = cameraY + f32(w4.SCREEN_SIZE + 50);

    // Check each platform and remove if too low
    for (let i = platforms.length - 1; i >= 0; i--) {
        if (platforms[i].y > lowestVisibleY) {
            // Remove platform
            platforms.splice(i, 1);
        }
    }
}

// Update the lava (rising pool and falling drops)
function updateLava(): void {
    // Calculate the lava's distance from the bottom of the screen
    const lavaScreenDist = lavaY - (cameraY + f32(w4.SCREEN_SIZE));

    // If lava is too far below the screen, apply rubber-band effect
    if (lavaScreenDist > LAVA_RUBBER_BAND_DISTANCE) {
        // Calculate how much to speed up the lava (0.0 to 1.0 factor)
        // Using a squared factor gives more aggressive acceleration
        const linearFactor = Math.min(
            (lavaScreenDist - LAVA_RUBBER_BAND_DISTANCE) / LAVA_RUBBER_BAND_DISTANCE,
            1.0
        );
        // Cubic function for extremely aggressive acceleration
        const rubberBandFactor = linearFactor * linearFactor * linearFactor;

        // Interpolate between min and max speeds based on rubber-band factor
        // Add a super-speed mode when extremely far behind
        if (lavaScreenDist > LAVA_RUBBER_BAND_DISTANCE * 15) {
            // When extremely far behind, move at maximum speed plus a boost
            currentLavaSpeed = LAVA_RISE_SPEED_MAX * 1.5;
        } else {
            // Normal rubber-band interpolation
            currentLavaSpeed = LAVA_RISE_SPEED_MIN +
                f32(rubberBandFactor) * (LAVA_RISE_SPEED_MAX - LAVA_RISE_SPEED_MIN);
        }

        // Play warning sound when rubber-banding
        if (lavaScreenDist > LAVA_RUBBER_BAND_DISTANCE * 15) {
            // More frequent and urgent sound for super-speed mode
            if (i32(lavaY) % 15 === 0) {
                // Higher pitch alarm sound
                w4.tone(400 | (300 << 16), 5, 20, w4.TONE_PULSE1);
            }
        } else if (i32(lavaY) % 30 === 0) {
            // Standard warning for normal rubber-band mode
            w4.tone(100 | (80 << 16), 4, 10, w4.TONE_PULSE2);
        }
    } else {
        // Reset to base speed when close enough
        currentLavaSpeed = LAVA_RISE_SPEED_MIN;
    }

    // Raise the lava pool at the calculated speed
    lavaY -= currentLavaSpeed;

    // Update all lava drops in the stream
    for (let i = 0; i < lavaDrops.length; i++) {
        lavaDrops[i].update();
    }
}

// Check if player collides with lava (either pool or drops)
function checkLavaCollision(): void {
    // Check if player touches the lava pool
    if (player.y + player.height > lavaY) {
        // Player touched the lava pool - game over!
        resetGame();
    }

    // Check if player touches any lava drop
    for (let i = 0; i < lavaDrops.length; i++) {
        const drop = lavaDrops[i];

        // Simple circle-rectangle collision
        const dropCenterX = drop.x;
        const dropCenterY = drop.y + drop.size / 2;
        const dropRadius = drop.size / 2;

        // Find closest point on player's rectangle to the drop's center
        const closestX = Math.max(player.x, Math.min(dropCenterX, player.x + player.width));
        const closestY = Math.max(player.y, Math.min(dropCenterY, player.y + player.height));

        // Calculate distance between closest point and drop center
        const distanceX = dropCenterX - closestX;
        const distanceY = dropCenterY - closestY;
        const distanceSquared = distanceX * distanceX + distanceY * distanceY;

        // Check if distance is less than drop radius
        if (distanceSquared < dropRadius * dropRadius) {
            // Player touched a lava drop - game over!
            resetGame();
        }
    }
}

// Draw a text box with a border
function drawTextBox(text: string[], x: i32, y: i32, width: i32, height: i32): void {
    // Draw box background
    store<u16>(w4.DRAW_COLORS, 2); // Dark green for background
    w4.rect(x, y, width, height);

    // Draw border
    store<u16>(w4.DRAW_COLORS, 8); // Red for border
    w4.rect(x, y, width, 1); // Top
    w4.rect(x, y + height - 1, width, 1); // Bottom
    w4.rect(x, y, 1, height); // Left
    w4.rect(x + width - 1, y, 1, height); // Right

    // Draw text
    store<u16>(w4.DRAW_COLORS, 1); // White text
    for (let i = 0; i < text.length; i++) {
        const textX = x + (width - text[i].length * 8) / 2; // Center text horizontally
        const textY = y + 5 + i * 10; // Space lines vertically
        w4.text(text[i], textX, textY);
    }
}

// Draw the title screen
function drawTitleScreen(): void {
    const titleText: string[] = [
        "LAVA HOP!",
        "",
        "$20 Claude Code",
        "3.7 Sonnet",
        "May 2025",
        "",
        "Press any button",
        "to start"
    ];

    drawTextBox(titleText, 10, 20, 140, 90);
}

// Draw the game over screen
function drawGameOverScreen(): void {
    const gameOverText: string[] = [
        "GAME OVER",
        "",
        "Height: " + i32(-player.y / 10).toString()
    ];

    // Add retry prompt after a delay
    if (showRetryPrompt) {
        gameOverText.push("");
        gameOverText.push("Press any button");
        gameOverText.push("to retry");
    }

    drawTextBox(gameOverText, 10, 30, 140, 100);
}

// Reset the game when player dies or at start
function resetGame(): void {
    // Reset player position
    player.x = f32(LEVEL_WIDTH / 2 * TILE_SIZE);
    player.y = 100;
    player.velocityX = 0;
    player.velocityY = 0;
    player.isOnGround = false;

    // Reset camera
    cameraY = 0;

    // Reset lava
    lavaY = initialLavaY;
    currentLavaSpeed = 0; // Start with no lava movement

    // Reset platforms to initial state
    platforms.length = 0;
    initPlatforms();

    // Regenerate lava drops
    initLavaDrops();

    // Update game state based on context
    if (gameState === GameState.Playing) {
        // If dying during gameplay, go to game over screen
        gameState = GameState.GameOver;
        gameOverTimer = 0;
        showRetryPrompt = false;
    } else {
        // If resetting from title or game over, stay in title screen
        gameState = GameState.TitleScreen;
    }

    // Play death sound
    w4.tone(100 | (50 << 16), 15, 100, w4.TONE_NOISE);
}

// Draw the game
function drawGame(): void {
    // Always draw platforms and player regardless of game state
    // Draw platforms

    for (let i = 0; i < platforms.length; i++) {
        const platform = platforms[i];

        // Skip platforms that are completely off-screen
        if (platform.y - cameraY > f32(w4.SCREEN_SIZE) ||
            platform.y + platform.height - cameraY < 0) {
            continue;
        }

        // Draw the platform with camera offset
        const numTiles = platform.tileTypes.length;
        for (let j = 0; j < numTiles; j++) {
            const tileType = platform.tileTypes[j];
            let sprite: usize;

            // Regular platform tiles
            if (tileType === TileType.PlatformLeft) {
                sprite = tilePlatformLeft;
            } else if (tileType === TileType.PlatformMiddle) {
                sprite = tilePlatformMiddle;
            } else if (tileType === TileType.PlatformRight) {
                sprite = tilePlatformRight;
            }
            // Regular platform corners and variants
            else if (tileType === TileType.PlatformCornerLeft) {
                sprite = tilePlatformCornerLeft;
            } else if (tileType === TileType.PlatformCornerRight) {
                sprite = tilePlatformCornerRight;
            } else if (tileType === TileType.PlatformMiddleVariant1) {
                sprite = tilePlatformMiddleVariant1;
            } else if (tileType === TileType.PlatformMiddleVariant2) {
                sprite = tilePlatformMiddleVariant2;
            }
            // Jump-through platform tiles
            else if (tileType === TileType.JumpThroughLeft) {
                sprite = tileJumpThroughLeft;
            } else if (tileType === TileType.JumpThroughMiddle) {
                sprite = tileJumpThroughMiddle;
            } else if (tileType === TileType.JumpThroughRight) {
                sprite = tileJumpThroughRight;
            }
            // Jump-through platform corners and variants
            else if (tileType === TileType.JumpThroughCornerLeft) {
                sprite = tileJumpThroughCornerLeft;
            } else if (tileType === TileType.JumpThroughCornerRight) {
                sprite = tileJumpThroughCornerRight;
            } else if (tileType === TileType.JumpThroughMiddleVariant1) {
                sprite = tileJumpThroughMiddleVariant1;
            } else if (tileType === TileType.JumpThroughMiddleVariant2) {
                sprite = tileJumpThroughMiddleVariant2;
            }
            // Solid blocks
            else if (tileType === TileType.Solid) {
                sprite = tileSolid;
            } else {
                continue; // Skip empty tiles
            }

            const tileX = i32(platform.x) + j * TILE_SIZE;
            const tileY = i32(platform.y - cameraY); // Apply camera offset

            // Use a different color for jump-through platforms
            if (platform.isJumpThrough) {
                store<u16>(w4.DRAW_COLORS, 8); // Color 3 (red) for jump-through platforms
            } else {
                store<u16>(w4.DRAW_COLORS, 2); // Color 1 (dark green) for regular platforms
            }

            w4.blit(sprite, tileX, tileY, TILE_SIZE, TILE_SIZE, w4.BLIT_1BPP);
        }
    }

    // Draw lava stream drops
    for (let i = 0; i < lavaDrops.length; i++) {
        lavaDrops[i].draw();
    }

    // Draw the lava pool at the bottom with visual feedback for rubber-band effect
    if (currentLavaSpeed > LAVA_RISE_SPEED_MAX) {
        // Super-speed mode - rapid pulsating between all colors
        const frameCount = i32(lavaY * 20) % 4; // Faster animation
        // Cycle through all colors for an alarming effect
        const drawColor = frameCount === 0 ? 2 :
                         frameCount === 1 ? 4 :
                         frameCount === 2 ? 8 : 2; // Cycle through color indices
        store<u16>(w4.DRAW_COLORS, drawColor);
    } else if (currentLavaSpeed > LAVA_RISE_SPEED_MIN + 0.1) {
        // Normal rubber-band mode - alternate between red and green
        const frameCount = i32(lavaY * 10) % 10;
        if (frameCount < 5) {
            store<u16>(w4.DRAW_COLORS, 8); // Color 3 (red) for normal lava
        } else {
            store<u16>(w4.DRAW_COLORS, 4); // Color 1 (green) for pulsating lava
        }
    } else {
        // Normal red color when at regular speed
        store<u16>(w4.DRAW_COLORS, 8); // Color 3 (red) for lava
    }

    w4.rect(0, i32(lavaY - cameraY), w4.SCREEN_SIZE, w4.SCREEN_SIZE); // Draw as full width, tall rectangle

    // Draw player
    player.draw();

    // Draw debug info
    store<u16>(w4.DRAW_COLORS, 8); // Color 3 (red) for debug text

    // Show player state - prevent flickering by using stable display logic
    let stateText: string;

    switch (player.animState) {
        case AnimState.Standing:
            stateText = "STANDING";
            break;
        case AnimState.Running:
            stateText = "RUNNING";
            break;
        case AnimState.JumpSquat:
            stateText = "JUMPSQUAT";
            break;
        case AnimState.Jumping:
            stateText = "JUMPING";
            if (player.isJumping) {
                // Show jump hold info
                if (player.jumpHoldTimer > 0) {
                    stateText += " " + player.jumpHoldTimer.toString();
                }
                if (player.jumpReleased) {
                    stateText += " REL";
                }
            }
            break;
        case AnimState.Falling:
            stateText = "FALLING";
            break;
        case AnimState.Landing:
            stateText = "LANDING";
            break;
        default:
            stateText = "UNKNOWN";
    }

    // w4.text(stateText, 5, 5);

    // Show vertical velocity and height
    // const velY = i32(player.velocityY * 10).toString();
    // w4.text("VY: " + velY, 5, 130);

    // Show height (negative Y is higher)
    // const height = i32(-player.y / 10).toString();
    // w4.text("HEIGHT: " + height, 5, 140);

    // Show distance to lava and speed
    // const lavaDistance = i32(lavaY - (player.y + player.height)).toString();
    // const lavaSpeed = i32(currentLavaSpeed * 10).toString();
    // w4.text("LAVA: " + lavaDistance + " SPD:" + lavaSpeed, 5, 150);

    // Draw game state specific overlays
    if (gameState === GameState.TitleScreen) {
        // Draw title screen
        drawTitleScreen();
    }
    else if (gameState === GameState.Playing) {
        // Show gameplay debug info only during actual gameplay
        // Show grounded state
        // const groundedText = player.isOnGround ? "GROUNDED" : "AIR";
        // w4.text(groundedText, 5, 120);

        // Indicate if the player is on a jump-through platform
        // Check for jump-through platform collision
        /*
        let onJumpThrough = false;
        for (let i = 0; i < platforms.length; i++) {
            if (platforms[i].isJumpThrough &&
                checkCollision(player.x, player.y, player.width, player.height,
                              platforms[i].x, platforms[i].y, platforms[i].width, platforms[i].height)) {
                onJumpThrough = true;
                break;
            }
        }

        if (onJumpThrough) {
            w4.text("PASS-THRU", 80, 5);
        }
        */
    }
    else if (gameState === GameState.GameOver) {
        // Draw game over screen
        drawGameOverScreen();
    }
}
