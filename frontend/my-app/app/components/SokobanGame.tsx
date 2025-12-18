
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PARSED_LEVELS, generateRandomLevel, type ParsedLevel, type Point } from '@/app/data/levels';
import { SokobanAPI } from '@/app/lib/api';

type SolverSearchLimit = '25' | '35' | '35+';
type SolverSearchMode = 'fixed' | 'auto';
type SolvabilityCheckOpts = { hasUndo?: boolean; maxSteps?: number; mode?: SolverSearchMode; refreshSolution?: boolean };
type MoveDirection = 'up' | 'down' | 'left' | 'right';

export default function SokobanGame() {
    const MAX_SOLUTION_MOVES = 250;
    const BASE_CELL_SIZE = 50;
    const BASE_BOARD_GAP = 2;
    const BASE_BOARD_PADDING = 10;
    const MAX_BOARD_SCALE = 1.6;

    // Game State
    const [currentLevelIndex, setCurrentLevelIndex] = useState(0);
    const [currentLevel, setCurrentLevel] = useState<ParsedLevel | null>(null);
    const [grid, setGrid] = useState<string[][]>([]);
    const [player, setPlayer] = useState<Point>({ x: 0, y: 0 });
    const [boxes, setBoxes] = useState<Point[]>([]);
    const [goals, setGoals] = useState<Point[]>([]);
    const [moveCount, setMoveCount] = useState(0);
    const [moveHistory, setMoveHistory] = useState<any[]>([]);
    const [isCheckingSolvability, setIsCheckingSolvability] = useState(false);
    const [solvabilityStatus, setSolvabilityStatus] = useState<'checking' | 'solvable' | 'unsolvable' | 'unknown' | 'error' | null>(null);

    // Cached data from solvability check
    const [cachedHintMessage, setCachedHintMessage] = useState<string | null>(null);
    const [cachedSolution, setCachedSolution] = useState<string[] | null>(null);
    const [cachedSolutionTooLong, setCachedSolutionTooLong] = useState(false);

    // Solver settings + timing
    const [solverSearchLimit, setSolverSearchLimit] = useState<SolverSearchLimit>('35+');
    const solverBaseMaxSteps = solverSearchLimit === '25' ? 25 : 35;
    const solverMode: SolverSearchMode = solverSearchLimit === '35+' ? 'auto' : 'fixed';
    const [solverOptimal, setSolverOptimal] = useState(false);
    const [solverTimingsBySteps, setSolverTimingsBySteps] = useState<Record<number, number>>({});
    const [lastSolverMs, setLastSolverMs] = useState<number | null>(null);
    const [lastSolverSteps, setLastSolverSteps] = useState<number | null>(null);

    // Default estimates (ms) used before we have real timings from the backend.
    // These will get replaced/overridden by measured values as soon as the solver returns `solver.elapsedMs`.
    const DEFAULT_ESTIMATE_MS_BY_STEPS: Record<number, number> = {
        25: 800,
        35: 3500,
        45: 12000,
        50: 20000,
        60: 40000,
    };

    // Refs
    const abortControllerRef = useRef<AbortController | null>(null);
    const solvabilityRequestIdRef = useRef(0);
    const solvabilityDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const boardViewportRef = useRef<HTMLDivElement | null>(null);
    const [boardScale, setBoardScale] = useState(1);

    // Keep latest `move` in a ref so the auto-solve loop doesn't restart when `move` changes
    // (it changes every render because it depends on player/boxes state).
    const moveRef = useRef<((dir: MoveDirection, opts?: { skipSolvabilityCheck?: boolean }) => boolean) | null>(null);

    // UI State
    const [showHintModal, setShowHintModal] = useState(false);
    const [hintMessage, setHintMessage] = useState('');
    const [showVictoryModal, setShowVictoryModal] = useState(false);
    const [showAlertModal, setShowAlertModal] = useState(false);
    const [alertTitle, setAlertTitle] = useState('Puzzle Unsolvable!');
    const [alertMessage, setAlertMessage] = useState('The current state cannot lead to a solution.');
    const [isLoading, setIsLoading] = useState(false);
    const [showRandomDifficulty, setShowRandomDifficulty] = useState(false);
    const [randomDifficulty, setRandomDifficulty] = useState<1 | 2 | 3>(2);

    // Solution State
    const [solution, setSolution] = useState<string[] | null>(null);
    const [currentSolutionStep, setCurrentSolutionStep] = useState(0);
    const [showSolution, setShowSolution] = useState(false);

    // Auto-solve (apply solution)
    const [autoSolveStatus, setAutoSolveStatus] = useState<'idle' | 'finding' | 'playing'>('idle');
    const [autoSolveMoves, setAutoSolveMoves] = useState<string[] | null>(null);
    const [autoSolveIndex, setAutoSolveIndex] = useState(0);
    const autoSolveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Auto-advance to next official level after victory
    const victoryAutoNextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Initialization
    useEffect(() => {
        loadLevel(0);
    }, []);

    // Scale the board to fit the available space for official levels (1..153).
    // Keeps 50px cells as the "native" size and uses a wrapper transform for fit.
    useEffect(() => {
        const el = boardViewportRef.current;
        if (!el) return;

        const compute = () => {
            const rows = grid.length || 0;
            const cols = grid[0]?.length || 0;
            if (!rows || !cols) {
                setBoardScale(1);
                return;
            }

            const baseW =
                cols * BASE_CELL_SIZE +
                Math.max(0, cols - 1) * BASE_BOARD_GAP +
                2 * BASE_BOARD_PADDING;
            const baseH =
                rows * BASE_CELL_SIZE +
                Math.max(0, rows - 1) * BASE_BOARD_GAP +
                2 * BASE_BOARD_PADDING;

            const availableW = el.clientWidth || 0;
            const rect = el.getBoundingClientRect();
            const availableH = Math.max(200, window.innerHeight - rect.top - 24);

            const s = Math.min(
                MAX_BOARD_SCALE,
                availableW > 0 ? availableW / baseW : 1,
                availableH > 0 ? availableH / baseH : 1
            );
            setBoardScale(Math.max(0.25, s));
        };

        compute();
        const ro = new ResizeObserver(() => compute());
        ro.observe(el);
        window.addEventListener('resize', compute);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', compute);
        };
    }, [grid]);


    // Auto-advance to next official level after victory
    useEffect(() => {
        if (!showVictoryModal) return;

        if (victoryAutoNextTimerRef.current) {
            clearTimeout(victoryAutoNextTimerRef.current);
        }

        victoryAutoNextTimerRef.current = setTimeout(() => {
            setShowVictoryModal(false);
            const next = currentLevelIndex < PARSED_LEVELS.length - 1 ? currentLevelIndex + 1 : 0;
            loadLevel(next);
        }, 1500);

        return () => {
            if (victoryAutoNextTimerRef.current) {
                clearTimeout(victoryAutoNextTimerRef.current);
                victoryAutoNextTimerRef.current = null;
            }
        };
    }, [showVictoryModal, currentLevelIndex]);

    const loadLevel = (index: number) => {
        if (index < 0 || index >= PARSED_LEVELS.length) return;
        const level = PARSED_LEVELS[index];
        setCurrentLevelIndex(index);
        initializeLevel(level);
    };

    const loadRandomLevel = (difficulty: 1 | 2 | 3) => {
        const lvl = generateRandomLevel(difficulty);
        setCurrentLevelIndex(-1);
        initializeLevel(lvl);
    };

    const initializeLevel = (level: ParsedLevel) => {
        // Cancel any pending solvability debounce from the previous level/state
        if (solvabilityDebounceTimerRef.current) {
            clearTimeout(solvabilityDebounceTimerRef.current);
            solvabilityDebounceTimerRef.current = null;
        }

        // Stop any running auto-solve
        if (autoSolveTimerRef.current) {
            clearTimeout(autoSolveTimerRef.current);
            autoSolveTimerRef.current = null;
        }
        setAutoSolveStatus('idle');
        setAutoSolveMoves(null);
        setAutoSolveIndex(0);

        setCurrentLevel(level);
        // Deep copy
        setGrid(level.parsedGrid.map(row => [...row]));
        setPlayer({ ...level.initialPlayer });
        setBoxes(level.initialBoxes.map(b => ({ ...b })));
        setGoals(level.goals.map(g => ({ ...g })));
        setMoveCount(0);
        setMoveHistory([]);
        setSolvabilityStatus('checking');
        setShowVictoryModal(false);
        setShowAlertModal(false);
        setAlertTitle('Puzzle Unsolvable!');
        setAlertMessage('The current state cannot lead to a solution.');
        // Reset solution
        setSolution(null);
        setCurrentSolutionStep(0);
        setShowSolution(false);

        // Check initial solvability
        checkSolvability({
            grid: level.parsedGrid.map(row => [...row]),
            player: { ...level.initialPlayer },
            boxes: level.initialBoxes.map(b => ({ ...b })),
            goals: level.goals.map(g => ({ ...g }))
        }, { hasUndo: false, mode: solverMode, maxSteps: solverBaseMaxSteps });
    };

    const checkSolvability = async (
        gameState: any,
        opts?: SolvabilityCheckOpts
    ) => {
        const requestId = ++solvabilityRequestIdRef.current;

        // Cancel previous request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort('New move initiated');
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;

        setIsCheckingSolvability(true);
        setSolvabilityStatus('checking');
        // Avoid stale cached hint/solution while checking a new state
        setCachedHintMessage(null);
        setCachedSolution(null);
        setCachedSolutionTooLong(false);

        const hasUndo = opts?.hasUndo ?? moveHistory.length > 0;
        const mode: SolverSearchMode = opts?.mode ?? solverMode;
        const startMaxSteps = opts?.maxSteps ?? solverBaseMaxSteps;
        const refreshSolution = opts?.refreshSolution ?? false;

        try {
            const recordTiming = (result: any) => {
                if (result.solver?.elapsedMs != null && result.solver?.maxStepsUsed != null) {
                    const used = result.solver.maxStepsUsed;
                    const ms = result.solver.elapsedMs;
                    setLastSolverMs(ms);
                    setLastSolverSteps(used);
                    setSolverTimingsBySteps(prev => {
                        const old = prev[used];
                        // Simple EMA to smooth variance
                        const next = old == null ? ms : Math.round(old * 0.7 + ms * 0.3);
                        return { ...prev, [used]: next };
                    });
                }
            };

            const applyFinal = (result: any) => {
                if (result.solvable === true) {
                    setSolvabilityStatus('solvable');
                    setShowAlertModal(false);
                    // Cache hint and solution
                    if (result.hintMessage) setCachedHintMessage(result.hintMessage);
                    if (result.solution) {
                        if (Array.isArray(result.solution) && result.solution.length > MAX_SOLUTION_MOVES) {
                            // Treat as "no usable solution" for the UI (Apply Solution would be too long).
                            setCachedSolution(null);
                            setCachedSolutionTooLong(true);
                        } else {
                            setCachedSolution(result.solution);
                            setCachedSolutionTooLong(false);
                        }
                    } else {
                        setCachedSolution(null);
                        setCachedSolutionTooLong(false);
                    }
                    if (refreshSolution) {
                        if (result.solution && Array.isArray(result.solution) && result.solution.length > MAX_SOLUTION_MOVES) {
                            setSolution(null);
                            setCurrentSolutionStep(0);
                            setShowSolution(false);
                        } else if (result.solution) {
                            setSolution(result.solution);
                            setCurrentSolutionStep(0);
                            setShowSolution(true);
                        } else {
                            setSolution(null);
                            setCurrentSolutionStep(0);
                        }
                    }
                    return;
                }

                if (result.solvable === false) {
                    setSolvabilityStatus('unsolvable');
                    setCachedHintMessage(null);
                    setCachedSolution(null);
                    setCachedSolutionTooLong(false);
                    if (refreshSolution) {
                        setSolution(null);
                        setShowSolution(false);
                        setCurrentSolutionStep(0);
                    }

                    if (hasUndo) {
                        // The player created a dead-end state (we can undo back).
                        setAlertTitle('Deadlock!');
                        const baseMessage = result.message || 'This move makes the puzzle unsolvable.';
                        setAlertMessage(`${baseMessage} Try using Undo.`);
                    } else {
                        // Unsolvable from the initial state (detected by deadlock checks).
                        setAlertTitle('Unsolvable!');
                        const baseMessage = result.message || 'This puzzle is unsolvable from the start.';
                        setAlertMessage(`${baseMessage} Try another level.`);
                    }
                    setTimeout(() => setShowAlertModal(true), 600);
                    return;
                }

                if (result.solvable === null) {
                    setSolvabilityStatus('unknown');
                    setCachedHintMessage(null);
                    setCachedSolution(null);
                    setCachedSolutionTooLong(false);
                    if (refreshSolution) {
                        setSolution(null);
                        setShowSolution(false);
                        setCurrentSolutionStep(0);
                    }
                    return;
                }

                // Only show error if it wasn't an abort
                if (result.error !== 'Aborted') {
                    setSolvabilityStatus('error');
                }
                setCachedHintMessage(null);
                setCachedSolution(null);
                setCachedSolutionTooLong(false);
                if (refreshSolution) {
                    setSolution(null);
                    setShowSolution(false);
                    setCurrentSolutionStep(0);
                }
            };

            const runOnce = async (maxSteps: number, timeoutSec?: number) => {
                const result = await SokobanAPI.checkSolvable(
                    { ...gameState, maxSteps, timeoutSec, optimal: solverOptimal },
                    controller.signal
                );
                if (controller.signal.aborted) return null;
                if (requestId !== solvabilityRequestIdRef.current) return null;
                recordTiming(result);
                return result;
            };

            if (mode === 'fixed') {
                const result = await runOnce(startMaxSteps);
                if (!result) return;
                applyFinal(result);
                return;
            }

            // mode === 'auto' (35+): ONE HTTP call.
            // Backend keeps increasing the horizon internally until it finds a solution
            // or the user moves again (AbortController cancels the request).
            const result = await SokobanAPI.checkSolvable(
                { ...gameState, auto: true, maxSteps: startMaxSteps, optimal: solverOptimal },
                controller.signal
            );
            if (controller.signal.aborted) return;
            if (requestId !== solvabilityRequestIdRef.current) return;
            recordTiming(result);
            applyFinal(result);
            return;
        } finally {
            // Only clear "checking" for the latest request
            if (requestId === solvabilityRequestIdRef.current) {
                setIsCheckingSolvability(false);
            }
        }
    };

    const scheduleSolvabilityCheck = (gameState: any, opts?: SolvabilityCheckOpts, debounceMs: number = 200) => {
        // Cancel any scheduled check
        if (solvabilityDebounceTimerRef.current) {
            clearTimeout(solvabilityDebounceTimerRef.current);
            solvabilityDebounceTimerRef.current = null;
        }

        // Abort in-flight request (we already know a newer state is coming)
        if (abortControllerRef.current) {
            abortControllerRef.current.abort('New move initiated');
        }

        solvabilityDebounceTimerRef.current = setTimeout(() => {
            solvabilityDebounceTimerRef.current = null;
            checkSolvability(gameState, opts);
        }, debounceMs);
    };

    // Game Logic
    const move = useCallback((
        direction: MoveDirection,
        opts?: { skipSolvabilityCheck?: boolean }
    ): boolean => {
        if (showVictoryModal || isLoading) return false;

        const shouldRefreshSolutionPath =
            !opts?.skipSolvabilityCheck &&
            !!solution &&
            currentSolutionStep < solution.length &&
            solution[currentSolutionStep] !== direction;

        const isWall = (x: number, y: number) => {
            if (y < 0 || y >= grid.length) return true;
            const row = grid[y];
            if (!row) return true;
            if (x < 0 || x >= row.length) return true;
            return row[x] === '#' || row[x] === 'x';
        };

        const delta = {
            'up': { x: 0, y: -1 },
            'down': { x: 0, y: 1 },
            'left': { x: -1, y: 0 },
            'right': { x: 1, y: 0 }
        };

        const d = delta[direction];
        const newX = player.x + d.x;
        const newY = player.y + d.y;

        // Check bounds / walls (supports ragged grids)
        if (isWall(newX, newY)) return false;

        // Check box
        const boxIndex = boxes.findIndex(b => b.x === newX && b.y === newY);

        if (boxIndex !== -1) { // Pushing a box
            const boxNewX = newX + d.x;
            const boxNewY = newY + d.y;

            if (boxNewY < 0 || boxNewY >= grid.length ||
                isWall(boxNewX, boxNewY) ||
                boxes.some(b => b.x === boxNewX && b.y === boxNewY)) {
                return false;
            }

            // Save state
            saveState();

            // Update state
            const newBoxes = [...boxes];
            newBoxes[boxIndex] = { x: boxNewX, y: boxNewY };
            setBoxes(newBoxes);
            setPlayer({ x: newX, y: newY });
            setMoveCount(prev => prev + 1);

            // Check win
            const isWin = newBoxes.every(box => goals.some(g => g.x === box.x && g.y === box.y));
            if (isWin) {
                setTimeout(() => setShowVictoryModal(true), 500);
            } else {
                if (!opts?.skipSolvabilityCheck) {
                    const debounceMs = shouldRefreshSolutionPath ? 50 : 80; // pushes change state -> check quickly
                    scheduleSolvabilityCheck(
                        {
                            grid,
                            player: { x: newX, y: newY },
                            boxes: newBoxes,
                            goals
                        },
                        { hasUndo: true, mode: solverMode, maxSteps: solverBaseMaxSteps, refreshSolution: shouldRefreshSolutionPath },
                        debounceMs
                    );
                }
            }

        } else { // Just moving
            saveState();
            setPlayer({ x: newX, y: newY });
            setMoveCount(prev => prev + 1);

            if (!opts?.skipSolvabilityCheck) {
                const debounceMs = shouldRefreshSolutionPath ? 50 : 250; // walking -> debounce to avoid spamming API
                scheduleSolvabilityCheck(
                    {
                        grid,
                        player: { x: newX, y: newY },
                        boxes,
                        goals
                    },
                    { hasUndo: true, mode: solverMode, maxSteps: solverBaseMaxSteps, refreshSolution: shouldRefreshSolutionPath },
                    debounceMs
                );
            }
        }

        // Update solution progress if solution is being shown
        if (solution && currentSolutionStep < solution.length) {
            const expectedDirection = solution[currentSolutionStep];
            if (expectedDirection === direction) {
                setCurrentSolutionStep(prev => prev + 1);
            } else if (shouldRefreshSolutionPath) {
                // Hide the stale path while we recompute a new one for the new state
                setSolution(null);
                setCurrentSolutionStep(0);
                setShowSolution(true);
            }
        }
        return true;
    }, [boxes, grid, goals, player, showVictoryModal, isLoading, solution, currentSolutionStep, solverMode, solverBaseMaxSteps, scheduleSolvabilityCheck]);

    // Keep moveRef updated with the latest move implementation
    useEffect(() => {
        moveRef.current = move;
    }, [move]);

    const saveState = () => {
        setMoveHistory(prev => [...prev, {
            player: { ...player },
            boxes: boxes.map(b => ({ ...b })),
            moveCount
        }]);
    };

    const undoMove = () => {
        // Stop auto-solve on manual action
        if (autoSolveTimerRef.current) {
            clearTimeout(autoSolveTimerRef.current);
            autoSolveTimerRef.current = null;
        }
        setAutoSolveStatus('idle');
        setAutoSolveMoves(null);
        setAutoSolveIndex(0);

        // Cancel any pending solvability debounce
        if (solvabilityDebounceTimerRef.current) {
            clearTimeout(solvabilityDebounceTimerRef.current);
            solvabilityDebounceTimerRef.current = null;
        }

        if (moveHistory.length === 0) return;
        const lastState = moveHistory[moveHistory.length - 1];
        setPlayer(lastState.player);
        setBoxes(lastState.boxes);
        setMoveCount(lastState.moveCount);
        setMoveHistory(prev => prev.slice(0, -1));
        const remainingHistory = Math.max(0, moveHistory.length - 1);
        checkSolvability({
            grid,
            player: lastState.player,
            boxes: lastState.boxes,
            goals
        }, { hasUndo: remainingHistory > 0, mode: solverMode, maxSteps: solverBaseMaxSteps });
    };

    const formatMs = (ms: number) => {
        if (ms < 1000) return `${ms}ms`;
        const s = ms / 1000;
        if (s < 60) return `${s.toFixed(1)}s`;
        const m = Math.floor(s / 60);
        const r = (s % 60).toFixed(0).padStart(2, '0');
        return `${m}:${r}min`;
    };

    const estimateMsForSteps = (targetSteps: number): number | null => {
        const direct = solverTimingsBySteps[targetSteps];
        if (direct != null) return direct;

        const entries = Object.entries(solverTimingsBySteps)
            .map(([k, v]) => ({ steps: Number(k), ms: v }))
            .filter(e => Number.isFinite(e.steps) && Number.isFinite(e.ms))
            .sort((a, b) => a.steps - b.steps);

        if (entries.length === 0) {
            const fallback = DEFAULT_ESTIMATE_MS_BY_STEPS[targetSteps];
            if (fallback != null) return fallback;

            const baseSteps = 35;
            const baseMs = DEFAULT_ESTIMATE_MS_BY_STEPS[baseSteps] ?? 3500;
            const ratio = targetSteps / baseSteps;
            return Math.round(baseMs * Math.pow(ratio, 4));
        }
        if (entries.length === 1) {
            const base = entries[0];
            const ratio = targetSteps / base.steps;
            // Heuristic: grounding cost grows superlinearly with max_steps
            return Math.round(base.ms * Math.pow(ratio, 4));
        }

        // Use the closest two points to fit a power law ms ≈ c * steps^p
        let lower = entries[0];
        let upper = entries[entries.length - 1];
        for (let i = 0; i < entries.length - 1; i++) {
            if (entries[i].steps <= targetSteps && targetSteps <= entries[i + 1].steps) {
                lower = entries[i];
                upper = entries[i + 1];
                break;
            }
            if (targetSteps < entries[0].steps) {
                lower = entries[0];
                upper = entries[1];
                break;
            }
            if (targetSteps > entries[entries.length - 1].steps) {
                lower = entries[entries.length - 2];
                upper = entries[entries.length - 1];
                break;
            }
        }

        const p = Math.log(upper.ms / lower.ms) / Math.log(upper.steps / lower.steps);
        const c = lower.ms / Math.pow(lower.steps, p);
        return Math.round(c * Math.pow(targetSteps, p));
    };

    const applySolverSettings = async () => {
        // Stop auto-solve on manual action
        if (autoSolveTimerRef.current) {
            clearTimeout(autoSolveTimerRef.current);
            autoSolveTimerRef.current = null;
        }
        setAutoSolveStatus('idle');
        setAutoSolveMoves(null);
        setAutoSolveIndex(0);

        // Cancel any pending solvability debounce
        if (solvabilityDebounceTimerRef.current) {
            clearTimeout(solvabilityDebounceTimerRef.current);
            solvabilityDebounceTimerRef.current = null;
        }

        checkSolvability(
            { grid, player, boxes, goals },
            { hasUndo: moveHistory.length > 0, mode: solverMode, maxSteps: solverBaseMaxSteps }
        );
    };

    const stopAutoSolve = () => {
        if (autoSolveTimerRef.current) {
            clearTimeout(autoSolveTimerRef.current);
            autoSolveTimerRef.current = null;
        }
        setAutoSolveStatus('idle');
        setAutoSolveMoves(null);
        setAutoSolveIndex(0);
    };

    const startAutoSolveWithMoves = (moves: string[]) => {
        if (!moves || moves.length === 0) {
            setHintMessage('✅ Already solved (no moves needed).');
            setShowHintModal(true);
            stopAutoSolve();
            return;
        }
        setSolution(moves);
        setCurrentSolutionStep(0);
        setShowSolution(true);
        setAutoSolveMoves(moves);
        setAutoSolveIndex(0);
        setAutoSolveStatus('playing');
    };

    const handleAutoSolve = async () => {
        if (autoSolveStatus === 'playing' || autoSolveStatus === 'finding') {
            stopAutoSolve();
            return;
        }

        // If we already have a solution from the last solver call, use it.
        if (cachedSolution && cachedSolution.length > 0) {
            startAutoSolveWithMoves(cachedSolution);
            return;
        }
        if (cachedSolutionTooLong) {
            setHintMessage(`❌ Unable to apply a solution: the found solution exceeds ${MAX_SOLUTION_MOVES} moves.`);
            setShowHintModal(true);
            stopAutoSolve();
            return;
        }

        // Otherwise, request an auto search (35+) from the current state, then auto-play when ready.
        setAutoSolveStatus('finding');
        checkSolvability(
            { grid, player, boxes, goals },
            { hasUndo: moveHistory.length > 0, mode: 'auto', maxSteps: 35 }
        );
    };

    // When we're "finding" and a solution arrives, start auto-play.
    useEffect(() => {
        if (autoSolveStatus !== 'finding') return;
        if (cachedSolution && cachedSolution.length > 0) {
            startAutoSolveWithMoves(cachedSolution);
            return;
        }
        if (cachedSolutionTooLong) {
            setHintMessage(`❌ No usable solution within ${MAX_SOLUTION_MOVES} moves.`);
            setShowHintModal(true);
            stopAutoSolve();
            return;
        }
        if (solvabilityStatus === 'unsolvable') {
            setHintMessage('❌ No solution available from this state (deadlock detected).');
            setShowHintModal(true);
            stopAutoSolve();
        }
    }, [autoSolveStatus, cachedSolution, cachedSolutionTooLong, solvabilityStatus]);

    // Auto-play loop
    useEffect(() => {
        if (autoSolveStatus !== 'playing') return;
        if (!autoSolveMoves) return;
        if (showVictoryModal) {
            stopAutoSolve();
            return;
        }
        if (autoSolveIndex >= autoSolveMoves.length) {
            stopAutoSolve();
            return;
        }

        const dir = autoSolveMoves[autoSolveIndex] as MoveDirection;
        if (!['up', 'down', 'left', 'right'].includes(dir)) {
            setHintMessage('❌ Invalid move in solution path.');
            setShowHintModal(true);
            stopAutoSolve();
            return;
        }

        const ok = moveRef.current?.(dir, { skipSolvabilityCheck: true }) ?? false;
        if (!ok) {
            setHintMessage('❌ Auto-solve stopped: current state no longer matches the cached solution path.');
            setShowHintModal(true);
            stopAutoSolve();
            return;
        }

        autoSolveTimerRef.current = setTimeout(() => {
            setAutoSolveIndex(prev => prev + 1);
        }, 350);

        return () => {
            if (autoSolveTimerRef.current) {
                clearTimeout(autoSolveTimerRef.current);
                autoSolveTimerRef.current = null;
            }
        };
    }, [autoSolveStatus, autoSolveMoves, autoSolveIndex, showVictoryModal]);

    const resetLevel = () => {
        stopAutoSolve();
        // Cancel any pending solvability debounce
        if (solvabilityDebounceTimerRef.current) {
            clearTimeout(solvabilityDebounceTimerRef.current);
            solvabilityDebounceTimerRef.current = null;
        }
        if (currentLevel) {
            initializeLevel(currentLevel);
        }
    };

    const handleGetHint = async () => {
        // Avoid using stale cached data while solver is running
        if (solvabilityStatus === 'checking' || isCheckingSolvability) {
            setHintMessage('⏳ Status en cours de calcul… réessaie dans un instant.');
            setShowHintModal(true);
            return;
        }

        // Check if already marked as unsolvable or unknown
        if (solvabilityStatus === 'unsolvable') {
            const hasUndo = moveHistory.length > 0;
            setHintMessage(
                hasUndo
                    ? '❌ This puzzle is unsolvable from the current state. Try using Undo or Reset.'
                    : '❌ This level is unsolvable from the start. Try another level or generate a new random map.'
            );
            setShowHintModal(true);
            return;
        }

        if (solvabilityStatus === 'unknown') {
            setHintMessage('⚠️ Status unknown (no solution found within the current search limit). This state may still be solvable with a longer plan, or it may be unsolvable. Try exploring more moves, Undo/Reset, or request a deeper search.');
            setShowHintModal(true);
            return;
        }

        const directionEmoji = {
            'up': '⬆️',
            'down': '⬇️',
            'left': '⬅️',
            'right': '➡️'
        } as any;

        // Use cached solver response from the last /check-solvable call (triggered by the move)
        if (cachedHintMessage) {
            setHintMessage(cachedHintMessage);
            setShowHintModal(true);
            return;
        }

        // Fallback: derive hint from cached solution path
        if (cachedSolution && cachedSolution.length > 0) {
            const dir = cachedSolution[0];
            setHintMessage(`${directionEmoji[dir] || ''} Try moving ${dir}!`);
            setShowHintModal(true);
            return;
        }
        if (cachedSolutionTooLong) {
            setHintMessage(`⚠️ A solution exists but is longer than ${MAX_SOLUTION_MOVES} moves, so it won't be shown/applied.`);
            setShowHintModal(true);
            return;
        }

        setHintMessage('No hint available for this state.');
        setShowHintModal(true);
    };

    const handleGetSolution = async () => {
        // Avoid using stale cached data while solver is running
        if (solvabilityStatus === 'checking' || isCheckingSolvability) {
            setHintMessage('⏳ Status en cours de calcul… réessaie dans un instant.');
            setShowHintModal(true);
            return;
        }

        // Check if already marked as unsolvable or unknown
        if (solvabilityStatus === 'unsolvable') {
            const hasUndo = moveHistory.length > 0;
            setHintMessage(
                hasUndo
                    ? '❌ This puzzle is unsolvable from the current state. Try using Undo or Reset.'
                    : '❌ This level is unsolvable from the start. Try another level or generate a new random map.'
            );
            setShowHintModal(true);
            return;
        }

        if (solvabilityStatus === 'unknown') {
            setHintMessage('⚠️ Status unknown (no solution found within the current search limit). This state may still be solvable with a longer plan, or it may be unsolvable. Try exploring more moves, Undo/Reset, or request a deeper search.');
            setShowHintModal(true);
            return;
        }

        // Use cached solver response from the last /check-solvable call (triggered by the move)
        if (cachedSolution && cachedSolution.length > 0) {
            setSolution(cachedSolution);
            setCurrentSolutionStep(0);
            setShowSolution(true);
            return;
        }
        if (cachedSolutionTooLong) {
            setHintMessage(`❌ Unable to show solution: the solver found a plan longer than ${MAX_SOLUTION_MOVES} moves.`);
            setShowHintModal(true);
            return;
        }

        if (cachedSolution && cachedSolution.length === 0) {
            setHintMessage('✅ This state is already solved.');
            setShowHintModal(true);
            return;
        }

        setHintMessage('No solution path available for this state.');
        setShowHintModal(true);
    };

    const toggleSolution = () => {
        if (showSolution) {
            setShowSolution(false);
            return;
        }

        // When opening, refresh displayed solution from the latest cached path
        if (cachedSolution && cachedSolution.length > 0) {
            setSolution(cachedSolution);
            setCurrentSolutionStep(0);
            setShowSolution(true);
            return;
        }
        if (cachedSolutionTooLong) {
            setHintMessage(`❌ Unable to show solution: the solver found a plan longer than ${MAX_SOLUTION_MOVES} moves.`);
            setShowHintModal(true);
            return;
        }

        // If there's no cached solution, reuse the same UX as "Show Solution"
        handleGetSolution();
    };

    // Keyboard listeners
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key)) {
                e.preventDefault();
            }

            const keyMap: any = {
                'ArrowUp': 'up', 'ArrowDown': 'down', 'ArrowLeft': 'left', 'ArrowRight': 'right',
                'w': 'up', 'a': 'left', 's': 'down', 'd': 'right'
            };

            const dir = keyMap[e.key];
            if (dir) {
                // Manual input stops auto-solve
                if (autoSolveStatus !== 'idle') stopAutoSolve();
                move(dir);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [move, autoSolveStatus]);


    // Rendering Helpers
    const getCellContent = (x: number, y: number) => {
        // Player
        if (player.x === x && player.y === y) return <div className="player">🧍</div>;

        // Box
        const boxIndex = boxes.findIndex(b => b.x === x && b.y === y);
        if (boxIndex !== -1) {
            const isOnGoal = goals.some(g => g.x === x && g.y === y);
            return (
                <div className={`box ${isOnGoal ? 'on-goal' : ''}`} style={{ position: 'relative' }}>
                    {isOnGoal ? '✅' : '📦'}
                    <span style={{
                        position: 'absolute',
                        top: '-5px',
                        right: '-5px',
                        background: 'rgba(0,0,0,0.7)',
                        color: 'white',
                        borderRadius: '50%',
                        width: '18px',
                        height: '18px',
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10
                    }}>
                        {boxIndex + 1}
                    </span>
                </div>
            );
        }

        return null;
    };

    if (!currentLevel) return <div className="loading-overlay show"><div className="loading-spinner"></div></div>;

    const boxesOnGoals = boxes.filter(b => goals.some(g => g.x === b.x && g.y === b.y)).length;
    const rows = grid.length || 0;
    const cols = grid[0]?.length || 0;
    const baseBoardH =
        rows * BASE_CELL_SIZE +
        Math.max(0, rows - 1) * BASE_BOARD_GAP +
        2 * BASE_BOARD_PADDING;
    const scaledBoardH = Math.round(baseBoardH * boardScale);

    return (
        <div className="container">
            <header className="game-header">
                <h1 className="game-title">
                    <span className="title-icon">🎮</span>
                    Sokoban
                    <span className="subtitle">ASP-Powered Puzzle</span>
                </h1>
                <p className="game-description">Push all boxes to goal positions using intelligent AI hints!</p>
            </header>

            <div className="game-layout">
                {/* Left Panel: Game Board */}
                <div className="game-board-container glass-panel">
                    <div className="level-info">
                        <div className="info-item">
                            <span className="info-label">Level</span>
                            <span className="info-value">{currentLevel.name}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Moves</span>
                            <span className="info-value">{moveCount}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Boxes</span>
                            <span className="info-value">
                                {boxesOnGoals}/{goals.length}
                            </span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Status</span>
                            <div className={`solvability-badge ${solvabilityStatus}`}>
                                {solvabilityStatus === 'checking' && <span className="spinner-small"></span>}
                                <span>
                                    {solvabilityStatus === 'checking' ? 'Checking' :
                                        solvabilityStatus === 'solvable' ? 'Solvable' :
                                            solvabilityStatus === 'unsolvable'
                                                ? (moveHistory.length > 0 ? 'Try Undo?' : 'Unsolvable')
                                                : solvabilityStatus === 'unknown' ? 'Unknown' : '...'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div
                        ref={boardViewportRef}
                        style={{
                            width: '100%',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'flex-start',
                            overflow: 'hidden',
                            // Reserve the scaled height so the rest of the card doesn't overlap the board.
                            height: `${scaledBoardH}px`,
                        }}
                    >
                        <div
                            style={{
                                transform: `scale(${boardScale})`,
                                transformOrigin: 'top center',
                                width: 'fit-content',
                            }}
                        >
                            <div className="game-board" style={{ gridTemplateColumns: `repeat(${cols || 0}, ${BASE_CELL_SIZE}px)` }}>
                                {grid.map((row, y) => (
                                    row.map((cellType, x) => (
                                        <div
                                            key={`${x}-${y}`}
                                            className={`cell ${cellType === 'x' ? 'void' : cellType === '#' ? 'wall' : cellType === '.' ? 'goal' : 'floor'}`}
                                        >
                                            {cellType === '#' && '🧱'}
                                            {getCellContent(x, y)}
                                        </div>
                                    ))
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Solution Display */}
                    {solution && showSolution && (
                        <div className="solution-display" style={{
                            marginTop: '1.5rem',
                            padding: '1.5rem',
                            background: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '12px',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            width: '100%',
                            // Let it take the size it needs inside the parent card (no clipping).
                            // Jitter is prevented by fixed-size badges + constant border width.
                            overflow: 'visible'
                        }}>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '1rem',
                                gap: '1rem'
                            }}>
                                <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--primary-color)' }}>Solution Path</h3>
                                <span style={{
                                    fontSize: '0.85rem',
                                    color: currentSolutionStep >= solution.length ? '#4ade80' : 'var(--text-secondary)',
                                    fontWeight: '600',
                                    // Keep the header width stable as numbers change (9 -> 10 etc.)
                                    fontVariantNumeric: 'tabular-nums',
                                    minWidth: '10rem',
                                    textAlign: 'right'
                                }}>
                                    {currentSolutionStep >= solution.length ? '✅ Completed!' : `Step ${currentSolutionStep + 1}/${solution.length}`}
                                </span>
                            </div>
                            <div style={{
                                // Use a fixed-size grid so wrapping does NOT cause layout jitter
                                // when highlighting the current step.
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, 44px)',
                                gap: '0.5rem',
                                justifyContent: 'center',
                                alignContent: 'start',
                                overflow: 'visible',
                                paddingBottom: '1.25rem',
                                scrollbarGutter: 'stable'
                            }}>
                                {solution.map((dir, idx) => {
                                    const emoji = {
                                        'up': '⬆️',
                                        'down': '⬇️',
                                        'left': '⬅️',
                                        'right': '➡️'
                                    }[dir] || '❓';

                                    const isCurrentStep = idx === currentSolutionStep;
                                    const isPastStep = idx < currentSolutionStep;

                                    return (
                                        <div
                                            key={idx}
                                            style={{
                                                width: '44px',
                                                height: '64px', // reserve space for the label to avoid overlapping the next row
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                justifyContent: 'flex-start',
                                            }}
                                        >
                                            <div style={{
                                                fontSize: '1.5rem',
                                                width: '44px',
                                                height: '44px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                borderRadius: '8px',
                                                background: isCurrentStep
                                                    ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                                                    : isPastStep
                                                        ? 'rgba(74, 222, 128, 0.2)'
                                                        : 'rgba(255, 255, 255, 0.05)',
                                                // Keep border width constant to avoid jitter
                                                border: '2px solid',
                                                borderColor: isCurrentStep ? '#fff' : 'rgba(255, 255, 255, 0.1)',
                                                boxSizing: 'border-box',
                                                opacity: isPastStep ? 0.5 : 1,
                                                transition: 'all 0.3s ease',
                                                boxShadow: isCurrentStep ? '0 0 20px rgba(102, 126, 234, 0.5)' : 'none',
                                            }}>
                                                {emoji}
                                            </div>
                                            <div style={{
                                                height: '20px',
                                                lineHeight: '20px',
                                                fontSize: '0.7rem',
                                                color: '#fff',
                                                whiteSpace: 'nowrap',
                                                opacity: isCurrentStep ? 1 : 0, // keep layout stable for all items
                                                transition: 'opacity 0.2s ease',
                                                userSelect: 'none',
                                                pointerEvents: 'none'
                                            }}>
                                                Next
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Panel: Controls */}
                <div className="controls-container glass-panel">
                    <h2 className="controls-title">Game Controls</h2>

                    <div className="controls-section">
                        <h3 className="section-title">Actions</h3>
                        <button className="btn btn-primary" onClick={handleGetHint} disabled={isLoading}>
                            <span className="btn-icon">💡</span>
                            Get Hint
                        </button>
                        <button className="btn btn-secondary" onClick={undoMove} disabled={moveHistory.length === 0}>
                            <span className="btn-icon">↶</span>
                            Undo Move
                        </button>
                        <button className="btn btn-secondary" onClick={resetLevel}>
                            <span className="btn-icon">🔄</span>
                            Reset Level
                        </button>
                    </div>

                    <div className="controls-section">
                        <h3 className="section-title">Solver Settings</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    Search limit (max steps)
                                </label>
                                <select
                                    value={solverSearchLimit}
                                    onChange={(e) => setSolverSearchLimit(e.target.value as SolverSearchLimit)}
                                    style={{
                                        padding: '0.6rem 0.75rem',
                                        borderRadius: '10px',
                                        border: '1px solid rgba(255,255,255,0.15)',
                                        background: 'rgba(255,255,255,0.06)',
                                        color: 'var(--text-primary)',
                                        outline: 'none'
                                    }}
                                >
                                    <option value="25">25</option>
                                    <option value="35">35</option>
                                    <option value="35+">35+ (auto)</option>
                                </select>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    Est. time: {(() => {
                                        const est = estimateMsForSteps(solverBaseMaxSteps);
                                        if (est == null) return '—';
                                        return solverMode === 'auto' ? `~${formatMs(est)}+` : `~${formatMs(est)}`;
                                    })()}
                                    {lastSolverMs != null && lastSolverSteps != null && (
                                        <span> · Last: {formatMs(lastSolverMs)} (steps={lastSolverSteps})</span>
                                    )}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', opacity: 0.9 }}>
                                    35+ keeps searching until you move again (or a deadlock/solution is found).
                                </div>
                            </div>

                            <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                fontSize: '0.9rem',
                                color: 'var(--text-secondary)',
                                userSelect: 'none'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={solverOptimal}
                                    onChange={(e) => setSolverOptimal(e.target.checked)}
                                    disabled={isCheckingSolvability}
                                />
                                Prefer shorter solution (optimal) — slower
                            </label>

                            <button
                                className="btn btn-secondary"
                                onClick={applySolverSettings}
                                disabled={isCheckingSolvability}
                            >
                                <span className="btn-icon">⚙️</span>
                                Apply & Recheck
                            </button>
                        </div>
                    </div>

                    <div className="controls-section">
                        <h3 className="section-title">Solution Helper</h3>
                        {!solution ? (
                            <button className="btn btn-primary" onClick={handleGetSolution} disabled={isLoading}>
                                <span className="btn-icon">🔍</span>
                                Show Solution
                            </button>
                        ) : (
                            <button className="btn btn-secondary" onClick={toggleSolution}>
                                <span className="btn-icon">{showSolution ? '👁️' : '🙈'}</span>
                                {showSolution ? 'Hide Solution' : 'Show Solution'}
                            </button>
                        )}

                        <button
                            className="btn btn-primary"
                            onClick={handleAutoSolve}
                            disabled={showVictoryModal}
                            style={{ marginTop: '0.75rem' }}
                        >
                            <span className="btn-icon">{autoSolveStatus === 'playing' || autoSolveStatus === 'finding' ? '⏹️' : '▶️'}</span>
                            {autoSolveStatus === 'playing' ? 'Stop Auto Solve' :
                                autoSolveStatus === 'finding' ? 'Stop (Finding...)' :
                                    'Apply Solution'}
                        </button>
                    </div>

                    <div className="controls-section">
                        <h3 className="section-title">How to Play</h3>
                        <div className="instructions">
                            <p><strong>Goal:</strong> Push all boxes 📦 onto goal positions 🎯</p>
                            <p><strong>Controls:</strong> Use Arrow Keys or WASD to move</p>
                            <p><strong>Hint System:</strong> Click &quot;Get Hint&quot; for AI-powered suggestions</p>
                        </div>
                    </div>

                    {/* Random Generator (moved to the end of Game Controls) */}
                    <div className="controls-section">
                        <h3 className="section-title">Random Generator</h3>

                        <button
                            className="btn btn-primary"
                            onClick={() => setShowRandomDifficulty(!showRandomDifficulty)}
                        >
                            <span className="btn-icon">🎲</span>
                            Random Level
                        </button>

                        {showRandomDifficulty && (
                            <div className="random-difficulty" style={{ marginTop: '0.75rem' }}>
                                <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>
                                    Difficulty:
                                </label>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    {[1, 2, 3].map(d => (
                                        <button
                                            key={d}
                                            className={`btn-diff ${randomDifficulty === d ? 'active' : ''}`}
                                            onClick={() => {
                                                setRandomDifficulty(d as 1 | 2 | 3);
                                                loadRandomLevel(d as 1 | 2 | 3);
                                            }}
                                        >
                                            {d === 1 ? 'Easy' : d === 2 ? 'Medium' : 'Hard'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Hint Modal */}
            <div className={`hint-modal ${showHintModal ? 'show' : ''}`}>
                <div className="hint-content">
                    <div className="hint-icon">💡</div>
                    <p className="hint-message">{hintMessage}</p>
                    <button className="btn btn-primary" onClick={() => setShowHintModal(false)}>Got it!</button>
                </div>
            </div>

            {/* Victory Modal */}
            <div className={`victory-modal ${showVictoryModal ? 'show' : ''}`}>
                <div className="victory-content">
                    <h2 className="victory-title">🎉 Level Complete! 🎉</h2>
                    <p className="victory-stats">Completed in {moveCount} moves!</p>
                    <div className="victory-buttons">
                        <button className="btn btn-primary" onClick={() => {
                            setShowVictoryModal(false);
                            const next = currentLevelIndex < PARSED_LEVELS.length - 1 ? currentLevelIndex + 1 : 0;
                            loadLevel(next);
                        }}>Next Level</button>
                        <button className="btn btn-secondary" onClick={resetLevel}>Replay</button>
                    </div>
                </div>
            </div>

            {/* Alert Modal */}
            <div className={`alert-modal ${showAlertModal ? 'show' : ''}`}>
                <div className="alert-content">
                    <div className="alert-icon">⚠️</div>
                    <h2 className="alert-title">{alertTitle}</h2>
                    <p className="alert-message">{alertMessage}</p>
                    <button className="btn btn-primary" onClick={() => setShowAlertModal(false)}>OK</button>
                </div>
            </div>

            {/* Loading Overlay */}
            <div className={`loading-overlay ${isLoading ? 'show' : ''}`}>
                <div className="loading-spinner"></div>
                <p className="loading-text">Processing with ASP solver...</p>
            </div>

            {/* Official Levels */}
            <div className="card glass-panel" style={{ marginTop: '2rem', padding: '1.5rem' }}>
                <h2 className="controls-title" style={{ marginBottom: '1rem' }}>📜 Official Levels (1–{PARSED_LEVELS.length})</h2>
                <div style={{
                    maxHeight: '650px',
                    overflow: 'auto',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '1rem',
                    paddingRight: '0.5rem'
                }}>
                    {PARSED_LEVELS.map((lvl, idx) => (
                        <div
                            key={lvl.id}
                            className="map-card"
                            style={{
                                background: currentLevelIndex === idx ? 'rgba(102, 126, 234, 0.15)' : 'rgba(255,255,255,0.05)',
                                padding: '1rem',
                                borderRadius: '8px',
                                border: currentLevelIndex === idx ? '1px solid rgba(102, 126, 234, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                                <div>
                                    <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.05rem', color: 'var(--primary-color)' }}>
                                        {lvl.name}
                                    </h3>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        {idx + 1}/{PARSED_LEVELS.length}
                                    </div>
                                </div>
                                <button
                                    className="btn btn-secondary"
                                    style={{ whiteSpace: 'nowrap' }}
                                    onClick={() => {
                                        loadLevel(idx);
                                        window.scrollTo({ top: 0, behavior: 'smooth' });
                                    }}
                                >
                                    Play
                                </button>
                            </div>

                            <pre style={{
                                marginTop: '0.75rem',
                                padding: '0.75rem',
                                background: 'rgba(0,0,0,0.25)',
                                borderRadius: '8px',
                                border: '1px solid rgba(255,255,255,0.08)',
                                overflow: 'auto',
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace',
                                fontSize: '0.8rem',
                                lineHeight: '1.15',
                                color: 'var(--text-secondary)',
                                whiteSpace: 'pre'
                            }}>
                                {lvl.grid.join('\n')}
                            </pre>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

