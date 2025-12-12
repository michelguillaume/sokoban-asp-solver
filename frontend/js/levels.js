// Level definitions for Sokoban puzzles
// Format: # = wall, @ = player, $ = box, . = goal, * = box on goal, + = player on goal, (space) = floor

const LEVELS = [
    {
        id: 1,
        name: "Tutorial",
        difficulty: "Easy",
        grid: ["########", "#  .   #", "#  $   #", "#  @   #", "########"]
    },
    {
        id: 2,
        name: "Simple Push",
        difficulty: "Easy",
        grid: ["#########", "#       #", "# $  .  #", "#  @    #", "#       #", "#########"]
    },
    {
        id: 3,
        name: "Two Boxes",
        difficulty: "Medium",
        grid: ["##########", "#        #", "#  ..    #", "#  $$    #", "#   @    #", "#        #", "##########"]
    },
    {
        id: 4,
        name: "Corner Challenge",
        difficulty: "Medium",
        grid: ["  ######", "###    #", "#  $   #", "# #.#  #", "#  $  ##", "#  . @# ", "#######"]
    }
];

function parseLevel(level) {
    const grid = [], boxes = [], goals = [];
    let player = null;
    for (let y = 0; y < level.grid.length; y++) {
        const gridRow = [];
        for (let x = 0; x < level.grid[y].length; x++) {
            const char = level.grid[y][x];
            switch (char) {
                case '#': gridRow.push('#'); break;
                case ' ': gridRow.push(' '); break;
                case '.': gridRow.push('.'); goals.push({ x, y }); break;
                case '@': gridRow.push(' '); player = { x, y }; break;
                case '$': gridRow.push(' '); boxes.push({ x, y }); break;
                case '*': gridRow.push('.'); boxes.push({ x, y }); goals.push({ x, y }); break;
                case '+': gridRow.push('.'); player = { x, y }; goals.push({ x, y }); break;
                default: gridRow.push(' ');
            }
        }
        grid.push(gridRow);
    }
    return { ...level, parsedGrid: grid, initialPlayer: player, initialBoxes: boxes, goals };
}

function generateRandomLevel(difficulty = 2) {
    const configs = {
        1: { width: 8, height: 7, boxes: 1, moves: 30 },
        2: { width: 10, height: 8, boxes: 2, moves: 40 },
        3: { width: 12, height: 10, boxes: 3, moves: 50 }
    };
    const config = configs[difficulty] || configs[2];
    const grid = [];
    for (let y = 0; y < config.height; y++) {
        const row = [];
        for (let x = 0; x < config.width; x++) {
            row.push((x === 0 || x === config.width - 1 || y === 0 || y === config.height - 1) ? '#' : ' ');
        }
        grid.push(row);
    }
    const numWalls = Math.floor(config.width * config.height * 0.1);
    for (let i = 0; i < numWalls; i++) {
        const x = 2 + Math.floor(Math.random() * (config.width - 4));
        const y = 2 + Math.floor(Math.random() * (config.height - 4));
        if (grid[y][x] === ' ') grid[y][x] = '#';
    }
    const goals = [];
    let attempts = 0;
    while (goals.length < config.boxes && attempts < 100) {
        const x = 2 + Math.floor(Math.random() * (config.width - 4));
        const y = 2 + Math.floor(Math.random() * (config.height - 4));
        if (grid[y][x] === ' ' && !goals.some(g => g.x === x && g.y === y)) {
            const freeSpaces = [
                grid[y - 1][x] === ' ', grid[y + 1][x] === ' ',
                grid[y][x - 1] === ' ', grid[y][x + 1] === ' '
            ].filter(Boolean).length;
            if (freeSpaces >= 2) {
                goals.push({ x, y });
                grid[y][x] = '.';
            }
        }
        attempts++;
    }
    if (goals.length < config.boxes) return generateRandomLevel(difficulty);
    const boxes = goals.map(g => ({ ...g }));
    let player = { x: 2, y: 2 };
    for (let y = 1; y < config.height - 1; y++) {
        for (let x = 1; x < config.width - 1; x++) {
            if (grid[y][x] !== '#' && !boxes.some(b => b.x === x && b.y === y)) {
                player = { x, y };
                break;
            }
        }
        if (player.x > 0) break;
    }
    const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
    let successfulMoves = 0, totalAttempts = 0;
    while (successfulMoves < config.moves && totalAttempts < config.moves * 5) {
        totalAttempts++;
        const box = boxes[Math.floor(Math.random() * boxes.length)];
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        const playerX = box.x + dir.x, playerY = box.y + dir.y;
        const newBoxX = box.x - dir.x, newBoxY = box.y - dir.y;
        if (newBoxX <= 0 || newBoxX >= config.width - 1 || newBoxY <= 0 || newBoxY >= config.height - 1) continue;
        if (grid[newBoxY][newBoxX] === '#') continue;
        if (boxes.some(b => b !== box && b.x === newBoxX && b.y === newBoxY)) continue;
        if (playerX <= 0 || playerX >= config.width - 1 || playerY <= 0 || playerY >= config.height - 1) continue;
        if (grid[playerY][playerX] === '#') continue;
        if (boxes.some(b => b.x === playerX && b.y === playerY)) continue;
        const surroundingWalls = [
            grid[newBoxY - 1][newBoxX - 1] === '#', grid[newBoxY - 1][newBoxX] === '#', grid[newBoxY - 1][newBoxX + 1] === '#',
            grid[newBoxY][newBoxX - 1] === '#', grid[newBoxY][newBoxX + 1] === '#',
            grid[newBoxY + 1][newBoxX - 1] === '#', grid[newBoxY + 1][newBoxX] === '#', grid[newBoxY + 1][newBoxX + 1] === '#'
        ].filter(Boolean).length;
        if (surroundingWalls > 1) continue;
        box.x = newBoxX; box.y = newBoxY;
        player.x = playerX; player.y = playerY;
        successfulMoves++;
    }
    // Final Validation and Fixes
    // Rule 1: Boxes cannot be on targets
    // Rule 2: Boxes cannot be next to > 1 wall (8-neighborhood)
    // Rule 3: Player cannot be on target

    // Helper to count wall neighbors
    const countWallNeighbors = (x, y) => {
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                if (grid[y + dy] && grid[y + dy][x + dx] === '#') count++;
            }
        }
        return count;
    };

    // Fix Boxes
    // Iterate until all boxes satisfy conditions
    let allBoxesValid = false;
    let boxAttempts = 0;

    while (!allBoxesValid && boxAttempts < 500) {
        boxAttempts++;
        allBoxesValid = true;

        for (const box of boxes) {
            const onGoal = goals.some(g => g.x === box.x && g.y === box.y);
            const wallNeighbors = countWallNeighbors(box.x, box.y);

            if (onGoal || wallNeighbors > 1) {
                allBoxesValid = false;
                // Move this box to a random valid spot
                let moved = false;
                // Try random spots first for diversity
                for (let i = 0; i < 50; i++) {
                    const rx = 1 + Math.floor(Math.random() * (config.width - 2));
                    const ry = 1 + Math.floor(Math.random() * (config.height - 2));

                    if (grid[ry][rx] !== '#' &&
                        !goals.some(g => g.x === rx && g.y === ry) &&
                        !boxes.some(b => b !== box && b.x === rx && b.y === ry) && // unique
                        countWallNeighbors(rx, ry) <= 1 &&
                        !(player.x === rx && player.y === ry)) {

                        box.x = rx;
                        box.y = ry;
                        moved = true;
                        break;
                    }
                }

                // If random failed, linear search
                if (!moved) {
                    for (let y = 1; y < config.height - 1; y++) {
                        for (let x = 1; x < config.width - 1; x++) {
                            if (grid[y][x] !== '#' &&
                                !goals.some(g => g.x === x && g.y === y) &&
                                !boxes.some(b => b !== box && b.x === x && b.y === y) &&
                                countWallNeighbors(x, y) <= 1 &&
                                !(player.x === x && player.y === y)) {
                                box.x = x;
                                box.y = y;
                                moved = true;
                                break;
                            }
                        }
                        if (moved) break;
                    }
                }
            }
        }
    }

    // Fix Player
    if (goals.some(g => g.x === player.x && g.y === player.y)) {
        let moved = false;
        for (let y = 1; y < config.height - 1; y++) {
            for (let x = 1; x < config.width - 1; x++) {
                if (grid[y][x] !== '#' &&
                    !goals.some(g => g.x === x && g.y === y) && // Not on goal
                    !boxes.some(b => b.x === x && b.y === y)) { // Not on box
                    player.x = x;
                    player.y = y;
                    moved = true;
                    break;
                }
            }
            if (moved) break;
        }
    }
    return {
        id: 'random',
        name: `Random ${['Easy', 'Medium', 'Hard'][difficulty - 1]}`,
        difficulty: ['Easy', 'Medium', 'Hard'][difficulty - 1],
        grid: grid.map(row => row.join('')),
        parsedGrid: grid,
        initialPlayer: player,
        initialBoxes: boxes,
        goals: goals
    };
}

const PARSED_LEVELS = LEVELS.map(parseLevel);
window.generateRandomLevel = generateRandomLevel;
