"""Developer tool: run the solver on official levels from the frontend dataset."""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAW_TS_PATH = PROJECT_ROOT / "new-frontend" / "my-app" / "app" / "data" / "officialLevelsRaw.ts"


@dataclass(frozen=True)
class RawLevel:
    id: int
    title: Optional[str]
    grid_lines: List[str]


def extract_official_levels_raw(ts_path: Path) -> str:
    text = ts_path.read_text(encoding="utf-8")
    m = re.search(r"OFFICIAL_LEVELS_RAW\s*=\s*`([\s\S]*?)`;", text)
    if not m:
        raise RuntimeError(f"Could not find OFFICIAL_LEVELS_RAW template string in {ts_path}")
    return m.group(1)


def parse_levels(raw: str) -> List[RawLevel]:
    levels: List[RawLevel] = []
    lines = raw.splitlines()

    current_id: Optional[int] = None
    current_title: Optional[str] = None
    current_grid: List[str] = []

    def flush():
        nonlocal current_id, current_title, current_grid
        if current_id is None:
            return
        # trim empty lines
        while current_grid and current_grid[0].strip() == "":
            current_grid.pop(0)
        while current_grid and current_grid[-1].strip() == "":
            current_grid.pop()
        levels.append(RawLevel(id=current_id, title=current_title, grid_lines=current_grid))

    for line in lines:
        lm = re.match(r"^Level\s+(\d+)\s*$", line.strip())
        if lm:
            flush()
            current_id = int(lm.group(1))
            current_title = None
            current_grid = []
            continue

        if current_id is None:
            continue

        # Optional title line like: 'Duh!'
        if not current_grid and current_title is None:
            t = line.strip()
            tm = re.match(r"^'(.*)'$", t)
            if tm:
                current_title = tm.group(1)
                continue

        # ignore leading empty lines inside a level
        if not current_grid and line.strip() == "":
            continue

        current_grid.append(line)

    flush()
    levels.sort(key=lambda x: x.id)
    return levels


def parse_level_to_state(level: RawLevel):
    """
    Mirrors frontend parseLevel() + void flood fill:
      - Pads to a rectangular grid
      - Marks outside spaces as 'x' (void)
      - Extracts player/boxes/goals
    """
    height = len(level.grid_lines)
    width = max((len(r) for r in level.grid_lines), default=0)

    # padded raw grid
    raw_grid: List[List[str]] = []
    for y in range(height):
        row = list(level.grid_lines[y]) + [" "] * (width - len(level.grid_lines[y]))
        raw_grid.append(row)

    # void detection: flood fill from boundary spaces
    is_void = [[False] * width for _ in range(height)]
    q: List[Tuple[int, int]] = []

    def enqueue(x: int, y: int):
        if x < 0 or x >= width or y < 0 or y >= height:
            return
        if is_void[y][x]:
            return
        if raw_grid[y][x] != " ":
            return
        is_void[y][x] = True
        q.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while q:
        x, y = q.pop(0)
        enqueue(x - 1, y)
        enqueue(x + 1, y)
        enqueue(x, y - 1)
        enqueue(x, y + 1)

    grid: List[List[str]] = []
    player: Optional[Tuple[int, int]] = None
    boxes: List[Tuple[int, int]] = []
    goals: List[Tuple[int, int]] = []

    for y in range(height):
        prow: List[str] = []
        for x in range(width):
            ch = raw_grid[y][x]
            if ch == " " and is_void[y][x]:
                prow.append("x")
                continue
            if ch == "#":
                prow.append("#")
            elif ch == ".":
                prow.append(".")
                goals.append((x, y))
            elif ch == "@":
                prow.append(" ")
                player = (x, y)
            elif ch == "$":
                prow.append(" ")
                boxes.append((x, y))
            elif ch == "*":
                prow.append(".")
                boxes.append((x, y))
                goals.append((x, y))
            elif ch == "+":
                prow.append(".")
                player = (x, y)
                goals.append((x, y))
            else:
                prow.append(" ")
        grid.append(prow)

    if player is None:
        raise RuntimeError(f"Level {level.id}: missing player '@'")

    return grid, player, boxes, goals


def main() -> None:
    import main as nb_main  # local new-backend/main.py

    raw = extract_official_levels_raw(RAW_TS_PATH)
    levels = parse_levels(raw)

    level_limit = int(os.environ.get("LEVEL_LIMIT", "0") or "0")
    level_start = int(os.environ.get("LEVEL_START", "1") or "1")
    level_end = int(os.environ.get("LEVEL_END", "0") or "0")
    per_level_timeout = float(os.environ.get("PER_LEVEL_TIMEOUT", "15"))
    start_steps = max(1, int(os.environ.get("START_STEPS", "35")))

    # Filter by range first (so you can run 20-by-20 batches)
    if level_start > 1:
        levels = [l for l in levels if l.id >= level_start]
    if level_end and level_end > 0:
        levels = [l for l in levels if l.id <= level_end]
    if level_limit > 0:
        levels = levels[:level_limit]

    print(f"Loaded {len(levels)} official levels from: {RAW_TS_PATH}")
    print(f"Range: {level_start}..{level_end if level_end else 'end'} | Start steps={start_steps}, per-level timeout={per_level_timeout}s")

    solved = 0
    failed: List[int] = []

    for lvl in levels:
        title = f" — {lvl.title}" if lvl.title else ""
        print(f"\nLevel {lvl.id}{title}")

        grid, player, boxes, goals = parse_level_to_state(lvl)
        state = nb_main.GameState(
            grid=grid,
            player=nb_main.Point(x=player[0], y=player[1]),
            boxes=[nb_main.Point(x=x, y=y) for x, y in boxes],
            goals=[nb_main.Point(x=x, y=y) for x, y in goals],
        )

        if nb_main.check_deadlocks(state):
            print("  ✗ deadlock detected by static checker (unsolvable from this state)")
            failed.append(lvl.id)
            continue

        facts = nb_main.game_state_to_facts(state)

        t_level_start = time.time()
        found = False

        # Prefer push-based solver first (usually much faster on harder levels).
        # We cap the clingo phase so we still have time for a fallback within the per-level budget.
        clingo_budget = min(per_level_timeout * 0.6, 12.0)
        push_steps = start_steps
        while True:
            elapsed = time.time() - t_level_start
            remaining_clingo = clingo_budget - elapsed
            if remaining_clingo <= 0:
                break

            t0 = time.time()
            res = nb_main.run_clingo(
                facts,
                push_steps,
                timeout=min(remaining_clingo, 10.0),
                solver_path=nb_main.ASP_PUSH_SOLVER_PATH,
                opt_mode_ignore=False,
            )
            dt = time.time() - t0

            if res:
                moves, pushes, slides = res
                full = nb_main._reconstruct_moves_from_pushes(state, pushes)
                full_len = len(full) if full else 0
                print(f"  ✓ solvable (push_steps={push_steps}, dt={dt:.2f}s) pushes={len(pushes)} reconstructed_moves={full_len}")
                found = True
                break

            # Increase push horizon
            push_steps += 5 if push_steps < 60 else 10

        # Fallback: if clingo cannot find any model in time, use a quick push-space A* to
        # generate a do_push plan, then materialize it with clingo (fixed do_push) so the
        # emitted push/5 facts still come from ASP.
        if not found:
            elapsed = time.time() - t_level_start
            remaining = per_level_timeout - elapsed
            if remaining > 0:
                do_plan = nb_main._solve_push_astar(state, time_limit_sec=min(6.0, remaining), max_expansions=500_000)
                if do_plan:
                    fixed = nb_main._run_clingo_with_fixed_do_push(
                        facts,
                        do_plan,
                        nb_main.ASP_PUSH_SOLVER_PATH,
                        timeout=min(5.0, remaining),
                    )
                    if fixed:
                        _, pushes = fixed
                        full = nb_main._reconstruct_moves_from_pushes(state, pushes)
                        full_len = len(full) if full else 0
                        print(f"  ✓ solvable (A* fallback) pushes={len(do_plan)} reconstructed_moves={full_len}")
                        found = True

        if found:
            solved += 1
        else:
            print(f"  ✗ no plan found within {per_level_timeout}s (last push_steps={push_steps})")
            failed.append(lvl.id)

    print("\n==== Summary ====")
    print(f"Solved: {solved}/{len(levels)}")
    if failed:
        print(f"Failed levels: {failed}")


if __name__ == "__main__":
    main()


