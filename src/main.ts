import * as w4 from "./wasm4";

// Constants
const GRAVITY: f32 = 0.4;
const JUMP_FORCE: f32 = -5.5;
const MOVE_SPEED: f32 = 1.8;
const GROUND_FRICTION: f32 = 0.8;
const AIR_FRICTION: f32 = 0.95;
const TERMINAL_VELOCITY: f32 = 7.0;
const COYOTE_TIME: u32 = 6; // frames where player can still jump after leaving a platform
const MAX_PLATFORMS: i32 = 20; // maximum number of platforms

// Tile system constants
const TILE_SIZE: i32 = 7; // 7x7 tiles for level
const LEVEL_WIDTH: i32 = 23; // 160 / 7 = ~23 tiles wide
const LEVEL_HEIGHT: i32 = 23; // 160 / 7 = ~23 tiles high
const PLAYER_WIDTH: i32 = 8; // 8 pixels wide for player sprites
const PLAYER_HEIGHT: i32 = 12; // 12 pixels tall for player sprites

// Game state
let prevGamepad: u8 = 0;

// Tile types
enum TileType {
    Empty = 0,
    Solid = 1,
    Platform = 2
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

// Check if a tile is a platform
function isPlatformTile(tileType: u8): boolean {
    return tileType >= 2 && tileType <= 4;
}

// Platform class for collision
class Platform {
    x: f32;
    y: f32;
    width: f32;
    height: f32;
    tileTypes: u8[] = [];

    constructor(x: f32, y: f32, width: f32, height: f32, tileTypes: u8[] = []) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.tileTypes = tileTypes;
    }

    draw(): void {
        store<u16>(w4.DRAW_COLORS, 2); // Color 1 for platforms (dark green)

        if (this.tileTypes.length > 0) {
            // Draw using the tile types
            const numTiles = this.tileTypes.length;
            for (let i = 0; i < numTiles; i++) {
                const tileType = this.tileTypes[i];
                let sprite: usize;

                if (tileType === 2) { // Platform left
                    sprite = tilePlatformLeft;
                } else if (tileType === 3) { // Platform middle
                    sprite = tilePlatformMiddle;
                } else if (tileType === 4) { // Platform right
                    sprite = tilePlatformRight;
                } else if (tileType === 1) { // Solid
                    sprite = tileSolid;
                } else {
                    continue; // Skip empty tiles
                }

                const tileX = i32(this.x) + i * TILE_SIZE;
                const tileY = i32(this.y);
                w4.blit(sprite, tileX, tileY, TILE_SIZE, TILE_SIZE, w4.BLIT_1BPP);
            }
        } else {
            // Fallback to rect drawing if no tiles specified
            w4.rect(i32(this.x), i32(this.y), u32(this.width), u32(this.height));
        }
    }
}

// Create platforms from tilemap
function initPlatforms(): void {
    // Clear existing platforms
    platforms.length = 0;

    // Scan through the tilemap looking for platform sequences
    for (let y = 0; y < LEVEL_HEIGHT; y++) {
        let platformStart = -1;
        let platformTiles: u8[] = [];

        for (let x = 0; x < LEVEL_WIDTH; x++) {
            const tile = getTile(x, y);

            // If this is a platform or solid tile
            if (isPlatformTile(tile) || isSolidTile(tile)) {
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

                // Create a new platform
                platforms.push(new Platform(worldX, worldY, width, height, platformTiles));

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
            platforms.push(new Platform(worldX, worldY, width, height, platformTiles));
        }
    }
}

// Initialize platforms
const platforms: Platform[] = [];
initPlatforms();

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

// Jump squat animation (pre-jump, squashed)
const playerJumpSquat = memory.data<u8>([
    0b11000011, // head
    0b10000001, // head
    0b10100101, // eyes (determined)
    0b10011001, // gritted teeth expression
    0b11000011, // neck
    0b10000001, // torso (wider)
    0b10000001, // torso (wider)
    0b10000001, // torso (wider)
    0b10000001, // hips (wider)
    0b10011001, // clearly bent legs
    0b10100101, // squatting position
    0b11000011, // feet firmly planted
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
    }

    update(gamepad: u8): void {
        this.updatePhysics(gamepad);
        this.updateAnimation();
    }

    updatePhysics(gamepad: u8): void {
        // Get the just-pressed buttons (not held)
        const justPressed = gamepad & (gamepad ^ prevGamepad);

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

        // Jump logic with coyote time and jump squat
        if ((justPressed & w4.BUTTON_1) && (this.isOnGround || this.coyoteTimeCounter > 0)) {
            // Start jump squat (pre-jump animation)
            if (this.jumpSquatTimer === 0) {
                this.jumpSquatTimer = 3; // 3 frames of jump squat
                this.animState = AnimState.JumpSquat;
            }
        }

        // Process jump squat
        if (this.jumpSquatTimer > 0) {
            this.jumpSquatTimer--;

            // When jump squat is done, apply the jump
            if (this.jumpSquatTimer === 0) {
                this.velocityY = JUMP_FORCE;
                this.isOnGround = false;
                this.coyoteTimeCounter = 0;
                this.animState = AnimState.Jumping;

                // Play jump sound effect
                w4.tone(200 | (150 << 16), 4, 40, w4.TONE_PULSE1);
            }
        }

        // Apply gravity if not on ground
        if (!this.isOnGround) {
            this.velocityY += GRAVITY;
            // Note: Coyote time is now managed in the ground detection section
        }

        // Clamp terminal velocity
        if (this.velocityY > TERMINAL_VELOCITY) {
            this.velocityY = TERMINAL_VELOCITY;
        }

        // Save old position for collision resolution
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

            if (checkCollision(this.x, this.y, this.width, this.height,
                              platform.x, platform.y, platform.width, platform.height)) {

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
                    this.y = platform.y - this.height;
                    this.velocityY = 0;
                    this.isOnGround = true;

                    // Play landing sound if we weren't on ground before
                    if (!wasOnGround) {
                        w4.tone(80 | (60 << 16), 5, 50, w4.TONE_NOISE);
                    }
                }
                else if (collisionDir === 3 && this.velocityY < 0) {
                    // Bottom collision (player is hitting head on platform)
                    this.y = platform.y + platform.height;
                    this.velocityY = 0;
                }
            }
        }

        // More robust ground detection - check a bit below the player
        const tileX = worldToTileX(this.x + this.width / 2);
        const tileY = worldToTileY(this.y + this.height + 1); // Check slightly below the player
        const belowTile = getTile(tileX, tileY);

        // Determine if we're on ground - either solid or platform
        const onGround = isSolidTile(belowTile) || isPlatformTile(belowTile);

        if (onGround && this.velocityY >= 0) {
            // Only snap to ground if we're moving down or already on ground
            const worldY = tileToWorldY(tileY);
            this.y = worldY - this.height;
            this.velocityY = 0;

            if (!this.isOnGround) {
                this.isOnGround = true;

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
                // Simulate squash by shifting down slightly
                yOffset = 2;
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

        // Draw player with correct facing direction
        const flags = this.facingLeft ? w4.BLIT_FLIP_X : 0;
        // Apply the y-offset for squash and stretch effects without distorting the sprite
        w4.blit(sprite, i32(this.x), i32(this.y) + yOffset, u32(PLAYER_WIDTH), u32(PLAYER_HEIGHT), w4.BLIT_1BPP | flags);
    }
}

// Create player instance
const player = new Player();

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

    // Update player
    player.update(gamepad);

    // Draw game
    drawGame();

    // Store current gamepad state for next frame
    prevGamepad = gamepad;
}

// Draw the game
function drawGame(): void {
    // Draw the tilemap
    for (let y = 0; y < LEVEL_HEIGHT; y++) {
        for (let x = 0; x < LEVEL_WIDTH; x++) {
            const tile = getTile(x, y);
            if (tile === TileType.Empty) continue; // Skip empty tiles

            let sprite: usize;
            if (tile === TileType.Solid) {
                sprite = tileSolid;
            } else if (tile === 2) { // Platform left
                sprite = tilePlatformLeft;
            } else if (tile === 3) { // Platform middle
                sprite = tilePlatformMiddle;
            } else if (tile === 4) { // Platform right
                sprite = tilePlatformRight;
            } else {
                continue;
            }

            const worldX = tileToWorldX(x);
            const worldY = tileToWorldY(y);
            store<u16>(w4.DRAW_COLORS, 2); // Color 1 for platforms (dark green)
            w4.blit(sprite, i32(worldX), i32(worldY), TILE_SIZE, TILE_SIZE, w4.BLIT_1BPP);
        }
    }

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

    w4.text(stateText, 5, 5);
}
