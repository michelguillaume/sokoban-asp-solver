
import { OFFICIAL_LEVELS_RAW } from '@/app/data/officialLevelsRaw';

export interface LevelConfig {
    id: number;
    name: string;
    difficulty: "Easy" | "Medium" | "Hard";
    grid: string[];
}

function parseOfficialLevels(raw: string): LevelConfig[] {
    const lines = raw.split(/\r?\n/);

    const levels: LevelConfig[] = [];
    let currentId: number | null = null;
    let currentName: string | null = null;
    let currentGrid: string[] = [];

    const flush = () => {
        if (currentId == null) return;
        // Trim trailing empty lines from the grid
        while (currentGrid.length > 0 && currentGrid[currentGrid.length - 1].trim() === '') {
            currentGrid.pop();
        }
        // Also trim leading empty lines
        while (currentGrid.length > 0 && currentGrid[0].trim() === '') {
            currentGrid.shift();
        }
        levels.push({
            id: currentId,
            name: currentName ? `Level ${currentId} — ${currentName}` : `Level ${currentId}`,
            difficulty: "Medium",
            grid: currentGrid
        });
    };

    for (const rawLine of lines) {
        const line = rawLine.replace(/\t/g, '    ');
        const m = line.match(/^Level\s+(\d+)\s*$/i);
        if (m) {
            flush();
            currentId = Number(m[1]);
            currentName = null;
            currentGrid = [];
            continue;
        }
        if (currentId == null) continue;

        // Optional title line in single quotes (e.g. 'Duh!')
        if (currentGrid.length === 0 && currentName == null) {
            const t = line.trim();
            const tm = t.match(/^'(.*)'$/);
            if (tm) {
                currentName = tm[1];
                continue;
            }
        }

        // Ignore pure empty separators between levels
        if (line.trim() === '' && currentGrid.length === 0) continue;

        currentGrid.push(line);
    }

    flush();
    // Ensure stable ordering (1..155)
    levels.sort((a, b) => a.id - b.id);
    return levels;
}

// Exclude a couple of huge official levels (UI is fixed-size).
const EXCLUDED_OFFICIAL_LEVEL_IDS = new Set<number>([154, 155]);
export const LEVELS: LevelConfig[] = parseOfficialLevels(OFFICIAL_LEVELS_RAW).filter(
    (l) => !EXCLUDED_OFFICIAL_LEVEL_IDS.has(l.id)
);

export interface Point {
    x: number;
    y: number;
}

export interface ParsedLevel extends LevelConfig {
    parsedGrid: string[][];
    initialPlayer: Point;
    initialBoxes: Point[];
    goals: Point[];
}

export function parseLevel(level: any): ParsedLevel {
    const grid: string[][] = [];
    const boxes: Point[] = [];
    const goals: Point[] = [];
    let player: Point = { x: 0, y: 0 };

    const height = level.grid.length;
    const width = Math.max(...level.grid.map((r: string) => r.length));

    // Build rectangular raw char grid (pads with spaces)
    const rawGrid: string[][] = [];
    for (let y = 0; y < height; y++) {
        const rowStr: string = level.grid[y] ?? '';
        const row: string[] = [];
        for (let x = 0; x < width; x++) {
            row.push(rowStr[x] ?? ' ');
        }
        rawGrid.push(row);
    }

    // Detect outside/void spaces: flood fill from boundary spaces
    const isVoid: boolean[][] = Array.from({ length: height }, () => Array(width).fill(false));
    const queue: Array<[number, number]> = [];

    const enqueueIfVoidSpace = (x: number, y: number) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return;
        if (isVoid[y][x]) return;
        if (rawGrid[y][x] !== ' ') return;
        isVoid[y][x] = true;
        queue.push([x, y]);
    };

    // Top/bottom
    for (let x = 0; x < width; x++) {
        enqueueIfVoidSpace(x, 0);
        enqueueIfVoidSpace(x, height - 1);
    }
    // Left/right
    for (let y = 0; y < height; y++) {
        enqueueIfVoidSpace(0, y);
        enqueueIfVoidSpace(width - 1, y);
    }

    while (queue.length > 0) {
        const [x, y] = queue.shift()!;
        enqueueIfVoidSpace(x - 1, y);
        enqueueIfVoidSpace(x + 1, y);
        enqueueIfVoidSpace(x, y - 1);
        enqueueIfVoidSpace(x, y + 1);
    }

    for (let y = 0; y < height; y++) {
        const gridRow: string[] = [];
        for (let x = 0; x < width; x++) {
            const char = rawGrid[y][x];
            if (char === ' ' && isVoid[y][x]) {
                // Void/outside-of-map
                gridRow.push('x');
                continue;
            }
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

export function generateRandomLevel(difficulty: 1 | 2 | 3 = 2): ParsedLevel {
    const configs = {
        1: { width: 8, height: 7, boxes: 1, moves: 30 },
        2: { width: 10, height: 8, boxes: 2, moves: 40 },
        3: { width: 12, height: 10, boxes: 3, moves: 50 }
    };
    const config = configs[difficulty] || configs[2];
    const grid: string[][] = [];
    for (let y = 0; y < config.height; y++) {
        const row: string[] = [];
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
    const goals: Point[] = [];
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

    const countWallNeighbors = (x: number, y: number) => {
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                if (grid[y + dy] && grid[y + dy][x + dx] === '#') count++;
            }
        }
        return count;
    };

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
                let moved = false;
                for (let i = 0; i < 50; i++) {
                    const rx = 1 + Math.floor(Math.random() * (config.width - 2));
                    const ry = 1 + Math.floor(Math.random() * (config.height - 2));

                    if (grid[ry][rx] !== '#' &&
                        !goals.some(g => g.x === rx && g.y === ry) &&
                        !boxes.some(b => b !== box && b.x === rx && b.y === ry) && 
                        countWallNeighbors(rx, ry) <= 1 &&
                        !(player.x === rx && player.y === ry)) {

                        box.x = rx;
                        box.y = ry;
                        moved = true;
                        break;
                    }
                }

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

    if (goals.some(g => g.x === player.x && g.y === player.y)) {
        let moved = false;
        for (let y = 1; y < config.height - 1; y++) {
            for (let x = 1; x < config.width - 1; x++) {
                if (grid[y][x] !== '#' &&
                    !goals.some(g => g.x === x && g.y === y) && 
                    !boxes.some(b => b.x === x && b.y === y)) { 
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
        id: -1, 
        name: `Random ${['Easy', 'Medium', 'Hard'][difficulty - 1]}`,
        difficulty: ['Easy', 'Medium', 'Hard'][difficulty - 1] as any,
        grid: grid.map(row => row.join('')),
        parsedGrid: grid,
        initialPlayer: player,
        initialBoxes: boxes,
        goals: goals
    };
}

export const PARSED_LEVELS = LEVELS.map(parseLevel);
