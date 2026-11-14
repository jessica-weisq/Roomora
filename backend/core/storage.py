"""Where uploads, results and job status live.

On Modal, `root` is a Volume and `status` is a modal.Dict; locally, a folder and a plain dict.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, MutableMapping


class Store:
    def __init__(
        self,
        root: Path,
        status: MutableMapping[str, Any],
        commit: Callable[[], None] = lambda: None,
        reload: Callable[[], None] = lambda: None,
    ):
        self.root = Path(root)
        self._status = status
        # On Modal, writes to a Volume are only visible to other containers after commit(),
        # and a container only sees others' writes after reload().
        self.commit = commit
        self.reload = reload

    # Files ---------------------------------------------------------------
    def project_dir(self, project_id: str) -> Path:
        return self.root / "projects" / project_id

    def job_dir(self, job_id: str) -> Path:
        return self.root / "jobs" / job_id

    def write_json(self, path: Path, data: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2))

    def read_json(self, path: Path) -> Any:
        return json.loads(path.read_text())

    # Job status ----------------------------------------------------------
    def set_status(self, job_id: str, **fields: Any) -> None:
        current = dict(self._status.get(job_id) or {})
        current.update(fields)
        self._status[job_id] = current

    def get_status(self, job_id: str) -> dict | None:
        value = self._status.get(job_id)
        return dict(value) if value else None
