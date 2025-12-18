"""Quick check: run clingo on official levels 1..30 (no Python clingo/clorm needed)."""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAW_TS_PATH = PROJECT_ROOT / "new-frontend" / "my-app" / "app" / "data" / "officialLevelsRaw.ts"
SOLVER_PATH = PROJECT_ROOT / "asp" / "sokoban_solver_simple.lp"


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

        if not current_grid and current_title is None:
            t = line.strip()
            tm = re.match(r"^'(.*)'$", t)
            if tm:
                current_title = tm.group(1)
                continue

        if not current_grid and line.strip() == "":
            continue

        current_grid.append(line)

    flush()
    levels.sort(key=lambda x: x.id)
    return levels


def parse_level_to_facts(level: RawLevel) -> Tuple[str, int, int, int]:
    """
    Mirrors the frontend void flood fill:
    - pad to rectangle
    - mark outside spaces as 'x' (void) which we encode as wall
    - output facts: cell/3, initial_player/2, initial_box/2
    Returns: (facts_lp, n_boxes, width, height)
    """
    height = len(level.grid_lines)
    width = max((len(r) for r in level.grid_lines), default=0)

    raw_grid: List[List[str]] = []
    for y in range(height):
        raw_grid.append(list(level.grid_lines[y]) + [" "] * (width - len(level.grid_lines[y])))

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
        x, y = q.pop()
        enqueue(x - 1, y)
        enqueue(x + 1, y)
        enqueue(x, y - 1)
        enqueue(x, y + 1)

    player: Optional[Tuple[int, int]] = None
    boxes: List[Tuple[int, int]] = []

    out: List[str] = []
    for y in range(height):
        for x in range(width):
            ch = raw_grid[y][x]
            if ch == " " and is_void[y][x]:
                out.append(f"cell({x},{y},wall).")
                continue
            if ch == "#":
                out.append(f"cell({x},{y},wall).")
            elif ch == ".":
                out.append(f"cell({x},{y},goal).")
            elif ch == "@":
                out.append(f"cell({x},{y},floor).")
                player = (x, y)
            elif ch == "$":
                out.append(f"cell({x},{y},floor).")
                boxes.append((x, y))
            elif ch == "*":
                out.append(f"cell({x},{y},goal).")
                boxes.append((x, y))
            elif ch == "+":
                out.append(f"cell({x},{y},goal).")
                player = (x, y)
            else:
                # normal floor / internal space
                out.append(f"cell({x},{y},floor).")

    if player is None:
        raise RuntimeError(f"Level {level.id}: missing player '@'")

    out.append(f"initial_player({player[0]},{player[1]}).")
    for x, y in boxes:
        out.append(f"initial_box({x},{y}).")

    return "\n".join(out) + "\n", len(boxes), width, height


def run_clingo_once(*, facts_lp: str, max_steps: int, timeout_s: float) -> Tuple[bool, float]:
    """
    Returns (sat, wall_time_seconds).
    """
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        facts_path = td_path / "level.lp"
        facts_path.write_text(facts_lp, encoding="utf-8")

        cmd = [
            "clingo",
            str(SOLVER_PATH),
            str(facts_path),
            "--quiet=1,0,0",
            "--outf=2",
            "--opt-mode=ignore",
            # NOTE: clingo's --time-limit expects an integer number of seconds.
            f"--time-limit={max(1, int(timeout_s))}",
            "-c",
            f"max_steps={max_steps}",
        ]
        t0 = time.perf_counter()
        p = subprocess.run(cmd, capture_output=True, text=True)
        dt = time.perf_counter() - t0

        # clingo returns 0 even when UNSAT; time-limit usually returns 0 with "UNKNOWN" in JSON
        try:
            data = json.loads(p.stdout or "{}")
        except json.JSONDecodeError:
            return False, dt

        result = (data.get("Result") or "").upper()
        if result == "SATISFIABLE" or result == "OPTIMUM FOUND":
            return True, dt
        return False, dt


def main() -> None:
    level_start = int(os.environ.get("LEVEL_START", "1") or "1")
    level_end = int(os.environ.get("LEVEL_END", "30") or "30")
    per_level_timeout = float(os.environ.get("PER_LEVEL_TIMEOUT", "8.0") or "8.0")
    start_pushes = int(os.environ.get("START_PUSHES", "5") or "5")
    max_pushes = int(os.environ.get("MAX_PUSHES", "120") or "120")
    step_inc = int(os.environ.get("STEP_INC", "5") or "5")

    raw = extract_official_levels_raw(RAW_TS_PATH)
    levels = [l for l in parse_levels(raw) if level_start <= l.id <= level_end]

    print(f"Solver: {SOLVER_PATH}")
    print(f"Levels: {level_start}..{level_end} ({len(levels)} levels)")
    print(f"Budget: {per_level_timeout}s/level | horizon: start={start_pushes}, inc={step_inc}, cap={max_pushes}")
    print()

    solved = 0
    total_time = 0.0

    for lvl in levels:
        title = f" — {lvl.title}" if lvl.title else ""
        facts_lp, n_boxes, w, h = parse_level_to_facts(lvl)

        t_level0 = time.perf_counter()
        horizon = max(1, start_pushes)
        found = False

        while horizon <= max_pushes:
            elapsed = time.perf_counter() - t_level0
            remaining = per_level_timeout - elapsed
            if remaining <= 0:
                break

            # keep each attempt short so we can try multiple horizons
            attempt_timeout = min(1.5, remaining)
            sat, dt = run_clingo_once(facts_lp=facts_lp, max_steps=horizon, timeout_s=attempt_timeout)
            if sat:
                found = True
                break
            horizon += step_inc

        dt_level = time.perf_counter() - t_level0
        total_time += dt_level

        if found:
            solved += 1
            print(f"Level {lvl.id:2d}{title}: ✓  (boxes={n_boxes}, {w}x{h}) pushes<={horizon}  time={dt_level:.2f}s")
        else:
            print(f"Level {lvl.id:2d}{title}: ✗  (boxes={n_boxes}, {w}x{h})  time={dt_level:.2f}s")

    print()
    print(f"Summary: solved {solved}/{len(levels)} | total time {total_time:.2f}s")


if __name__ == "__main__":
    main()


