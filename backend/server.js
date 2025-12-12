const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Path to ASP solver file
const ASP_SOLVER_PATH = path.join(__dirname, '../asp/sokoban_solver_optimized.lp');

/**
 * Convert game state to ASP format
 */
function gameStateToASP(gameState) {
    const { grid, player, boxes, goals } = gameState;
    let aspFacts = [];

    // Add grid cells
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[y].length; x++) {
            const cell = grid[y][x];
            let cellType;

            if (cell === '#') cellType = 'wall';
            else if (cell === ' ' || cell === '@' || cell === '$') cellType = 'floor';
            else if (cell === '.' || cell === '*' || cell === '+') cellType = 'goal';

            if (cellType) {
                aspFacts.push(`cell(${x},${y},${cellType}).`);
            }
        }
    }

    // Add player position
    aspFacts.push(`initial_player(${player.x},${player.y}).`);

    // Add box positions
    boxes.forEach(box => {
        aspFacts.push(`initial_box(${box.x},${box.y}).`);
    });

    // Debug: Log the generated ASP facts
    console.log('\n=== DEBUG: Generated ASP Facts ===');
    console.log('Player:', player);
    console.log('Boxes:', boxes);
    console.log('Goals:', goals);
    console.log('ASP Facts:\n', aspFacts.join('\n'));
    console.log('=== END DEBUG ===\n');

    return aspFacts.join('\n');
}

/**
 * Run Clingo with given ASP program
 */
function runClingo(aspProgram, maxSteps = 50, numModels = 0) {
    return new Promise((resolve, reject) => {
        // Create temporary file for the problem
        const tempFile = path.join(__dirname, 'temp_problem.lp');

        // Don't redefine max_steps here - pass it as command-line argument
        fs.writeFileSync(tempFile, aspProgram);

        // Run Clingo with max_steps as a command-line constant
        const clingo = spawn('clingo', [
            ASP_SOLVER_PATH,
            tempFile,
            numModels.toString(),  // Find specific number of models (0 = all optimal)
            '--outf=2',  // JSON output format
            '--heuristic=Domain', // Optimization: Use domain heuristic
            `--const`, `max_steps=${maxSteps}`  // Pass max_steps as constant
        ]);

        let stdout = '';
        let stderr = '';

        clingo.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        clingo.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        clingo.on('close', (code) => {
            // Clean up temp file
            try {
                fs.unlinkSync(tempFile);
            } catch (e) {
                // Ignore cleanup errors
            }

            if (code !== 0 && code !== 10 && code !== 30) {
                reject(new Error(`Clingo failed with code ${code}: ${stderr}`));
                return;
            }

            try {
                const result = JSON.parse(stdout);
                resolve(result);
            } catch (e) {
                reject(new Error(`Failed to parse Clingo output: ${e.message}`));
            }
        });

        clingo.on('error', (err) => {
            reject(new Error(`Failed to run Clingo: ${err.message}. Make sure Clingo is installed.`));
        });
    });
}

/**
 * Parse Clingo result to extract solution
 */
function parseSolution(clingoResult) {
    if (!clingoResult.Call || clingoResult.Call.length === 0) {
        return null;
    }

    const witnesses = clingoResult.Call[0].Witnesses;
    if (!witnesses || witnesses.length === 0) {
        return null;
    }

    // Get the LAST witness (optimal solution)
    const witness = witnesses[witnesses.length - 1];
    const moves = [];

    witness.Value.forEach(atom => {
        const match = atom.match(/move\((\w+),(\d+)\)/);
        if (match) {
            moves.push({
                direction: match[1],
                step: parseInt(match[2])
            });
        }
    });

    // Sort by step number
    moves.sort((a, b) => a.step - b.step);

    console.log('=== Parsed Moves from ASP ===');
    console.log('All moves:', moves);
    console.log('First move:', moves[0]);
    console.log('============================');

    return moves;
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * Check if current game state is solvable
 */
app.post('/api/check-solvable', async (req, res) => {
    try {
        const gameState = req.body;
        const aspProgram = gameStateToASP(gameState);

        // OPTIMIZATION: Just find ONE solution (numModels = 1)
        // We don't need optimality, just feasibility.
        // We also use a timeout-like logic via max_steps, but we can't easily timeout node spawn without more logic.
        // But restricting max_steps prevents infinite hangs.
        const result = await runClingo(aspProgram, 50, 1);
        const solution = parseSolution(result);

        res.json({
            solvable: solution !== null,
            message: solution ? 'Puzzle is solvable!' : 'No solution found from this state.'
        });
    } catch (error) {
        console.error('Error checking solvability:', error);
        res.status(500).json({
            error: 'Failed to check solvability',
            message: error.message
        });
    }
});

/**
 * Get hint for next move
 */
app.post('/api/get-hint', async (req, res) => {
    try {
        const gameState = req.body;
        const aspProgram = gameStateToASP(gameState);

        // Iterative Deepening to find solution faster
        // Start with a small horizon. If solution found, it's likely optimal and found quickly.
        // If not, increase horizon.
        const horizons = [20, 35, 50];
        let solution = null;
        let usedSteps = 0;

        for (const steps of horizons) {
            console.log(`Trying hint with max_steps=${steps}...`);
            const result = await runClingo(aspProgram, steps, 0); // 0 = find optimal
            const currentSol = parseSolution(result);

            if (currentSol && currentSol.length > 0) {
                solution = currentSol;
                usedSteps = steps;
                break;
            }
        }

        if (!solution || solution.length === 0) {
            res.json({
                hint: null,
                message: 'No solution available from this state.'
            });
            return;
        }

        // Return the first move as hint
        const firstMove = solution[0];
        res.json({
            hint: firstMove.direction,
            message: `Try moving ${firstMove.direction}!`,
            totalMoves: solution.length
        });
    } catch (error) {
        console.error('Error generating hint:', error);
        res.status(500).json({
            error: 'Failed to generate hint',
            message: error.message
        });
    }
});

/**
 * Validate if current state is a solution
 */
app.post('/api/validate-solution', async (req, res) => {
    try {
        const { boxes, goals } = req.body;

        // Check if all goals have boxes
        const goalsWithBoxes = goals.filter(goal =>
            boxes.some(box => box.x === goal.x && box.y === goal.y)
        );

        const isSolved = goalsWithBoxes.length === goals.length && goals.length > 0;

        res.json({
            solved: isSolved,
            boxesOnGoals: goalsWithBoxes.length,
            totalGoals: goals.length
        });
    } catch (error) {
        console.error('Error validating solution:', error);
        res.status(500).json({
            error: 'Failed to validate solution',
            message: error.message
        });
    }
});

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Backend is running' });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`🎮 Sokoban ASP Server running on http://localhost:${PORT}`);
    console.log(`📁 Serving frontend from: ${path.join(__dirname, '../frontend')}`);
    console.log(`🧠 ASP Solver: ${ASP_SOLVER_PATH}`);
});
