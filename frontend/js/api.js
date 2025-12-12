// API communication module for backend interaction

const API_BASE_URL = 'http://localhost:3000/api';

class SokobanAPI {
    /**
     * Check if the current game state is solvable
     */
    static async checkSolvable(gameState) {
        try {
            const response = await fetch(`${API_BASE_URL}/check-solvable`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gameState)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
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
    static async getHint(gameState) {
        try {
            const response = await fetch(`${API_BASE_URL}/get-hint`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gameState)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error getting hint:', error);
            return {
                hint: null,
                error: error.message
            };
        }
    }

    /**
     * Validate if current state is a winning state
     */
    static async validateSolution(boxes, goals) {
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
        } catch (error) {
            console.error('Error validating solution:', error);
            return {
                solved: false,
                error: error.message
            };
        }
    }

    /**
     * Check backend health
     */
    static async checkHealth() {
        try {
            const response = await fetch(`${API_BASE_URL}/health`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Backend health check failed:', error);
            return {
                status: 'error',
                error: error.message
            };
        }
    }
}
