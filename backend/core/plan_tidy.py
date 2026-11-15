"""Join rooms up: neighbours meet at their shared walls, and edges that nearly line up are lined up.

Room boxes from the vision model sit just inside each room's walls, so two rooms either side of a wall are a
wall's thickness apart, and every edge is a few centimetres off its neighbours'. Drawn as they are, the
rooms float apart with gaps between them. This closes those gaps: facing edges of neighbouring rooms meet
halfway, and edges within a hand's width of each other are set to their average.
"""

from __future__ import annotations

import copy
from typing import Any

GAP = 0.6       # facing edges closer than this (a wall, or a wall and a bit of error) meet
ALIGN = 0.25    # edges closer than this along the same line are lined up
MIN_SIZE = 0.5  # a room never ends up narrower than this


def tidy(plan: dict[str, Any]) -> dict[str, Any]:
    rooms = plan.get("rooms") or []
    if len(rooms) < 2:
        return plan
    boxes = [[r["x"], r["y"], r["x"] + r["width"], r["y"] + r["depth"]] for r in rooms]
    original = copy.deepcopy(boxes)

    # 1. neighbours either side of a wall meet in its middle
    for axis in (0, 1):
        lo, hi, olo, ohi = axis, axis + 2, 1 - axis, 3 - axis
        for a in boxes:
            for b in boxes:
                if a is b:
                    continue
                gap = b[lo] - a[hi]
                along = min(a[ohi], b[ohi]) - max(a[olo], b[olo])   # how much of the wall they share
                if -0.2 <= gap <= GAP and along >= 0.3:
                    a[hi] = b[lo] = (a[hi] + b[lo]) / 2

    # 2. edges that nearly line up are lined up (weighted by how long each edge is)
    for axis in (0, 1):
        edges = []   # (value, length, box, index)
        for b in boxes:
            length = b[3 - axis] - b[1 - axis]
            edges += [(b[axis], length, b, axis), (b[axis + 2], length, b, axis + 2)]
        edges.sort(key=lambda e: e[0])
        group: list = []
        for e in edges + [None]:
            if e is not None and (not group or e[0] - group[0][0] <= ALIGN):
                group.append(e)
                continue
            if len(group) > 1:
                total = sum(g[1] for g in group) or 1
                mean = sum(g[0] * g[1] for g in group) / total
                for _, _, b, k in group:
                    b[k] = mean
            group = [e] if e is not None else []

    # never shrink a room to nothing: any that got too small keeps its original edges
    for i, b in enumerate(boxes):
        if b[2] - b[0] < MIN_SIZE or b[3] - b[1] < MIN_SIZE:
            boxes[i] = original[i]

    ox, oy = min(b[0] for b in boxes), min(b[1] for b in boxes)
    out = dict(plan)
    out["rooms"] = []
    for r, b in zip(rooms, boxes):
        nr = dict(r)
        nr.update(x=round(b[0] - ox, 3), y=round(b[1] - oy, 3), width=round(b[2] - b[0], 3), depth=round(b[3] - b[1], 3))
        out["rooms"].append(nr)
    # fixtures drawn on the plan move with the plan's origin
    if out.get("fixtures"):
        out["fixtures"] = [dict(f, x=round(f["x"] - ox, 3), y=round(f["y"] - oy, 3)) if "x" in f else dict(f) for f in out["fixtures"]]
    out["width"] = round(max(r["x"] + r["width"] for r in out["rooms"]), 3)
    out["depth"] = round(max(r["y"] + r["depth"] for r in out["rooms"]), 3)
    return out
