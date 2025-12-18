import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock game logic extracted from SokobanGame component
interface Point {
    x: number
    y: number
}

interface GameState {
    grid: string[][]
    player: Point
    boxes: Point[]
    goals: Point[]
}

// Helper function to check if move is valid (extracted logic from component)
function canMove(
    player: Point,
    direction: 'up' | 'down' | 'left' | 'right',
    grid: string[][],
    boxes: Point[]
): boolean {
    const delta = {
        'up': { x: 0, y: -1 },
        'down': { x: 0, y: 1 },
        'left': { x: -1, y: 0 },
        'right': { x: 1, y: 0 }
    }

    const d = delta[direction]
    const newX = player.x + d.x
    const newY = player.y + d.y

    // Check bounds
    if (newY < 0 || newY >= grid.length || newX < 0 || newX >= grid[0].length) return false
    if (grid[newY][newX] === '#') return false

    // Check box
    const boxIndex = boxes.findIndex(b => b.x === newX && b.y === newY)

    if (boxIndex !== -1) { // Pushing a box
        const boxNewX = newX + d.x
        const boxNewY = newY + d.y

        if (boxNewY < 0 || boxNewY >= grid.length ||
            boxNewX < 0 || boxNewX >= grid[0].length ||
            grid[boxNewY][boxNewX] === '#' ||
            boxes.some(b => b.x === boxNewX && b.y === boxNewY)) {
            return false
        }
    }

    return true
}

// Execute a move and return new state
function executeMove(
    state: GameState,
    direction: 'up' | 'down' | 'left' | 'right'
): GameState {
    const delta = {
        'up': { x: 0, y: -1 },
        'down': { x: 0, y: 1 },
        'left': { x: -1, y: 0 },
        'right': { x: 1, y: 0 }
    }

    const d = delta[direction]
    const newX = state.player.x + d.x
    const newY = state.player.y + d.y

    const newBoxes = [...state.boxes.map(b => ({ ...b }))]
    const boxIndex = newBoxes.findIndex(b => b.x === newX && b.y === newY)

    if (boxIndex !== -1) {
        // Push box
        newBoxes[boxIndex] = { x: newX + d.x, y: newY + d.y }
    }

    return {
        ...state,
        player: { x: newX, y: newY },
        boxes: newBoxes
    }
}

// Check if game is won
function isWinCondition(boxes: Point[], goals: Point[]): boolean {
    return boxes.every(box => goals.some(g => g.x === box.x && g.y === box.y))
}

describe('Game Logic - Movement', () => {
    it('should allow player to move to empty space', () => {
        const grid = [
            ['#', '#', '#', '#'],
            ['#', ' ', ' ', '#'],
            ['#', '#', '#', '#']
        ]
        const player = { x: 1, y: 1 }
        const boxes: Point[] = []

        expect(canMove(player, 'right', grid, boxes)).toBe(true)
    })

    it('should not allow player to move into wall', () => {
        const grid = [
            ['#', '#', '#', '#'],
            ['#', ' ', ' ', '#'],
            ['#', '#', '#', '#']
        ]
        const player = { x: 1, y: 1 }
        const boxes: Point[] = []

        expect(canMove(player, 'up', grid, boxes)).toBe(false)
        expect(canMove(player, 'left', grid, boxes)).toBe(false)
    })

    it('should not allow player to move out of bounds', () => {
        const grid = [
            [' ', ' '],
            [' ', ' ']
        ]
        const player = { x: 0, y: 0 }
        const boxes: Point[] = []

        expect(canMove(player, 'up', grid, boxes)).toBe(false)
        expect(canMove(player, 'left', grid, boxes)).toBe(false)
    })
})

describe('Game Logic - Box Pushing', () => {
    it('should allow pushing box into empty space', () => {
        const grid = [
            ['#', '#', '#', '#', '#'],
            ['#', ' ', ' ', ' ', '#'],
            ['#', '#', '#', '#', '#']
        ]
        const player = { x: 1, y: 1 }
        const boxes = [{ x: 2, y: 1 }]

        expect(canMove(player, 'right', grid, boxes)).toBe(true)
    })

    it('should not allow pushing box into wall', () => {
        const grid = [
            ['#', '#', '#', '#'],
            ['#', ' ', ' ', '#'],
            ['#', '#', '#', '#']
        ]
        const player = { x: 1, y: 1 }
        const boxes = [{ x: 2, y: 1 }]

        expect(canMove(player, 'right', grid, boxes)).toBe(false)
    })

    it('should not allow pushing box into another box', () => {
        const grid = [
            ['#', '#', '#', '#', '#', '#'],
            ['#', ' ', ' ', ' ', ' ', '#'],
            ['#', '#', '#', '#', '#', '#']
        ]
        const player = { x: 1, y: 1 }
        const boxes = [{ x: 2, y: 1 }, { x: 3, y: 1 }]

        expect(canMove(player, 'right', grid, boxes)).toBe(false)
    })

    it('should correctly update box position after push', () => {
        const state: GameState = {
            grid: [
                ['#', '#', '#', '#', '#'],
                ['#', ' ', ' ', ' ', '#'],
                ['#', '#', '#', '#', '#']
            ],
            player: { x: 1, y: 1 },
            boxes: [{ x: 2, y: 1 }],
            goals: []
        }

        const newState = executeMove(state, 'right')

        expect(newState.player).toEqual({ x: 2, y: 1 })
        expect(newState.boxes[0]).toEqual({ x: 3, y: 1 })
    })
})

describe('Game Logic - Win Condition', () => {
    it('should detect win when all boxes are on goals', () => {
        const boxes = [
            { x: 1, y: 1 },
            { x: 2, y: 2 }
        ]
        const goals = [
            { x: 1, y: 1 },
            { x: 2, y: 2 }
        ]

        expect(isWinCondition(boxes, goals)).toBe(true)
    })

    it('should not detect win when some boxes are not on goals', () => {
        const boxes = [
            { x: 1, y: 1 },
            { x: 2, y: 3 }
        ]
        const goals = [
            { x: 1, y: 1 },
            { x: 2, y: 2 }
        ]

        expect(isWinCondition(boxes, goals)).toBe(false)
    })

    it('should not detect win when no boxes are on goals', () => {
        const boxes = [
            { x: 1, y: 1 },
            { x: 2, y: 2 }
        ]
        const goals = [
            { x: 3, y: 3 },
            { x: 4, y: 4 }
        ]

        expect(isWinCondition(boxes, goals)).toBe(false)
    })
})

describe('Game Logic - Complex Scenarios', () => {
    it('should handle a complete sequence of moves', () => {
        let state: GameState = {
            grid: [
                ['#', '#', '#', '#', '#', '#'],
                ['#', ' ', ' ', ' ', '.', '#'],
                ['#', '#', '#', '#', '#', '#']
            ],
            player: { x: 1, y: 1 },
            boxes: [{ x: 2, y: 1 }],
            goals: [{ x: 4, y: 1 }]
        }

        // Move right (push box)
        expect(canMove(state.player, 'right', state.grid, state.boxes)).toBe(true)
        state = executeMove(state, 'right')
        expect(state.player).toEqual({ x: 2, y: 1 })
        expect(state.boxes[0]).toEqual({ x: 3, y: 1 })

        // Move right again (push box onto goal)
        expect(canMove(state.player, 'right', state.grid, state.boxes)).toBe(true)
        state = executeMove(state, 'right')
        expect(state.player).toEqual({ x: 3, y: 1 })
        expect(state.boxes[0]).toEqual({ x: 4, y: 1 })

        // Check win condition
        expect(isWinCondition(state.boxes, state.goals)).toBe(true)
    })

    it('should handle moving without pushing boxes', () => {
        let state: GameState = {
            grid: [
                ['#', '#', '#', '#', '#'],
                ['#', ' ', ' ', ' ', '#'],
                ['#', ' ', ' ', ' ', '#'],
                ['#', '#', '#', '#', '#']
            ],
            player: { x: 1, y: 1 },
            boxes: [{ x: 3, y: 2 }],
            goals: []
        }

        // Move right
        state = executeMove(state, 'right')
        expect(state.player).toEqual({ x: 2, y: 1 })
        expect(state.boxes[0]).toEqual({ x: 3, y: 2 }) // Box unchanged

        // Move down
        state = executeMove(state, 'down')
        expect(state.player).toEqual({ x: 2, y: 2 })
        expect(state.boxes[0]).toEqual({ x: 3, y: 2 }) // Box unchanged
    })
})
