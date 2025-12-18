import { describe, it, expect } from 'vitest'
import { parseLevel, generateRandomLevel, type LevelConfig } from '@/app/data/levels'

describe('parseLevel', () => {
    it('should correctly parse a simple level', () => {
        const level: LevelConfig = {
            id: 1,
            name: 'Test',
            difficulty: 'Easy',
            grid: [
                '######',
                '#@  .#',
                '# $  #',
                '######'
            ]
        }

        const parsed = parseLevel(level)

        expect(parsed.initialPlayer).toEqual({ x: 1, y: 1 })
        expect(parsed.initialBoxes).toEqual([{ x: 2, y: 2 }])
        expect(parsed.goals).toEqual([{ x: 4, y: 1 }])
        expect(parsed.parsedGrid[0][0]).toBe('#')
        expect(parsed.parsedGrid[1][1]).toBe(' ') // Player position becomes space
        expect(parsed.parsedGrid[2][2]).toBe(' ') // Box position becomes space
        expect(parsed.parsedGrid[1][4]).toBe('.') // Goal remains
    })

    it('should handle box on goal (*)', () => {
        const level: LevelConfig = {
            id: 2,
            name: 'Test',
            difficulty: 'Easy',
            grid: [
                '#####',
                '#@  #',
                '# * #',
                '#####'
            ]
        }

        const parsed = parseLevel(level)

        expect(parsed.initialBoxes).toEqual([{ x: 2, y: 2 }])
        expect(parsed.goals).toEqual([{ x: 2, y: 2 }])
        expect(parsed.parsedGrid[2][2]).toBe('.') // Should be goal
    })

    it('should handle player on goal (+)', () => {
        const level: LevelConfig = {
            id: 3,
            name: 'Test',
            difficulty: 'Easy',
            grid: [
                '#####',
                '# + #',
                '#  $#',
                '#  .#',
                '#####'
            ]
        }

        const parsed = parseLevel(level)

        expect(parsed.initialPlayer).toEqual({ x: 2, y: 1 })
        expect(parsed.goals).toHaveLength(2)
        expect(parsed.goals).toContainEqual({ x: 2, y: 1 })
        expect(parsed.goals).toContainEqual({ x: 3, y: 3 })
    })
})

describe('generateRandomLevel', () => {
    it('should generate a level with correct difficulty 1 (Easy)', () => {
        const level = generateRandomLevel(1)

        expect(level.name).toBe('Random Easy')
        expect(level.difficulty).toBe('Easy')
        expect(level.initialBoxes.length).toBe(1)
        expect(level.goals.length).toBe(1)
        expect(level.parsedGrid.length).toBe(7)
        expect(level.parsedGrid[0].length).toBe(8)
    })

    it('should generate a level with correct difficulty 2 (Medium)', () => {
        const level = generateRandomLevel(2)

        expect(level.name).toBe('Random Medium')
        expect(level.difficulty).toBe('Medium')
        expect(level.initialBoxes.length).toBe(2)
        expect(level.goals.length).toBe(2)
        expect(level.parsedGrid.length).toBe(8)
        expect(level.parsedGrid[0].length).toBe(10)
    })

    it('should generate a level with correct difficulty 3 (Hard)', () => {
        const level = generateRandomLevel(3)

        expect(level.name).toBe('Random Hard')
        expect(level.difficulty).toBe('Hard')
        expect(level.initialBoxes.length).toBe(3)
        expect(level.goals.length).toBe(3)
        expect(level.parsedGrid.length).toBe(10)
        expect(level.parsedGrid[0].length).toBe(12)
    })

    it('should not place boxes on goals initially', () => {
        const level = generateRandomLevel(2)

        for (const box of level.initialBoxes) {
            const onGoal = level.goals.some(g => g.x === box.x && g.y === box.y)
            expect(onGoal).toBe(false)
        }
    })

    it('should not place player on goals', () => {
        const level = generateRandomLevel(2)

        const playerOnGoal = level.goals.some(g => g.x === level.initialPlayer.x && g.y === level.initialPlayer.y)
        expect(playerOnGoal).toBe(false)
    })

    it('should have valid grid boundaries (all walls on edges)', () => {
        const level = generateRandomLevel(2)
        const grid = level.parsedGrid

        // Check top and bottom walls
        for (let x = 0; x < grid[0].length; x++) {
            expect(grid[0][x]).toBe('#')
            expect(grid[grid.length - 1][x]).toBe('#')
        }

        // Check left and right walls
        for (let y = 0; y < grid.length; y++) {
            expect(grid[y][0]).toBe('#')
            expect(grid[y][grid[y].length - 1]).toBe('#')
        }
    })
})
