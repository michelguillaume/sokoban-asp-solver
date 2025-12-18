from __future__ import annotations

import heapq
import itertools
import time
from collections import deque
from dataclasses import dataclass
from functools import lru_cache
from typing import Dict, FrozenSet, Iterable, List, Optional, Set, Tuple


LEVEL_36_RAW = [
    "####",
    "#  ############",
    "# $ $ $ $ $ @ #",
    "# .....       #",
    "###############",
]


Pos = Tuple[int, int]  # (x, y)


DIRS: List[Tuple[str, int, int]] = [
    ("U", 0, -1),
    ("D", 0, 1),
    ("L", -1, 0),
    ("R", 1, 0),
]


@dataclass(frozen=True)
class ParsedLevel:
    width: int
    height: int
    walls: FrozenSet[Pos]
    goals: FrozenSet[Pos]
    start_player: Pos
    start_boxes: FrozenSet[Pos]


def parse_level(lines: List[str]) -> ParsedLevel:
    height = len(lines)
    width = max(len(r) for r in lines)

    walls: Set[Pos] = set()
    goals: Set[Pos] = set()
    boxes: Set[Pos] = set()
    player: Optional[Pos] = None

    for y, row in enumerate(lines):
        for x in range(width):
            # IMPORTANT: padding beyond end-of-line is "void/outside", not walkable.
            # Treat it as wall to prevent the player from escaping the bounded map.
            if x >= len(row):
                walls.add((x, y))
                continue
            c = row[x]
            if c == "#":
                walls.add((x, y))
            elif c == ".":
                goals.add((x, y))
            elif c == "$":
                boxes.add((x, y))
            elif c == "@":
                player = (x, y)
            elif c == "*":
                boxes.add((x, y))
                goals.add((x, y))
            elif c == "+":
                player = (x, y)
                goals.add((x, y))

    if player is None:
        raise ValueError("No player '@' found in level.")
    if len(boxes) != len(goals):
        raise ValueError(f"Expected same number of boxes and goals, got {len(boxes)} boxes vs {len(goals)} goals.")

    return ParsedLevel(
        width=width,
        height=height,
        walls=frozenset(walls),
        goals=frozenset(goals),
        start_player=player,
        start_boxes=frozenset(boxes),
    )


def manhattan(a: Pos, b: Pos) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def assignment_heuristic(boxes: FrozenSet[Pos], goals: FrozenSet[Pos]) -> int:
    """
    Admissible heuristic: min-cost bijection between boxes and goals using Manhattan distance.
    With 5 boxes (Level 36), brute-force permutations is tiny (5! = 120).
    """
    blist = list(boxes)
    glist = list(goals)
    best = 10**9
    for perm in itertools.permutations(glist):
        s = 0
        for b, g in zip(blist, perm):
            s += manhattan(b, g)
            if s >= best:
                break
        if s < best:
            best = s
    return best


def min_assignment_cost(boxes: Tuple[Pos, ...], goals: Tuple[Pos, ...]) -> int:
    """
    Minimum cost matching (boxes -> goals) using DP over bitmasks.
    Small and fast for <= 10 boxes; Level 36 has 5.
    """
    n = len(boxes)
    if n != len(goals):
        raise ValueError("boxes/goals size mismatch")

    # dp[mask] = minimal cost to assign first k boxes to goals in 'mask'
    # where k = popcount(mask)
    dp = {0: 0}
    for mask in range(1 << n):
        if mask not in dp:
            continue
        k = mask.bit_count()
        if k >= n:
            continue
        base = dp[mask]
        b = boxes[k]
        for gi in range(n):
            if (mask >> gi) & 1:
                continue
            nmask = mask | (1 << gi)
            cost = base + manhattan(b, goals[gi])
            prev = dp.get(nmask)
            if prev is None or cost < prev:
                dp[nmask] = cost
    return dp[(1 << n) - 1]


def flood_reachable(level: ParsedLevel, player: Pos, boxes: FrozenSet[Pos]) -> Set[Pos]:
    blocked = set(level.walls) | set(boxes)
    q = deque([player])
    seen = {player}
    while q:
        x, y = q.popleft()
        for _, dx, dy in DIRS:
            nx, ny = x + dx, y + dy
            if nx < 0 or nx >= level.width or ny < 0 or ny >= level.height:
                continue
            np = (nx, ny)
            if np in seen:
                continue
            if np in blocked:
                continue
            seen.add(np)
            q.append(np)
    return seen


@dataclass(frozen=True)
class State:
    player: Pos
    boxes: FrozenSet[Pos]


@dataclass(frozen=True)
class Move:
    box_from: Pos
    box_to: Pos
    dir: str  # U/D/L/R (direction the box is pushed)

    def __str__(self) -> str:
        return f"{self.dir}:{self.box_from}->{self.box_to}"


def is_solved(level: ParsedLevel, boxes: FrozenSet[Pos]) -> bool:
    return boxes == level.goals


def canonical_state(level: ParsedLevel, player: Pos, boxes: FrozenSet[Pos]) -> State:
    """
    Canonicalize the player position for push-search:
    for a given box layout, only the player's reachable component matters
    (the player can walk for free between pushes).

    We represent that component by the lexicographically smallest reachable cell.
    """
    reachable = flood_reachable(level, player, boxes)
    rep = min(reachable)
    return State(player=rep, boxes=boxes)


def successors(level: ParsedLevel, state: State) -> Iterable[Tuple[State, Move]]:
    reachable = flood_reachable(level, state.player, state.boxes)
    boxes_set = set(state.boxes)
    walls = level.walls

    for (bx, by) in state.boxes:
        for d, dx, dy in DIRS:
            player_need = (bx - dx, by - dy)  # player stands behind the box
            box_dest = (bx + dx, by + dy)  # box moves forward

            if (
                player_need[0] < 0
                or player_need[0] >= level.width
                or player_need[1] < 0
                or player_need[1] >= level.height
            ):
                continue
            if box_dest[0] < 0 or box_dest[0] >= level.width or box_dest[1] < 0 or box_dest[1] >= level.height:
                continue
            if player_need not in reachable:
                continue
            if box_dest in walls:
                continue
            if box_dest in boxes_set:
                continue

            new_boxes = set(state.boxes)
            new_boxes.remove((bx, by))
            new_boxes.add(box_dest)
            # After pushing, player ends up on the old box cell
            new_state = canonical_state(level, player=(bx, by), boxes=frozenset(new_boxes))
            yield new_state, Move(box_from=(bx, by), box_to=box_dest, dir=d)


def astar_solve(level: ParsedLevel, *, time_limit_s: Optional[float] = None) -> Tuple[Optional[List[Move]], Dict[str, int]]:
    start = canonical_state(level, player=level.start_player, boxes=level.start_boxes)
    if is_solved(level, start.boxes):
        return [], {"expanded": 0, "generated": 0}

    goals_tuple = tuple(sorted(level.goals))

    @lru_cache(maxsize=200_000)
    def h_for_boxes(boxes_tuple: Tuple[Pos, ...]) -> int:
        # Sort boxes to make caching canonical
        return min_assignment_cost(tuple(sorted(boxes_tuple)), goals_tuple)

    # g-score over states
    g: Dict[State, int] = {start: 0}
    came_from: Dict[State, Tuple[State, Move]] = {}

    h0 = h_for_boxes(tuple(start.boxes))
    open_heap: List[Tuple[int, int, int, State]] = []
    # heap item: (f, h, tie, state)
    heapq.heappush(open_heap, (h0, h0, 0, start))
    open_set = {start}

    expanded = 0
    generated = 0
    t0 = time.perf_counter()
    tie = 0

    while open_heap:
        if time_limit_s is not None and (time.perf_counter() - t0) > time_limit_s:
            return None, {"expanded": expanded, "generated": generated}

        _, _, _, cur = heapq.heappop(open_heap)
        if cur not in open_set:
            continue
        open_set.remove(cur)
        expanded += 1

        if is_solved(level, cur.boxes):
            # Reconstruct
            path: List[Move] = []
            s = cur
            while s in came_from:
                prev, mv = came_from[s]
                path.append(mv)
                s = prev
            path.reverse()
            return path, {"expanded": expanded, "generated": generated}

        cur_g = g[cur]
        for nxt, mv in successors(level, cur):
            generated += 1
            tentative = cur_g + 1  # cost in pushes
            old = g.get(nxt)
            if old is not None and tentative >= old:
                continue
            g[nxt] = tentative
            came_from[nxt] = (cur, mv)
            h = h_for_boxes(tuple(nxt.boxes))
            f = tentative + h
            tie += 1
            heapq.heappush(open_heap, (f, h, tie, nxt))
            open_set.add(nxt)

    return None, {"expanded": expanded, "generated": generated}


def render(level: ParsedLevel, player: Pos, boxes: FrozenSet[Pos]) -> str:
    boxes_set = set(boxes)
    goals_set = set(level.goals)
    out_lines: List[str] = []
    for y in range(level.height):
        row: List[str] = []
        for x in range(level.width):
            p = (x, y)
            if p in level.walls:
                row.append("#")
            elif p == player:
                row.append("+" if p in goals_set else "@")
            elif p in boxes_set:
                row.append("*" if p in goals_set else "$")
            elif p in goals_set:
                row.append(".")
            else:
                row.append(" ")
        out_lines.append("".join(row).rstrip())
    return "\n".join(out_lines)


def main() -> None:
    level = parse_level(LEVEL_36_RAW)
    print("Level 36:")
    print(render(level, level.start_player, level.start_boxes))
    print()

    t0 = time.perf_counter()
    sol, stats = astar_solve(level, time_limit_s=60.0)
    dt = time.perf_counter() - t0

    if sol is None:
        print(f"No solution found within time limit. stats={stats} elapsed={dt:.3f}s")
        raise SystemExit(2)

    print(f"Solved in {len(sol)} pushes. expanded={stats['expanded']} generated={stats['generated']} elapsed={dt:.3f}s")
    print("Push sequence (U/D/L/R):")
    print("".join(m.dir for m in sol))


if __name__ == "__main__":
    main()


