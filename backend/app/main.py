from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Any
import clingo
import os
import time
from clorm import Predicate, ConstantField, IntegerField, control_add_facts, unify
from starlette.concurrency import run_in_threadpool
import heapq
from collections import deque
from typing import Dict, Set, Tuple

app = FastAPI()

# Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class Point(BaseModel):
    x: int
    y: int

class GameState(BaseModel):
    grid: List[Any] # Can be List[str] or List[List[str]]
    player: Point
    boxes: List[Point]
    goals: List[Point]

class CheckSolvableRequest(GameState):
    # If True, run a deeper search (used for initial level analysis)
    deep: bool = False
    # Optional override from the frontend
    maxSteps: Optional[int] = None
    # Optional timeout override (seconds) - best effort, not strict
    timeoutSec: Optional[float] = None
    # If True, keep increasing maxSteps internally until a solution is found
    # (single HTTP call; stops early if client disconnects).
    auto: bool = False
    # If True, ask clingo to optimize (respect #minimize). Can be much slower.
    optimal: bool = False

class ValidationRequest(BaseModel):
    boxes: List[Point]
    goals: List[Point]

# ASP Predicates
class Cell(Predicate):
    x = IntegerField
    y = IntegerField
    type = ConstantField
    class Meta:
        name = "cell"

class InitialPlayer(Predicate):
    x = IntegerField
    y = IntegerField
    class Meta:
        name = "initial_player"

class InitialBox(Predicate):
    x = IntegerField
    y = IntegerField
    class Meta:
        name = "initial_box"

class Move(Predicate):
    direction = ConstantField
    step = IntegerField
    class Meta:
        name = "move"

class Push(Predicate):
    x = IntegerField
    y = IntegerField
    dx = IntegerField
    dy = IntegerField
    step = IntegerField
    class Meta:
        name = "push"

class Slide(Predicate):
    x = IntegerField
    y = IntegerField
    dx = IntegerField
    dy = IntegerField
    nx = IntegerField
    ny = IntegerField
    step = IntegerField
    class Meta:
        name = "slide"

# Logic
ASP_SOLVER_PATH = os.path.join(os.path.dirname(__file__), "../asp/sokoban_solver_optimized.lp")
ASP_PUSH_SOLVER_PATH = os.path.join(os.path.dirname(__file__), "../asp/sokoban_solver_push.lp")
ASP_PUSH_FAST_SOLVER_PATH = os.path.join(os.path.dirname(__file__), "../asp/sokoban_solver_push_fast.lp")
ASP_SIMPLE_SOLVER_PATH = os.path.join(os.path.dirname(__file__), "../asp/sokoban_solver_simple.lp")
ASP_SIMPLE_OPT_SOLVER_PATH = os.path.join(os.path.dirname(__file__), "../asp/sokoban_solver_simple_opt.lp")
ASP_SLIDE_SOLVER_PATH = os.path.join(os.path.dirname(__file__), "../asp/sokoban_solver_slide.lp")

def game_state_to_facts(state: GameState) -> List[Predicate]:
    facts = []
    
    # Grid cells
    for y, row in enumerate(state.grid):
        for x, cell in enumerate(row):
            cell_type = None
            if cell in ['#', 'x']: cell_type = 'wall'
            elif cell in [' ', '@', '$']: cell_type = 'floor'
            elif cell in ['.', '*', '+']: cell_type = 'goal'
            
            if cell_type:
                facts.append(Cell(x=x, y=y, type=cell_type))
    
    # Player
    facts.append(InitialPlayer(x=state.player.x, y=state.player.y))
    
    # Boxes
    for box in state.boxes:
        facts.append(InitialBox(x=box.x, y=box.y))
        
    return facts

from functools import lru_cache
from collections import deque


@lru_cache(maxsize=256)
def _compute_static_dead_squares(grid_rows: tuple[str, ...]) -> frozenset[tuple[int, int]]:
    """Safe dead squares (no false positives)."""
    height = len(grid_rows)
    width = max((len(r) for r in grid_rows), default=0)

    def cell(x: int, y: int) -> str:
        if y < 0 or y >= height:
            return "#"
        row = grid_rows[y]
        if x < 0 or x >= len(row):
            return "#"
        return row[x]

    def is_wall(x: int, y: int) -> bool:
        return cell(x, y) in ("#", "x")

    def is_walkable(x: int, y: int) -> bool:
        if is_wall(x, y):
            return False
        return True

    goals: list[tuple[int, int]] = []
    for y in range(height):
        for x in range(len(grid_rows[y])):
            if cell(x, y) in (".", "*", "+"):
                goals.append((x, y))

    safe: set[tuple[int, int]] = set(goals)
    q = deque(goals)
    dirs = [(0, -1), (0, 1), (-1, 0), (1, 0)]

    # Reverse push reachability (ignore other boxes).
    while q:
        x, y = q.popleft()
        for dx, dy in dirs:
            px, py = x - dx, y - dy
            if (px, py) in safe:
                continue
            if not is_walkable(px, py):
                continue
            if not is_walkable(px - dx, py - dy):
                continue
            safe.add((px, py))
            q.append((px, py))

    dead: set[tuple[int, int]] = set()
    for y in range(height):
        for x in range(len(grid_rows[y])):
            if is_wall(x, y):
                continue
            if cell(x, y) in (".", "*", "+"):
                continue
            if (x, y) not in safe:
                dead.add((x, y))

    return frozenset(dead)


def check_deadlocks(state: GameState) -> bool:
    """Return True if the state is a sure deadlock."""
    height = len(state.grid)

    def is_wall(x: int, y: int) -> bool:
        if y < 0 or y >= height:
            return True
        row = state.grid[y]
        row_width = len(row)
        if x < 0 or x >= row_width:
            return True
        return row[x] in ["#", "x"]

    goals_set = {(g.x, g.y) for g in state.goals}

    # Corner deadlocks
    for box in state.boxes:
        if (box.x, box.y) in goals_set:
            continue
        x, y = box.x, box.y
        blocked_up = is_wall(x, y - 1)
        blocked_down = is_wall(x, y + 1)
        blocked_left = is_wall(x - 1, y)
        blocked_right = is_wall(x + 1, y)
        if (blocked_up or blocked_down) and (blocked_left or blocked_right):
            return True

    # Safe dead squares
    grid_rows: tuple[str, ...] = tuple("".join(row) if isinstance(row, list) else str(row) for row in state.grid)
    dead_squares = _compute_static_dead_squares(grid_rows)
    for box in state.boxes:
        if (box.x, box.y) in goals_set:
            continue
        if (box.x, box.y) in dead_squares:
            return True

    return False

import threading

def run_clingo(
    facts: List[Predicate],
    max_steps: int,
    timeout: float = 30.0,
    solver_path: Optional[str] = None,
    opt_mode_ignore: bool = True,
) -> Optional[tuple]:
    # --warn=none: avoid noisy "no atoms over signature" infos from #show directives
    args = ["--warn=none"]
    # Only need one model unless optimizing.
    if opt_mode_ignore:
        args.append("--models=1")
    if opt_mode_ignore:
        args.append("--opt-mode=ignore")
    args += ["-c", f"max_steps={max_steps}"]
    ctl = clingo.Control(args)
    
    try:
        ctl.load(solver_path or ASP_SOLVER_PATH)
    except Exception as e:
        print(f"Error loading ASP file: {e}")
        return None

    # Add facts using Clorm
    control_add_facts(ctl, facts)
    ctl.ground([("base", [])])
    
    result_data = None

    def on_model(model):
        nonlocal result_data
        symbols = model.symbols(shown=True)
        moves = unify([Move], symbols)
        pushes = unify([Push], symbols)
        slides = unify([Slide], symbols)
        
        extracted_moves = [f for f in moves if isinstance(f, Move)]
        extracted_moves.sort(key=lambda m: m.step)
        
        extracted_pushes = [f for f in pushes if isinstance(f, Push)]
        extracted_pushes.sort(key=lambda m: m.step)

        extracted_slides = [f for f in slides if isinstance(f, Slide)]
        extracted_slides.sort(key=lambda m: m.step)
        
        result_data = (
            [{"direction": str(m.direction), "step": m.step} for m in extracted_moves],
            [{"x": p.x, "y": p.y, "dx": p.dx, "dy": p.dy, "step": p.step} for p in extracted_pushes],
            [{"x": s.x, "y": s.y, "dx": s.dx, "dy": s.dy, "nx": s.nx, "ny": s.ny, "step": s.step} for s in extracted_slides]
        )
        
    solve_kwargs = {"on_model": on_model}
    
    # Timeout handling
    timer = threading.Timer(timeout, ctl.interrupt)
    timer.start()
    
    try:
        result = ctl.solve(**solve_kwargs, yield_=False)
    except Exception as e:
        print(f"Clingo Error or Interruption: {e}")
        return None
    finally:
        timer.cancel()
    
    if result.satisfiable:
        return result_data
    else:
        return None


def _reconstruct_moves_from_pushes(state: GameState, pushes_list: List[dict]) -> Optional[List[str]]:
    """
    Convert a list of push actions (x,y,dx,dy,step) into a full move path (walk + pushes).
    This is needed for push-based ASP solving where only push/5 is produced.
    """
    from collections import deque

    # Ragged-grid safe wall test
    height = len(state.grid)

    def is_wall(x: int, y: int) -> bool:
        if y < 0 or y >= height:
            return True
        row = state.grid[y]
        row_width = len(row)
        if x < 0 or x >= row_width:
            return True
        return row[x] in ['#', 'x']

    dir_from_delta = {
        (0, -1): "up",
        (0, 1): "down",
        (-1, 0): "left",
        (1, 0): "right",
    }
    dirs = [
        ("up", 0, -1),
        ("down", 0, 1),
        ("left", -1, 0),
        ("right", 1, 0),
    ]

    boxes = {(b.x, b.y) for b in state.boxes}
    player = (state.player.x, state.player.y)

    def bfs(start: tuple[int, int], goal: tuple[int, int], boxes_set: set[tuple[int, int]]) -> Optional[List[str]]:
        if start == goal:
            return []
        q = deque([start])
        prev: dict[tuple[int, int], Optional[tuple[int, int]]] = {start: None}
        prev_dir: dict[tuple[int, int], Optional[str]] = {start: None}
        while q:
            x, y = q.popleft()
            for name, dx, dy in dirs:
                nx, ny = x + dx, y + dy
                if is_wall(nx, ny):
                    continue
                if (nx, ny) in boxes_set:
                    continue
                if (nx, ny) in prev:
                    continue
                prev[(nx, ny)] = (x, y)
                prev_dir[(nx, ny)] = name
                if (nx, ny) == goal:
                    q.clear()
                    break
                q.append((nx, ny))
        if goal not in prev:
            return None
        path: List[str] = []
        cur = goal
        while prev[cur] is not None:
            step_dir = prev_dir[cur]
            if step_dir is None:
                return None
            path.append(step_dir)
            cur = prev[cur]  # type: ignore[assignment]
        path.reverse()
        return path

    full_moves: List[str] = []

    for p in pushes_list:
        px, py = int(p["x"]), int(p["y"])
        dx, dy = int(p["dx"]), int(p["dy"])
        if (dx, dy) not in dir_from_delta:
            return None
        push_dir = dir_from_delta[(dx, dy)]

        # Walk to push position
        walk_path = bfs(player, (px, py), boxes)
        if walk_path is None:
            return None
        full_moves.extend(walk_path)

        # Update player after walking
        for step_dir in walk_path:
            sdx, sdy = {
                "up": (0, -1),
                "down": (0, 1),
                "left": (-1, 0),
                "right": (1, 0),
            }[step_dir]
            player = (player[0] + sdx, player[1] + sdy)

        # Apply push
        box_pos = (px + dx, py + dy)
        dest = (px + 2 * dx, py + 2 * dy)
        if box_pos not in boxes:
            return None
        # Destination must be free (and not a wall)
        if is_wall(dest[0], dest[1]) or dest in boxes:
            return None
        boxes.remove(box_pos)
        boxes.add(dest)
        # Player steps into old box cell
        player = box_pos
        full_moves.append(push_dir)

    return full_moves


def _first_move_towards_push(
    state: GameState,
    push_position: tuple[int, int],
    push_delta: tuple[int, int],
) -> Optional[str]:
    """
    Fast helper for /api/get-hint when we solved in push-space:
    - If the player is already at the required pre-push position, the next move is the push direction.
    - Otherwise, return the first step of a BFS path to that pre-push position (boxes treated as blocked).
    """
    from collections import deque

    # Ragged-grid safe wall test
    height = len(state.grid)

    def is_wall(x: int, y: int) -> bool:
        if y < 0 or y >= height:
            return True
        row = state.grid[y]
        row_width = len(row)
        if x < 0 or x >= row_width:
            return True
        return row[x] in ["#", "x"]

    dir_from_delta = {
        (0, -1): "up",
        (0, 1): "down",
        (-1, 0): "left",
        (1, 0): "right",
    }
    dirs = [
        ("up", 0, -1),
        ("down", 0, 1),
        ("left", -1, 0),
        ("right", 1, 0),
    ]

    player = (state.player.x, state.player.y)
    boxes = {(b.x, b.y) for b in state.boxes}

    if player == push_position:
        return dir_from_delta.get(push_delta)

    goal = push_position
    q = deque([player])
    prev: dict[tuple[int, int], Optional[tuple[int, int]]] = {player: None}
    prev_dir: dict[tuple[int, int], Optional[str]] = {player: None}

    while q:
        x, y = q.popleft()
        for name, dx, dy in dirs:
            nx, ny = x + dx, y + dy
            if is_wall(nx, ny):
                continue
            if (nx, ny) in boxes:
                continue
            np = (nx, ny)
            if np in prev:
                continue
            prev[np] = (x, y)
            prev_dir[np] = name
            if np == goal:
                q.clear()
                break
            q.append(np)

    if goal not in prev:
        return None

    # Reconstruct just the first step by walking predecessors backward
    cur = goal
    first: Optional[str] = None
    while prev[cur] is not None:
        first = prev_dir[cur]
        cur = prev[cur]  # type: ignore[assignment]
    return first


def _reconstruct_moves_from_slides(state: GameState, slides_list: List[dict]) -> Optional[List[str]]:
    """
    Convert slide/7 macro actions (box at x,y pushed along dx,dy to nx,ny at step)
    into a full move path (walk + unit pushes).
    """
    from collections import deque

    height = len(state.grid)

    def is_wall(x: int, y: int) -> bool:
        if y < 0 or y >= height:
            return True
        row = state.grid[y]
        if x < 0 or x >= len(row):
            return True
        return row[x] in ['#', 'x']

    dirs = [
        ("up", 0, -1),
        ("down", 0, 1),
        ("left", -1, 0),
        ("right", 1, 0),
    ]
    dir_from_delta = {
        (0, -1): "up",
        (0, 1): "down",
        (-1, 0): "left",
        (1, 0): "right",
    }

    boxes = {(b.x, b.y) for b in state.boxes}
    player = (state.player.x, state.player.y)

    def bfs(start: tuple[int, int], goal: tuple[int, int], boxes_set: set[tuple[int, int]]) -> Optional[List[str]]:
        if start == goal:
            return []
        q = deque([start])
        prev: dict[tuple[int, int], Optional[tuple[int, int]]] = {start: None}
        prev_dir: dict[tuple[int, int], Optional[str]] = {start: None}
        while q:
            x, y = q.popleft()
            for name, dx, dy in dirs:
                nx, ny = x + dx, y + dy
                if is_wall(nx, ny):
                    continue
                if (nx, ny) in boxes_set:
                    continue
                if (nx, ny) in prev:
                    continue
                prev[(nx, ny)] = (x, y)
                prev_dir[(nx, ny)] = name
                if (nx, ny) == goal:
                    q.clear()
                    break
                q.append((nx, ny))
        if goal not in prev:
            return None
        path: List[str] = []
        cur = goal
        while prev[cur] is not None:
            step_dir = prev_dir[cur]
            if step_dir is None:
                return None
            path.append(step_dir)
            cur = prev[cur]  # type: ignore[assignment]
        path.reverse()
        return path

    full_moves: List[str] = []

    for s in slides_list:
        bx, by = int(s["x"]), int(s["y"])
        dx, dy = int(s["dx"]), int(s["dy"])
        nx, ny = int(s["nx"]), int(s["ny"])

        if (dx, dy) not in dir_from_delta:
            return None
        push_dir = dir_from_delta[(dx, dy)]

        # Determine slide length (number of unit pushes)
        if dx != 0:
            length = (nx - bx) if dx > 0 else (bx - nx)
        else:
            length = (ny - by) if dy > 0 else (by - ny)

        if length <= 0:
            return None

        # Walk to the first push position (behind the box)
        first_push_pos = (bx - dx, by - dy)
        walk_path = bfs(player, first_push_pos, boxes)
        if walk_path is None:
            return None
        full_moves.extend(walk_path)

        # Update player after walking
        for step_dir in walk_path:
            sdx, sdy = {
                "up": (0, -1),
                "down": (0, 1),
                "left": (-1, 0),
                "right": (1, 0),
            }[step_dir]
            player = (player[0] + sdx, player[1] + sdy)

        # Apply the unit pushes composing the slide
        cur_box = (bx, by)
        for _ in range(length):
            if cur_box not in boxes:
                return None
            dest = (cur_box[0] + dx, cur_box[1] + dy)
            if is_wall(dest[0], dest[1]) or dest in boxes:
                return None
            boxes.remove(cur_box)
            boxes.add(dest)
            # player steps into old box cell
            player = cur_box
            cur_box = dest
            full_moves.append(push_dir)

    return full_moves


def _trim_solution_to_first_finish(state: GameState, moves: List[str]) -> List[str]:
    """
    Given a (potentially padded) move list, trim it to the first step where
    all boxes are on goals.

    This is especially important when using clingo with --opt-mode=ignore, where
    the model might only reach the goals near max_steps.
    """
    height = len(state.grid)

    def is_wall(x: int, y: int) -> bool:
        if y < 0 or y >= height:
            return True
        row = state.grid[y]
        if x < 0 or x >= len(row):
            return True
        return row[x] in ['#', 'x']

    delta = {
        "up": (0, -1),
        "down": (0, 1),
        "left": (-1, 0),
        "right": (1, 0),
    }

    goals = {(g.x, g.y) for g in state.goals}
    boxes = {(b.x, b.y) for b in state.boxes}
    player = (state.player.x, state.player.y)

    def solved() -> bool:
        return len(boxes) > 0 and all((bx, by) in goals for (bx, by) in boxes)

    if solved():
        return []

    for i, dname in enumerate(moves):
        if dname not in delta:
            # Unknown direction: keep original
            return moves
        dx, dy = delta[dname]
        nx, ny = player[0] + dx, player[1] + dy
        if is_wall(nx, ny):
            return moves
        if (nx, ny) in boxes:
            bx2, by2 = nx + dx, ny + dy
            if is_wall(bx2, by2) or (bx2, by2) in boxes:
                return moves
            boxes.remove((nx, ny))
            boxes.add((bx2, by2))
            player = (nx, ny)
        else:
            player = (nx, ny)

        if solved():
            return moves[: i + 1]

    return moves


def _solve_push_astar(
    state: GameState,
    time_limit_sec: float = 5.0,
    max_expansions: int = 300_000,
) -> Optional[List[dict]]:
    """Fallback: A* in push-space to quickly find a push plan."""
    start_time = time.time()

    height = len(state.grid)

    def is_wall(x: int, y: int) -> bool:
        if y < 0 or y >= height:
            return True
        row = state.grid[y]
        if x < 0 or x >= len(row):
            return True
        return row[x] in ['#', 'x']

    # Build walkable + goals
    walkable: Set[Tuple[int, int]] = set()
    goals: Set[Tuple[int, int]] = set((g.x, g.y) for g in state.goals)
    floor: Set[Tuple[int, int]] = set()

    for y, row in enumerate(state.grid):
        for x, _ in enumerate(row):
            if is_wall(x, y):
                continue
            walkable.add((x, y))
            if (x, y) in goals:
                continue
            floor.add((x, y))

    DIRS = [(0, -1), (0, 1), (-1, 0), (1, 0)]

    # Safe squares / dead squares (reverse push reachability from goals, empty map)
    safe: Set[Tuple[int, int]] = set(goals)
    changed = True
    while changed:
        changed = False
        for (x, y) in list(safe):
            for dx, dy in DIRS:
                px, py = x - dx, y - dy
                if (px, py) not in walkable:
                    continue
                behind = (px - dx, py - dy)
                if behind not in walkable:
                    continue
                if (px, py) not in safe:
                    safe.add((px, py))
                    changed = True

    dead: Set[Tuple[int, int]] = set(p for p in floor if p not in safe)

    # Push-distance (empty-map) from any cell to each goal (reverse push graph).
    # Used for a tighter multi-box heuristic via assignment (bitmask DP).
    goal_list = sorted(goals)
    dist_to_goal: List[Dict[Tuple[int, int], int]] = []
    for g in goal_list:
        gx, gy = g
        dist: Dict[Tuple[int, int], int] = {(gx, gy): 0}
        q = deque([(gx, gy)])
        while q:
            x, y = q.popleft()
            d = dist[(x, y)]
            if d >= 200:
                continue
            for dx, dy in DIRS:
                px, py = x - dx, y - dy
                if (px, py) not in walkable:
                    continue
                behind = (px - dx, py - dy)
                if behind not in walkable:
                    continue
                if (px, py) not in dist:
                    dist[(px, py)] = d + 1
                    q.append((px, py))
        dist_to_goal.append(dist)

    def solved(boxes: Tuple[Tuple[int, int], ...]) -> bool:
        return all(b in goals for b in boxes)

    def heuristic(boxes: Tuple[Tuple[int, int], ...]) -> int:
        if not boxes:
            return 0
        m = len(boxes)
        n = len(goal_list)
        if n == 0:
            return 999 * m
        if m > n:
            return 999 * m

        # If too many goals, fall back to nearest-goal sum to keep the DP cheap.
        if n > 15:
            total = 0
            for b in boxes:
                best = 999
                for dist in dist_to_goal:
                    best = min(best, dist.get(b, 999))
                total += best
            return total

        INF = 10**9
        dp = [INF] * (1 << n)
        dp[0] = 0
        for b in boxes:
            ndp = [INF] * (1 << n)
            for mask in range(1 << n):
                base = dp[mask]
                if base >= INF:
                    continue
                for j in range(n):
                    if mask & (1 << j):
                        continue
                    cost = dist_to_goal[j].get(b, 999)
                    nm = mask | (1 << j)
                    ndp[nm] = min(ndp[nm], base + cost)
            dp = ndp
        return min(dp)

    def reachable_cells(start: Tuple[int, int], boxes_set: Set[Tuple[int, int]]) -> Set[Tuple[int, int]]:
        dq = deque([start])
        seen = {start}
        while dq:
            x, y = dq.popleft()
            for dx, dy in DIRS:
                nx, ny = x + dx, y + dy
                if (nx, ny) in seen:
                    continue
                if (nx, ny) in boxes_set:
                    continue
                if is_wall(nx, ny):
                    continue
                seen.add((nx, ny))
                dq.append((nx, ny))
        return seen

    # Optional symmetry reduction (detect dihedral symmetries of the static map + goals).
    # This can drastically reduce search on highly symmetric levels (e.g. some official maps).
    width = max((len(r) for r in state.grid), default=0)
    wall_cells: Set[Tuple[int, int]] = set()
    for y in range(height):
        for x in range(width):
            if is_wall(x, y):
                wall_cells.add((x, y))

    goal_cells: Set[Tuple[int, int]] = set(goals)

    def _t_id(p: Tuple[int, int]) -> Tuple[int, int]:
        return p

    def _t_fx(p: Tuple[int, int]) -> Tuple[int, int]:
        x, y = p
        return (width - 1 - x, y)

    def _t_fy(p: Tuple[int, int]) -> Tuple[int, int]:
        x, y = p
        return (x, height - 1 - y)

    def _t_rot180(p: Tuple[int, int]) -> Tuple[int, int]:
        x, y = p
        return (width - 1 - x, height - 1 - y)

    transforms = [_t_id, _t_fx, _t_fy, _t_rot180]

    if width == height and width > 0:
        n = width

        def _t_rot90(p: Tuple[int, int]) -> Tuple[int, int]:
            x, y = p
            return (n - 1 - y, x)

        def _t_rot270(p: Tuple[int, int]) -> Tuple[int, int]:
            x, y = p
            return (y, n - 1 - x)

        def _t_diag(p: Tuple[int, int]) -> Tuple[int, int]:
            x, y = p
            return (y, x)

        def _t_anti(p: Tuple[int, int]) -> Tuple[int, int]:
            x, y = p
            return (n - 1 - y, n - 1 - x)

        transforms += [_t_rot90, _t_rot270, _t_diag, _t_anti]

    sym_fns = []
    for tf in transforms:
        if {tf(p) for p in wall_cells} == wall_cells and {tf(p) for p in goal_cells} == goal_cells:
            sym_fns.append(tf)

    def canon_key(player: Tuple[int, int], boxes: Tuple[Tuple[int, int], ...]) -> Tuple[Tuple[int, int], Tuple[Tuple[int, int], ...]]:
        if len(sym_fns) <= 1:
            return (player, boxes)
        best: Optional[Tuple[Tuple[int, int], Tuple[Tuple[int, int], ...]]] = None
        for tf in sym_fns:
            p2 = tf(player)
            b2 = tuple(sorted(tf(b) for b in boxes))
            k = (p2, b2)
            if best is None or k < best:
                best = k
        # best is never None because identity always matches
        return best  # type: ignore[return-value]

    start_player = (state.player.x, state.player.y)
    start_boxes = tuple(sorted((b.x, b.y) for b in state.boxes))
    start_key = canon_key(start_player, start_boxes)

    if solved(start_boxes):
        return []

    # Representatives for each canonical class
    rep: Dict[Tuple[Tuple[int, int], Tuple[Tuple[int, int], ...]], Tuple[Tuple[int, int], Tuple[Tuple[int, int], ...]]] = {
        start_key: (start_player, start_boxes)
    }

    pq: List[Tuple[int, int, Tuple[Tuple[int, int], Tuple[Tuple[int, int], ...]]]] = []
    heapq.heappush(pq, (heuristic(start_boxes), 0, start_key))

    came: Dict[
        Tuple[Tuple[int, int], Tuple[Tuple[int, int], ...]],
        Tuple[Tuple[Tuple[int, int], Tuple[Tuple[int, int], ...]], Tuple[int, int, int, int]],
    ] = {}
    g_best: Dict[Tuple[Tuple[int, int], Tuple[Tuple[int, int], ...]], int] = {start_key: 0}

    expansions = 0

    while pq and (time.time() - start_time) < time_limit_sec and expansions < max_expansions:
        f, g, ckey = heapq.heappop(pq)
        player, boxes = rep[ckey]
        key = ckey
        if g != g_best.get(key, 10**9):
            continue

        if solved(boxes):
            # reconstruct do_push actions
            actions: List[Tuple[int, int, int, int]] = []
            cur = key
            while cur in came:
                prev, act = came[cur]
                actions.append(act)
                cur = prev
            actions.reverse()
            return [
                {"bx": bx, "by": by, "dx": dx, "dy": dy, "step": i + 1}
                for i, (bx, by, dx, dy) in enumerate(actions)
            ]

        expansions += 1

        boxes_set = set(boxes)
        reach = reachable_cells(player, boxes_set)

        for (bx, by) in boxes:
            for dx, dy in DIRS:
                px, py = bx - dx, by - dy
                nx, ny = bx + dx, by + dy

                if (px, py) not in reach:
                    continue
                if is_wall(nx, ny):
                    continue
                if (nx, ny) in boxes_set:
                    continue
                if (nx, ny) in dead:
                    continue

                new_boxes_set = set(boxes_set)
                new_boxes_set.remove((bx, by))
                new_boxes_set.add((nx, ny))
                new_boxes = tuple(sorted(new_boxes_set))
                new_player = (bx, by)

                new_key = canon_key(new_player, new_boxes)
                ng = g + 1
                if ng < g_best.get(new_key, 10**9):
                    g_best[new_key] = ng
                    rep[new_key] = (new_player, new_boxes)
                    came[new_key] = (key, (bx, by, dx, dy))
                    heapq.heappush(pq, (ng + heuristic(new_boxes), ng, new_key))

    return None


def _run_clingo_with_fixed_do_push(
    facts: List[Predicate],
    do_push_actions: List[dict],
    solver_path: str,
    timeout: float = 5.0,
) -> Optional[tuple]:
    """
    Materialize a fixed do_push plan through clingo (ASP) to obtain push/5 atoms.
    This keeps ASP as the source of truth for the emitted push facts.
    """
    if not do_push_actions:
        return None

    max_steps = int(do_push_actions[-1]["step"])
    args = ["--warn=none", "--models=1", "--opt-mode=ignore", "-c", f"max_steps={max_steps}"]
    ctl = clingo.Control(args)
    ctl.load(solver_path)
    control_add_facts(ctl, facts)

    # Inject fixed pushes and forbid any other do_push
    lines: List[str] = []
    for a in do_push_actions:
        bx, by = int(a["bx"]), int(a["by"])
        dx, dy = int(a["dx"]), int(a["dy"])
        t = int(a["step"])
        lines.append(f"fixed_push({bx},{by},{dx},{dy},{t}).")
        lines.append(f"do_push({bx},{by},{dx},{dy},{t}).")
    lines.append(":- do_push(BX,BY,DX,DY,T), not fixed_push(BX,BY,DX,DY,T).")
    ctl.add("base", [], "\n".join(lines) + "\n")

    ctl.ground([("base", [])])

    result_data = None

    def on_model(model):
        nonlocal result_data
        symbols = model.symbols(shown=True)
        moves = unify([Move], symbols)
        pushes = unify([Push], symbols)
        extracted_moves = [f for f in moves if isinstance(f, Move)]
        extracted_moves.sort(key=lambda m: m.step)
        extracted_pushes = [f for f in pushes if isinstance(f, Push)]
        extracted_pushes.sort(key=lambda m: m.step)
        result_data = (
            [{"direction": str(m.direction), "step": m.step} for m in extracted_moves],
            [{"x": p.x, "y": p.y, "dx": p.dx, "dy": p.dy, "step": p.step} for p in extracted_pushes],
        )

    timer = threading.Timer(timeout, ctl.interrupt)
    timer.start()
    try:
        res = ctl.solve(on_model=on_model, yield_=False)
    finally:
        timer.cancel()

    if res.satisfiable:
        return result_data
    return None

@app.get("/api/health")
def health():
    return {"status": "ok", "message": "Backend is running (Python + Clorm)"}

@app.post("/api/check-solvable")
async def check_solvable(req: CheckSolvableRequest, request: Request):
    state = req
    # 1. Fast Static Checks (Deadlocks)
    if check_deadlocks(state):
        return {
            "solvable": False,
            "message": "Deadlock detected (Box in corner)!",
            "hint": None,
            "hintMessage": None,
            "solution": None,
            "totalMoves": None,
            "solver": {
                "maxStepsUsed": int(req.maxSteps) if req.maxSteps is not None else (35 if req.deep else 25),
                "elapsedMs": 0
            }
        }

    # 2. Planning Check
    # - Default: short horizon for real-time feedback
    # - deep=True (initial level): slightly longer horizon to avoid false negatives
    # NOTE: A bounded horizon can prove "solvable" when a plan is found,
    #       but cannot prove "unsolvable" when no plan is found.
    facts = game_state_to_facts(state)
    # NOTE: this endpoint is used by the frontend for "is it solvable?" checks.
    # Move-based horizons (25/35 moves) can be much heavier than a push-based search.
    # If the caller enables auto-search (req.auto), we interpret maxSteps as PUSH horizon.
    default_max_steps = (15 if req.deep else 10) if req.auto else (35 if req.deep else 25)
    start_steps = int(req.maxSteps) if req.maxSteps is not None else default_max_steps
    start_steps = max(1, start_steps)

    def _timeout_for_steps(steps: int) -> float:
        base = float(req.timeoutSec) if req.timeoutSec is not None else (
            5.0 if steps <= 25 else (10.0 if steps <= 60 else 15.0)
        )
        return max(1.0, min(base, 30.0))

    # Solver selection (simple + fast, push-based)
    # We use the simple push-based encoding by default for the frontend.
    # This keeps behavior consistent between check-solvable / hint / solution.
    solver_path = ASP_SIMPLE_OPT_SOLVER_PATH if req.optimal else ASP_SIMPLE_SOLVER_PATH
    # Optimization mode:
    # - move-based solver: optimization can be very slow; default to ignore unless explicitly requested
    # Speed > optimality for UI: ignore optimization unless explicitly requested.
    opt_mode_ignore = (not req.optimal)

    # Auto mode: keep searching with increasing horizons inside ONE HTTP call.
    if req.auto:
        steps = start_steps
        per_timeout = _timeout_for_steps(steps)
        overall_start = time.time()
        tried_astar_fallback = False

        while True:
            # Stop if client disconnected (e.g., user moved and AbortController cancelled)
            if await request.is_disconnected():
                return {
                    "solvable": None,
                    "message": "Search cancelled (client disconnected).",
                    "hint": None,
                    "hintMessage": None,
                    "solution": None,
                    "totalMoves": None,
                    "solver": {
                        "maxStepsUsed": steps,
                        "elapsedMs": int((time.time() - overall_start) * 1000)
                    }
                }

            # Run clingo in a threadpool so this async endpoint doesn't block the event loop
            result = await run_in_threadpool(run_clingo, facts, steps, per_timeout, solver_path, opt_mode_ignore)

            if result:
                moves_list, pushes_list, slides_list = result

                solution_moves: Optional[List[str]] = None
                if moves_list:
                    solution_moves = [m["direction"] for m in moves_list]
                elif pushes_list:
                    solution_moves = _reconstruct_moves_from_pushes(state, pushes_list)
                elif slides_list:
                    solution_moves = _reconstruct_moves_from_slides(state, slides_list)
                if solution_moves:
                    solution_moves = _trim_solution_to_first_finish(state, solution_moves)

                # Extract hint (first move)
                hint = None
                hint_message = None

                if pushes_list:
                    first_push = pushes_list[0]
                    target_box_x = first_push["x"] + first_push["dx"]
                    target_box_y = first_push["y"] + first_push["dy"]

                    box_idx = -1
                    for i, box in enumerate(state.boxes):
                        if box.x == target_box_x and box.y == target_box_y:
                            box_idx = i
                            break

                    if box_idx != -1:
                        dx, dy = first_push["dx"], first_push["dy"]
                        direction = "somewhere"
                        if dx == 0 and dy == -1: direction = "up"
                        if dx == 0 and dy == 1: direction = "down"
                        if dx == -1 and dy == 0: direction = "left"
                        if dx == 1 and dy == 0: direction = "right"
                        hint_message = f"Try pushing Box {box_idx + 1} {direction}!"

                if not hint_message and solution_moves:
                    hint = solution_moves[0]
                    hint_message = f"Try moving {solution_moves[0]}!"

                return {
                    "solvable": True,
                    "message": "Puzzle is solvable (found path)!",
                    "hint": hint,
                    "hintMessage": hint_message,
                    "solution": solution_moves,
                    "totalMoves": len(solution_moves) if solution_moves else None,
                    "solver": {
                        "maxStepsUsed": steps,
                        "elapsedMs": int((time.time() - overall_start) * 1000)
                    }
                }

            # Fallback: if clingo can't find any model for a while, try a fast push-space A*,
            # then materialize it via ASP (fixed do_push) to keep using clingo for facts.
            # Still use the push-space A* fallback (works well with push-based encoding).
            if (not tried_astar_fallback) and (time.time() - overall_start) > 12.0:
                tried_astar_fallback = True
                do_push_plan = await run_in_threadpool(_solve_push_astar, state, 6.0, 400_000)
                if do_push_plan and (not await request.is_disconnected()):
                    fixed = await run_in_threadpool(
                        _run_clingo_with_fixed_do_push,
                        facts,
                        do_push_plan,
                        solver_path,
                        min(5.0, per_timeout),
                    )
                    if fixed:
                        moves_list, pushes_list = fixed

                        solution_moves: Optional[List[str]] = None
                        if moves_list:
                            solution_moves = [m["direction"] for m in moves_list]
                        elif pushes_list:
                            solution_moves = _reconstruct_moves_from_pushes(state, pushes_list)
                        if solution_moves:
                            solution_moves = _trim_solution_to_first_finish(state, solution_moves)

                        hint = None
                        hint_message = None

                        if pushes_list:
                            first_push = pushes_list[0]
                            target_box_x = first_push["x"] + first_push["dx"]
                            target_box_y = first_push["y"] + first_push["dy"]

                            box_idx = -1
                            for i, box in enumerate(state.boxes):
                                if box.x == target_box_x and box.y == target_box_y:
                                    box_idx = i
                                    break

                            if box_idx != -1:
                                dx, dy = first_push["dx"], first_push["dy"]
                                direction = "somewhere"
                                if dx == 0 and dy == -1: direction = "up"
                                if dx == 0 and dy == 1: direction = "down"
                                if dx == -1 and dy == 0: direction = "left"
                                if dx == 1 and dy == 0: direction = "right"
                                hint_message = f"Try pushing Box {box_idx + 1} {direction}!"

                        if not hint_message and solution_moves:
                            hint = solution_moves[0]
                            hint_message = f"Try moving {solution_moves[0]}!"

                        return {
                            "solvable": True,
                            "message": "Puzzle is solvable (found path via fallback)!",
                            "hint": hint,
                            "hintMessage": hint_message,
                            "solution": solution_moves,
                            "totalMoves": len(solution_moves) if solution_moves else None,
                            "solver": {
                                "maxStepsUsed": int(do_push_plan[-1]["step"]),
                                "elapsedMs": int((time.time() - overall_start) * 1000)
                            }
                        }

            # Not found in this horizon -> increase horizon and keep searching
            if steps < 50:
                steps += 5
            elif steps < 100:
                steps += 10
            else:
                steps = int(steps * 1.25) + 1

            per_timeout = min(30.0, per_timeout + 2.0)

    # Fixed mode (single run)
    max_steps = start_steps
    timeout = _timeout_for_steps(max_steps)

    t0 = time.time()
    result = await run_in_threadpool(run_clingo, facts, max_steps, timeout, solver_path, opt_mode_ignore)
    elapsed_ms = int((time.time() - t0) * 1000)
    
    if result:
        moves_list, pushes_list, slides_list = result

        solution_moves: Optional[List[str]] = None
        if moves_list:
            solution_moves = [m["direction"] for m in moves_list]
        elif pushes_list:
            # Push-based solver: reconstruct full move path (walk + pushes)
            solution_moves = _reconstruct_moves_from_pushes(state, pushes_list)
        elif slides_list:
            # Slide-based solver: reconstruct full move path (walk + unit pushes)
            solution_moves = _reconstruct_moves_from_slides(state, slides_list)
        if solution_moves:
            solution_moves = _trim_solution_to_first_finish(state, solution_moves)
        
        # Extract hint (first move)
        hint = None
        hint_message = None
        
        if pushes_list:
            # Strategy: Find the first PUSH action and format hint message
            first_push = pushes_list[0]
            target_box_x = first_push["x"] + first_push["dx"]
            target_box_y = first_push["y"] + first_push["dy"]
            
            box_idx = -1
            for i, box in enumerate(state.boxes):
                if box.x == target_box_x and box.y == target_box_y:
                    box_idx = i
                    break
            
            if box_idx != -1:
                dx, dy = first_push["dx"], first_push["dy"]
                direction = "somewhere"
                if dx == 0 and dy == -1: direction = "up"
                if dx == 0 and dy == 1: direction = "down"
                if dx == -1 and dy == 0: direction = "left"
                if dx == 1 and dy == 0: direction = "right"
                
                hint_message = f"Try pushing Box {box_idx + 1} {direction}!"
        
        # Fallback: use first move from the computed solution path
        if not hint_message and solution_moves:
            hint = solution_moves[0]
            hint_message = f"Try moving {solution_moves[0]}!"
        
        return {
            "solvable": True,
            "message": "Puzzle is solvable (found short path)!",
            "hint": hint,
            "hintMessage": hint_message,
            "solution": solution_moves,
            "totalMoves": len(solution_moves) if solution_moves else None,
            "solver": {
                "maxStepsUsed": max_steps,
                "elapsedMs": elapsed_ms
            }
        }
    else:
        # No plan found in the bounded horizon, but no static deadlock found.
        # We cannot conclude it's unsolvable.
        return {
            "solvable": None,
            "message": f"Status unknown (no plan found within {max_steps} steps)",
            "hint": None,
            "hintMessage": None,
            "solution": None,
            "totalMoves": None,
            "solver": {
                "maxStepsUsed": max_steps,
                "elapsedMs": elapsed_ms
            }
        }

@app.post("/api/get-hint")
def get_hint(state: GameState):
    if check_deadlocks(state):
        return {
            "hint": None,
            "message": "Puzzle is unsolvable (Deadlock detected)."
        }

    facts = game_state_to_facts(state)
    # Use the push-based fast solver for interactive hints.
    # Horizon here is in PUSHES (much smaller than moves).
    horizons = [5, 10, 15, 20, 30, 40, 60, 80, 120]
    result = None

    for steps in horizons:
        print(f"Trying hint (push-fast) with max_steps={steps}...")
        current_res = run_clingo(
            facts,
            steps,
            timeout=3.0,  # keep per-attempt short; frontend has its own 5s timeout
            solver_path=ASP_SIMPLE_SOLVER_PATH,
            opt_mode_ignore=True,
        )
        if current_res:
            result = current_res
            break
            
    if not result:
        return {
            "hint": None,
            "message": "No solution available from this state."
        }
        
    moves_list, pushes_list, slides_list = result

    # Fast path: push-based solver -> compute the FIRST move needed to perform the FIRST push.
    if pushes_list:
        first_push = pushes_list[0]  # has x,y,dx,dy where (x,y) is player position before pushing
        push_px, push_py = first_push["x"], first_push["y"]
        push_dx, push_dy = first_push["dx"], first_push["dy"]
        first_move = _first_move_towards_push(state, (push_px, push_py), (push_dx, push_dy))
        if first_move:
            return {
                "hint": first_move,
                "message": f"Try moving {first_move}!",
                "totalMoves": None,
            }

    # Fallback: if moves were produced directly (e.g. other solver), return the first move.
    if moves_list:
        first_move = moves_list[0]
        return {"hint": first_move["direction"], "message": f"Try moving {first_move['direction']}!", "totalMoves": len(moves_list)}

    # Last resort: reconstruct full solution
    solution_moves = None
    if pushes_list:
        solution_moves = _reconstruct_moves_from_pushes(state, pushes_list)
    elif slides_list:
        solution_moves = _reconstruct_moves_from_slides(state, slides_list)
    if solution_moves:
        solution_moves = _trim_solution_to_first_finish(state, solution_moves)
        return {"hint": solution_moves[0], "message": f"Try moving {solution_moves[0]}!", "totalMoves": len(solution_moves)}

    return {"hint": None, "message": "No solution available from this state.", "totalMoves": None}

@app.post("/api/get-solution")
def get_solution(state: GameState):
    """
    Returns the complete solution as a sequence of moves.
    Used for displaying the full solution to the player.
    """
    if check_deadlocks(state):
        return {
            "moves": [],
            "totalMoves": 0,
            "message": "Puzzle is unsolvable (Deadlock detected)."
        }

    facts = game_state_to_facts(state)
    # Use push-fast solver first (much faster than move-by-move ASP).
    horizons = [10, 20, 30, 40, 60, 80, 120, 160]
    result = None

    for steps in horizons:
        print(f"Trying solution (push-fast) with max_steps={steps}...")
        current_res = run_clingo(
            facts,
            steps,
            timeout=10.0,
            solver_path=ASP_SIMPLE_SOLVER_PATH,
            opt_mode_ignore=True,
        )
        if current_res:
            result = current_res
            break
            
    if not result:
        return {
            "moves": [],
            "totalMoves": 0,
            "message": "No solution found for this puzzle."
        }
        
    moves_list, pushes_list, slides_list = result

    if moves_list:
        moves = [m["direction"] for m in moves_list]
        return {"moves": moves, "totalMoves": len(moves), "message": f"Solution found with {len(moves)} moves!"}

    solution_moves = None
    if pushes_list:
        solution_moves = _reconstruct_moves_from_pushes(state, pushes_list)
    elif slides_list:
        solution_moves = _reconstruct_moves_from_slides(state, slides_list)

    if not solution_moves:
        return {
            "moves": [],
            "totalMoves": 0,
            "message": "No solution found for this puzzle."
        }

    solution_moves = _trim_solution_to_first_finish(state, solution_moves)
    return {
        "moves": solution_moves,
        "totalMoves": len(solution_moves),
        "message": f"Solution found with {len(solution_moves)} moves!"
    }

@app.post("/api/validate-solution")
def validate_solution(req: ValidationRequest):
    # Sokoban is solved when ALL boxes are on goals (goals can be >= boxes).
    # Note: if there are no boxes, consider it solved=false (game has nothing to do).
    boxes_on_goals = [
        box for box in req.boxes
        if any(g.x == box.x and g.y == box.y for g in req.goals)
    ]
    is_solved = len(req.boxes) > 0 and len(boxes_on_goals) == len(req.boxes)
    
    return {
        "solved": is_solved,
        "boxesOnGoals": len(boxes_on_goals),
        "totalGoals": len(req.goals)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=4000)
