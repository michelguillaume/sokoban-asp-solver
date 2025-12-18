
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export interface GameState {
    grid: string[][];
    player: { x: number; y: number };
    boxes: { x: number; y: number }[];
    goals: { x: number; y: number }[];
}

export interface CheckSolvableRequest extends GameState {
    /** Deeper search. */
    deep?: boolean;
    /** Planning horizon. */
    maxSteps?: number;
    /** Optional timeout (seconds). */
    timeoutSec?: number;

    /** Keep increasing horizon until solution or client disconnects. */
    auto?: boolean;

    /** Prefer shorter plan (slower). */
    optimal?: boolean;
}

export interface SolverMeta {
    maxStepsUsed: number;
    elapsedMs: number;
}

export interface SolvabilityResult {
    solvable: boolean | null;
    error?: string;
    message?: string;
    hint?: string | null;
    hintMessage?: string | null;
    solution?: string[] | null;
    totalMoves?: number | null;
    solver?: SolverMeta;
}


export interface HintResult {
    hint: 'up' | 'down' | 'left' | 'right' | null;
    message: string;
    error?: string;
}

export interface ValidationResult {
    solved: boolean;
    error?: string;
}

export interface HealthResult {
    status: string;
    error?: string;
}

export interface SolutionResult {
    moves: string[];
    totalMoves: number;
    message?: string;
    error?: string;
}

export class SokobanAPI {
    /**
     * Check if the current game state is solvable
     */
    static async checkSolvable(gameState: CheckSolvableRequest, signal?: AbortSignal): Promise<SolvabilityResult> {
        try {
            const response = await fetch(`${API_BASE_URL}/check-solvable`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gameState),
                signal
            });

            if (!response.ok) {
                // throw new Error(`HTTP error! status: ${response.status}`);
                console.warn("Backend not available or error:", response.status);
                return { solvable: null, error: `HTTP ${response.status}` };
            }

            return await response.json();
        } catch (error: any) {
            if (signal?.aborted || error.name === 'AbortError') {
                return { solvable: null, error: 'Aborted' };
            }
            console.error('Error checking solvability:', error);
            return {
                solvable: null,
                error: error.message
            };
        }
    }

    /**
     * Get a hint for the next move
     */
    static async getHint(gameState: GameState): Promise<HintResult> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        try {
            const response = await fetch(`${API_BASE_URL}/get-hint`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gameState),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error: any) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                console.error('Hint request timed out');
                return {
                    hint: null,
                    message: 'Unable to find a solution - this puzzle may be too complex or unsolvable from this state.'
                };
            }

            console.error('Error getting hint:', error);
            return {
                hint: null,
                message: error.message
            };
        }
    }

    /**
     * Validate if current state is a winning state
     */
    static async validateSolution(boxes: { x: number, y: number }[], goals: { x: number, y: number }[]): Promise<ValidationResult> {
        try {
            const response = await fetch(`${API_BASE_URL}/validate-solution`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ boxes, goals })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error: any) {
            console.error('Error validating solution:', error);
            return {
                solved: false,
                error: error.message
            };
        }
    }

    /**
     * Get the complete solution for the current state
     */
    static async getSolution(gameState: GameState): Promise<SolutionResult> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 second timeout (longer for complete solutions)

        try {
            const response = await fetch(`${API_BASE_URL}/get-solution`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gameState),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error: any) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                console.error('Solution request timed out');
                return {
                    moves: [],
                    totalMoves: 0,
                    message: 'Unable to find a solution - this puzzle may be too complex or unsolvable from this state.'
                };
            }

            console.error('Error getting solution:', error);
            return {
                moves: [],
                totalMoves: 0,
                error: error.message
            };
        }
    }

    /**
     * Check backend health
     */
    static async checkHealth(): Promise<HealthResult> {
        try {
            const response = await fetch(`${API_BASE_URL}/health`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error: any) {
            console.error('Backend health check failed:', error);
            return {
                status: 'error',
                error: error.message
            };
        }
    }
}
