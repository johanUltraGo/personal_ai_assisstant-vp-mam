# Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the task database, task state machine, task CRUD API, overdue detection, and a minimal desktop task list UI — Phase 1 of the roadmap in `planning.md` §15.

**Architecture:** A single FastAPI backend exposes a REST API over a SQLAlchemy-modeled task store; a minimal static HTML/JS page (served by the same app) is the "desktop task list" UI from `planning.md` §9. No scheduler, no notifications, no voice capture, no auth, and no external sync are built in this phase — those are Phase 2+ and depend on open questions in `planning.md` §17 that aren't resolved yet.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy, Pydantic, SQLite (dev/test), pytest, httpx (for FastAPI `TestClient`), vanilla HTML/CSS/JS (no frontend framework) for the static UI.

**Spec:** `planning.md` (this repo) — specifically §4 (task lifecycle), §5 (reminder rules, deferred), §9 (acceptance criteria), §10 (phase 1 scope), §19 (acceptance criteria).

**Scoped decisions made here (not in the spec, my call):**
- **Database engine:** SQLite via SQLAlchemy for Phase 1, instead of standing up a local Supabase/Postgres instance now. Supabase is Postgres underneath; the ORM models here are plain SQLAlchemy with no SQLite-only types, so switching the engine URL to a local Postgres/Supabase instance in Phase 2 (when auth/row-level-security actually matters) requires no model changes. Avoids a Docker/Supabase-CLI dependency for a phase that doesn't need multi-user auth yet.
- **Task states for Phase 1:** `DRAFTED`, `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `OVERDUE`. The spec's "Stage 1 alert" / "Stage 2 alert" lifecycle entries (§4) are modeled as *alert events* against a `SCHEDULED` task in Phase 2, not as task states — a task doesn't stop being "Scheduled" just because a reminder fired.
- **Categories for Phase 1:** `TEACHING`, `ACADEMIC_ADMIN`, `EXAM_DUTIES`, `EVENTS`. `FOOD_QUALITY` is deliberately excluded — `planning.md` §17 Q5 flags it as unconfirmed scope, so the enum has no slot for it until that's answered.
- **Overdue detection trigger:** Phase 1 has no scheduler (that's Phase 2), so overdue detection is exposed as a plain function and an API endpoint (`POST /tasks/overdue-sweep`) that a human or a future cron can call. It is not wired to run automatically yet.
- **"Manual completion only" (FR-7) enforcement:** there is no auth yet, so in this phase "the Principal confirms" means "a human clicks Complete in the UI" — there is no system path that reaches `COMPLETED` without an explicit API call to the complete endpoint.

## Global Constraints

- Only a human-initiated action may move a task to `COMPLETED` — the system must never do this itself (`planning.md` §3, §8, FR-7).
- Every state transition must write exactly one `TaskHistory` row with a timestamp (`planning.md` §4, FR-9).
- No student personal data fields exist anywhere in the schema (`planning.md` §6, §8.2).
- No category outside `TEACHING`, `ACADEMIC_ADMIN`, `EXAM_DUTIES`, `EVENTS` is accepted in Phase 1 (scoped decision above).
- No outbound communication to anyone outside the single operator exists in this phase — there is no such code path to build (`planning.md` §6, §8.2).

## Review Focus

- Calling an endpoint that requests an invalid transition (e.g., completing a `DRAFTED` task directly, or scheduling an already-`COMPLETED` task) — the spec implies a well-defined lifecycle (§4); a wrong-endpoint call must be rejected, not silently corrupt state. Covered in Task 2.
- Creating a task with a missing title, missing `due_at`, or an unparseable `due_at` — §4 says "fields validated" on entry to `DRAFTED`; malformed input must be rejected with a clear error, not crash or persist a broken row. Covered in Task 3.
- Running the overdue sweep against a `COMPLETED` task whose `due_at` has already passed — a finished task must never be flipped to `OVERDUE` after the fact. Covered in Task 4.
- Running the overdue sweep twice in a row against the same overdue task — must be idempotent: no duplicate `OVERDUE` history rows, no double transition error. Covered in Task 4.
- Submitting a category value outside the four accepted enum values (e.g., `"FOOD_QUALITY"` or a typo) — must be rejected cleanly at the API boundary, since `planning.md` §17 Q5 leaves that category unconfirmed. Covered in Task 5.

---

## File Structure

```
app/
  __init__.py
  main.py              # FastAPI app, mounts router + static UI
  db.py                # engine, SessionLocal, Base, get_db dependency
  models.py            # Task, TaskHistory ORM models, TaskState/Category enums
  state_machine.py      # ALLOWED_TRANSITIONS table + transition() function
  crud.py              # create_draft_task, schedule_task, start_task, complete_task
  overdue.py           # run_overdue_sweep(session) -> list[Task]
  schemas.py           # Pydantic request/response models
  routers/
    __init__.py
    tasks.py           # FastAPI route handlers
  static/
    index.html         # desktop task list page
    app.js             # fetch calls to the API
    style.css
tests/
  conftest.py          # in-memory SQLite session fixture, FastAPI TestClient fixture
  test_state_machine.py
  test_crud.py
  test_overdue.py
  test_api_tasks.py
pyproject.toml
```

---

### Task 1: Project scaffolding, database session, and health check

**Files:**
- Create: `pyproject.toml`
- Create: `app/__init__.py`
- Create: `app/db.py`
- Create: `app/main.py`
- Create: `tests/conftest.py`
- Create: `tests/test_api_tasks.py` (health check only in this task; task endpoints added in Task 5)

**Interfaces:**
- Produces: `app/db.py` exposes `Base` (SQLAlchemy declarative base), `engine`, `SessionLocal` (sessionmaker), and `get_db()` (FastAPI dependency generator yielding a `Session`).
- Produces: `app/main.py` exposes `app` (the FastAPI instance) with a `GET /health` route returning `{"status": "ok"}`.
- Produces: `tests/conftest.py` exposes pytest fixtures `db_session` (a `Session` bound to a fresh in-memory SQLite DB with all tables created) and `client` (a `fastapi.testclient.TestClient` wrapping `app`, with `get_db` overridden to yield `db_session`).

- [ ] **Step 1: Initialize the project**

Run: `git init` in `c:\VICE PRINCIPAL AI`, then create `pyproject.toml` with project metadata and dependencies: `fastapi`, `uvicorn`, `sqlalchemy`, `pydantic`, and dev dependencies `pytest`, `httpx`.

- [ ] **Step 2: Write the failing health-check test**

```python
# tests/test_api_tasks.py
def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_api_tasks.py::test_health_check -v`
Expected: FAIL (no `conftest.py` fixtures / no app yet — collection or import error)

- [ ] **Step 4: Implement `app/db.py` and `app/main.py`**

`app/db.py`: SQLite engine at `sqlite:///./vpai.db` (`check_same_thread=False`), `SessionLocal = sessionmaker(bind=engine)`, `Base = declarative_base()`, `get_db()` yields a session and closes it in a `finally` block.

`app/main.py`: `app = FastAPI()`; a `GET /health` route returning `{"status": "ok"}`. Do not mount the static UI or task router yet — those arrive in Tasks 5 and 6.

- [ ] **Step 5: Implement `tests/conftest.py`**

`db_session` fixture: creates an in-memory SQLite engine (`sqlite:///:memory:`) per test, calls `Base.metadata.create_all`, yields a bound `Session`, and disposes the engine after.

`client` fixture: imports `app` from `app.main`, overrides the `get_db` dependency to return the `db_session` fixture's session, and yields a `TestClient(app)`.

- [ ] **Step 6: Run test to verify it passes**

Run: `pytest tests/test_api_tasks.py::test_health_check -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml app tests .gitignore
git commit -m "chore: project scaffolding, db session, health check"
```

---

### Task 2: Task and TaskHistory models with the state machine

**Files:**
- Create: `app/models.py`
- Create: `app/state_machine.py`
- Create: `tests/test_state_machine.py`

**Interfaces:**
- Consumes: `app/db.py`'s `Base` (Task 1).
- Produces: `app/models.py` exposes:
  - `TaskState(str, Enum)` with members `DRAFTED`, `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `OVERDUE`.
  - `Category(str, Enum)` with members `TEACHING`, `ACADEMIC_ADMIN`, `EXAM_DUTIES`, `EVENTS`.
  - `Task` ORM model: `id` (int, PK), `title` (str, not null), `description` (str, nullable), `category` (`Category`, not null), `due_at` (datetime, not null), `state` (`TaskState`, not null, default `DRAFTED`), `created_at` (datetime, not null), `updated_at` (datetime, not null).
  - `TaskHistory` ORM model: `id` (int, PK), `task_id` (FK -> `Task.id`, not null), `from_state` (`TaskState`, nullable — null for the initial creation row), `to_state` (`TaskState`, not null), `changed_at` (datetime, not null).
- Produces: `app/state_machine.py` exposes:
  - `class InvalidTransitionError(Exception)`.
  - `ALLOWED_TRANSITIONS: dict[TaskState, set[TaskState]]` mapping each state to the states it may move to: `DRAFTED -> {SCHEDULED, OVERDUE}`, `SCHEDULED -> {IN_PROGRESS, COMPLETED, OVERDUE}`, `IN_PROGRESS -> {COMPLETED, OVERDUE}`, `OVERDUE -> {IN_PROGRESS, COMPLETED}`, `COMPLETED -> {}`.
  - `transition(session: Session, task: Task, to_state: TaskState) -> Task` — raises `InvalidTransitionError` if `to_state` not in `ALLOWED_TRANSITIONS[task.state]`; otherwise sets `task.state = to_state`, `task.updated_at = now`, inserts a `TaskHistory` row (`from_state=old_state, to_state=to_state, changed_at=now`), commits, and returns the task.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_state_machine.py
import pytest
from app.models import Task, TaskHistory, TaskState, Category
from app.state_machine import transition, InvalidTransitionError

def make_task(db_session, **overrides):
    defaults = dict(title="t", category=Category.TEACHING, due_at=some_future_dt())
    defaults.update(overrides)
    task = Task(**defaults)
    db_session.add(task)
    db_session.commit()
    return task

def test_valid_transition_updates_state_and_logs_history(db_session):
    task = make_task(db_session)
    transition(db_session, task, TaskState.SCHEDULED)
    assert task.state == TaskState.SCHEDULED
    history = db_session.query(TaskHistory).filter_by(task_id=task.id).all()
    assert len(history) == 1
    assert history[0].from_state == TaskState.DRAFTED
    assert history[0].to_state == TaskState.SCHEDULED
    assert history[0].changed_at is not None

def test_invalid_transition_raises_and_does_not_change_state(db_session):
    task = make_task(db_session)  # DRAFTED
    with pytest.raises(InvalidTransitionError):
        transition(db_session, task, TaskState.COMPLETED)
    assert task.state == TaskState.DRAFTED
    assert db_session.query(TaskHistory).filter_by(task_id=task.id).count() == 0

def test_completed_is_terminal(db_session):
    task = make_task(db_session, state=TaskState.COMPLETED)
    with pytest.raises(InvalidTransitionError):
        transition(db_session, task, TaskState.IN_PROGRESS)
```

(`some_future_dt()` is a small local helper in the test file returning `datetime.now() + timedelta(hours=1)`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_state_machine.py -v`
Expected: FAIL (`app.models` / `app.state_machine` don't exist yet)

- [ ] **Step 3: Implement `app/models.py` and `app/state_machine.py`**

Use the exact enum members, fields, and `ALLOWED_TRANSITIONS` table given in the Interfaces block above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_state_machine.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/models.py app/state_machine.py tests/test_state_machine.py
git commit -m "feat: task/history models and state machine"
```

---

### Task 3: Task CRUD service layer

**Files:**
- Create: `app/crud.py`
- Create: `tests/test_crud.py`

**Interfaces:**
- Consumes: `Task`, `TaskHistory`, `TaskState`, `Category` from `app/models.py`; `transition`, `InvalidTransitionError` from `app/state_machine.py` (Task 2).
- Produces: `app/crud.py` exposes:
  - `class TaskValidationError(Exception)`.
  - `create_draft_task(session: Session, title: str, category: Category, due_at: datetime, description: str | None = None) -> Task` — raises `TaskValidationError` if `title` is empty/whitespace or `due_at` is falsy; otherwise creates a `Task` in state `DRAFTED`, inserts a `TaskHistory` row with `from_state=None, to_state=DRAFTED`, commits, returns it.
  - `schedule_task(session: Session, task: Task) -> Task` — calls `transition(session, task, TaskState.SCHEDULED)`.
  - `start_task(session: Session, task: Task) -> Task` — calls `transition(session, task, TaskState.IN_PROGRESS)`.
  - `complete_task(session: Session, task: Task) -> Task` — calls `transition(session, task, TaskState.COMPLETED)`.
  - `get_task(session: Session, task_id: int) -> Task | None`.
  - `list_tasks(session: Session, state: TaskState | None = None) -> list[Task]` — all tasks, optionally filtered by state, ordered by `due_at`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_crud.py
import pytest
from app.models import TaskState, Category
from app.crud import create_draft_task, schedule_task, complete_task, get_task, list_tasks, TaskValidationError

def test_create_draft_task_persists_and_logs_initial_history(db_session):
    task = create_draft_task(db_session, title="Review exam list", category=Category.EXAM_DUTIES, due_at=some_future_dt())
    assert task.id is not None
    assert task.state == TaskState.DRAFTED
    fetched = get_task(db_session, task.id)
    assert fetched.title == "Review exam list"

def test_create_draft_task_rejects_blank_title(db_session):
    with pytest.raises(TaskValidationError):
        create_draft_task(db_session, title="   ", category=Category.EVENTS, due_at=some_future_dt())

def test_create_draft_task_rejects_missing_due_at(db_session):
    with pytest.raises(TaskValidationError):
        create_draft_task(db_session, title="x", category=Category.EVENTS, due_at=None)

def test_list_tasks_filters_by_state(db_session):
    t1 = create_draft_task(db_session, title="a", category=Category.TEACHING, due_at=some_future_dt())
    t2 = create_draft_task(db_session, title="b", category=Category.TEACHING, due_at=some_future_dt())
    schedule_task(db_session, t2)
    scheduled = list_tasks(db_session, state=TaskState.SCHEDULED)
    assert [t.id for t in scheduled] == [t2.id]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_crud.py -v`
Expected: FAIL (`app.crud` doesn't exist yet)

- [ ] **Step 3: Implement `app/crud.py`**

Per the Interfaces block. `create_draft_task` validates before constructing the `Task` row, so a rejected task is never persisted.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_crud.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/crud.py tests/test_crud.py
git commit -m "feat: task CRUD service layer"
```

---

### Task 4: Overdue detection sweep

**Files:**
- Create: `app/overdue.py`
- Create: `tests/test_overdue.py`

**Interfaces:**
- Consumes: `Task`, `TaskState` from `app/models.py`; `transition` from `app/state_machine.py`.
- Produces: `app/overdue.py` exposes `run_overdue_sweep(session: Session, now: datetime | None = None) -> list[Task]` — finds every `Task` whose `due_at < now` (defaulting `now` to `datetime.now()`) and whose `state` is in `{DRAFTED, SCHEDULED, IN_PROGRESS}`, transitions each to `OVERDUE` via `transition()`, and returns the list of tasks that were changed. Tasks already `OVERDUE` or `COMPLETED` are left untouched and excluded from the returned list.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_overdue.py
from datetime import datetime, timedelta
from app.models import TaskState, Category, TaskHistory
from app.crud import create_draft_task, schedule_task, complete_task
from app.overdue import run_overdue_sweep

def test_sweep_marks_past_due_scheduled_task_overdue(db_session):
    task = create_draft_task(db_session, title="a", category=Category.TEACHING, due_at=datetime.now() - timedelta(minutes=5))
    schedule_task(db_session, task)
    changed = run_overdue_sweep(db_session)
    assert [t.id for t in changed] == [task.id]
    assert task.state == TaskState.OVERDUE

def test_sweep_ignores_completed_task_even_if_past_due(db_session):
    task = create_draft_task(db_session, title="a", category=Category.TEACHING, due_at=datetime.now() - timedelta(minutes=5))
    schedule_task(db_session, task)
    complete_task(db_session, task)
    changed = run_overdue_sweep(db_session)
    assert changed == []
    assert task.state == TaskState.COMPLETED

def test_sweep_is_idempotent(db_session):
    task = create_draft_task(db_session, title="a", category=Category.TEACHING, due_at=datetime.now() - timedelta(minutes=5))
    schedule_task(db_session, task)
    run_overdue_sweep(db_session)
    second_pass = run_overdue_sweep(db_session)
    assert second_pass == []
    history_count = db_session.query(TaskHistory).filter_by(task_id=task.id).count()
    assert history_count == 2  # DRAFTED->SCHEDULED, SCHEDULED->OVERDUE — no duplicate
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_overdue.py -v`
Expected: FAIL (`app.overdue` doesn't exist yet)

- [ ] **Step 3: Implement `app/overdue.py`**

Query tasks with `due_at < now` and `state.in_([DRAFTED, SCHEDULED, IN_PROGRESS])`; call `transition(session, task, TaskState.OVERDUE)` for each; collect and return the changed tasks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_overdue.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/overdue.py tests/test_overdue.py
git commit -m "feat: overdue detection sweep"
```

---

### Task 5: Task REST API

**Files:**
- Create: `app/schemas.py`
- Create: `app/routers/__init__.py`
- Create: `app/routers/tasks.py`
- Modify: `app/main.py` (mount the tasks router)
- Create: `tests/test_api_tasks.py` (extend — health check from Task 1 stays, task endpoint tests added here)

**Interfaces:**
- Consumes: everything in `app/crud.py` (Task 3), `run_overdue_sweep` (Task 4), `TaskState`/`Category` (Task 2).
- Produces: `app/schemas.py` exposes Pydantic models:
  - `TaskCreate(title: str, category: Category, due_at: datetime, description: str | None = None)`.
  - `TaskOut(id: int, title: str, description: str | None, category: Category, due_at: datetime, state: TaskState, created_at: datetime, updated_at: datetime)` with `model_config = {"from_attributes": True}`.
- Produces: `app/routers/tasks.py` exposes `router: APIRouter` with:
  - `POST /tasks` — body `TaskCreate`, returns `TaskOut` (201). On `TaskValidationError`, returns 422 with the error message.
  - `GET /tasks` — query param `state: TaskState | None`, returns `list[TaskOut]`.
  - `GET /tasks/{task_id}` — returns `TaskOut` or 404.
  - `POST /tasks/{task_id}/schedule` — returns updated `TaskOut`. On `InvalidTransitionError`, returns 409 with the error message.
  - `POST /tasks/{task_id}/start` — same pattern, calls `start_task`.
  - `POST /tasks/{task_id}/complete` — same pattern, calls `complete_task`.
  - `POST /tasks/overdue-sweep` — calls `run_overdue_sweep`, returns `list[TaskOut]` of changed tasks.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_api_tasks.py (additions)
def test_create_task_returns_201_and_drafted_state(client):
    resp = client.post("/tasks", json={"title": "Grade papers", "category": "TEACHING", "due_at": "2099-01-01T10:00:00"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["state"] == "DRAFTED"
    assert body["id"] is not None

def test_create_task_rejects_blank_title(client):
    resp = client.post("/tasks", json={"title": "  ", "category": "TEACHING", "due_at": "2099-01-01T10:00:00"})
    assert resp.status_code == 422

def test_create_task_rejects_unknown_category(client):
    resp = client.post("/tasks", json={"title": "x", "category": "FOOD_QUALITY", "due_at": "2099-01-01T10:00:00"})
    assert resp.status_code == 422

def test_schedule_then_complete_flow(client):
    created = client.post("/tasks", json={"title": "x", "category": "EVENTS", "due_at": "2099-01-01T10:00:00"}).json()
    task_id = created["id"]
    scheduled = client.post(f"/tasks/{task_id}/schedule")
    assert scheduled.status_code == 200
    assert scheduled.json()["state"] == "SCHEDULED"
    completed = client.post(f"/tasks/{task_id}/complete")
    assert completed.status_code == 200
    assert completed.json()["state"] == "COMPLETED"

def test_invalid_transition_returns_409(client):
    created = client.post("/tasks", json={"title": "x", "category": "EVENTS", "due_at": "2099-01-01T10:00:00"}).json()
    resp = client.post(f"/tasks/{created['id']}/complete")  # DRAFTED -> COMPLETED is not allowed
    assert resp.status_code == 409

def test_get_unknown_task_returns_404(client):
    resp = client.get("/tasks/999999")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_api_tasks.py -v`
Expected: FAIL (task endpoints don't exist yet — only `/health` does)

- [ ] **Step 3: Implement `app/schemas.py`, `app/routers/tasks.py`, and mount it in `app/main.py`**

Pydantic's enum validation handles the "unknown category" rejection automatically (Review Focus item) since `Category` is a `str, Enum` — no extra code needed beyond declaring the field as `Category` in `TaskCreate`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_api_tasks.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/schemas.py app/routers app/main.py tests/test_api_tasks.py
git commit -m "feat: task REST API"
```

---

### Task 6: Desktop task list UI

**Files:**
- Create: `app/static/index.html`
- Create: `app/static/app.js`
- Create: `app/static/style.css`
- Modify: `app/main.py` (mount `StaticFiles` at `/`)

**Interfaces:**
- Consumes: the `/tasks*` API from Task 5, over `fetch()`.
- Produces: a browser-usable page at `/` listing tasks grouped by state, with a form to create a task (title, category select, due date/time input, description) and per-task action buttons (Schedule / Start / Complete, shown only when that transition is currently valid per `ALLOWED_TRANSITIONS`) plus a "Check overdue now" button calling `POST /tasks/overdue-sweep` and refreshing the list.

- [ ] **Step 1: Implement `app/static/index.html`, `app/static/app.js`, `app/static/style.css`**

`app.js`: on load, `GET /tasks`, render grouped by `state`; wire the create form to `POST /tasks`; wire each action button to its endpoint, then re-fetch the list. Category `<select>` options are exactly the four Phase 1 categories (no `FOOD_QUALITY` option, consistent with the scoped decision above).

- [ ] **Step 2: Mount static files in `app/main.py`**

`app.mount("/", StaticFiles(directory="app/static", html=True), name="static")` — mounted last, after the `/health` route and the tasks router, so API routes still take precedence.

- [ ] **Step 3: Manual verification**

Run: `uvicorn app.main:app --reload`, open `http://127.0.0.1:8000/` in a browser, create a task, schedule it, start it, complete it, and confirm the list updates after each action and that the "Check overdue now" button changes a past-due task's state.

- [ ] **Step 4: Commit**

```bash
git add app/static app/main.py
git commit -m "feat: desktop task list UI"
```

---

## Self-Review Notes

- **Spec coverage:** FR-1 (partial — typed capture only; voice is Phase 3), task lifecycle/FR-4 (Tasks 2 & 4), FR-6 categories (Task 2/5), FR-7 manual completion (Tasks 2–5, Global Constraints), FR-9 audit trail (Task 2), §9's "overlapping tasks / no missed alert" and §5 reminder rules are explicitly Phase 2 (not in this plan — flagged in Architecture section, not silently dropped).
- **Step scan:** every code step names exact signatures; no step says "handle edge cases" without a named test.
- **Type consistency:** `TaskState`/`Category` enum members and `Task`/`TaskHistory` field names are defined once in Task 2 and reused verbatim in Tasks 3–6.
- **Review Focus:** all five items have an owning task and an explicit test (invalid transition → Task 2/5; bad input → Task 3/5; overdue-on-completed and sweep idempotency → Task 4; unknown category → Task 5).
- **Proportion:** six tasks, each independently testable; no task body transcribes logic the signature/tests already pin.
