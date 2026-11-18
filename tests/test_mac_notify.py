"""Tests for posting a Mac notification through the notifier app (src/aicity/mac_notify.py).

Nothing is posted for real: a fake runner records the command. It must be a
list of arguments (no shell), and a missing app or a failing `open` must never
stop the reminder check.
"""

from aicity.mac_messages import MacMessage
from aicity.mac_notify import post

MSG = MacMessage("Reminder", "Call the garage; rm -rf ~ $(whoami)")


class Recorder:
    def __init__(self) -> None:
        self.calls: list[tuple[list[str], dict]] = []

    def __call__(self, args, **kwargs):
        self.calls.append((args, kwargs))


def test_post_runs_open_with_a_list_of_arguments(tmp_path):
    app = tmp_path / "Asteroid Belt Notifier.app"
    app.mkdir()
    run = Recorder()
    assert post(MSG, app=app, run=run) is True
    [(args, kwargs)] = run.calls
    assert args == [
        "open",
        "-n",
        "-g",
        str(app),
        "--args",
        "--title",
        "Reminder",
        "--body",
        MSG.body,
    ]
    assert kwargs.get("shell", False) is False
    assert kwargs.get("check") is False


def test_post_skips_quietly_when_the_app_is_missing(tmp_path):
    run = Recorder()
    assert post(MSG, app=tmp_path / "missing.app", run=run) is False
    assert run.calls == []


def test_post_survives_a_failing_open(tmp_path):
    app = tmp_path / "Asteroid Belt Notifier.app"
    app.mkdir()

    def broken(*_args, **_kwargs):
        raise OSError("open isn't available")

    assert post(MSG, app=app, run=broken) is False


def test_app_posts_per_the_rule_using_mode_and_looking(monkeypatch, tmp_path):
    from aicity import config, mac_notify
    from aicity import main as main_module
    from aicity.db import DbKind
    from aicity.notifications import Notification

    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    posted = []
    monkeypatch.setattr(mac_notify, "post", lambda m: posted.append(m))
    app = main_module.create_app(dev=False)
    new = [Notification(1, "reminder", 7, "Call the garage", "2026-11-18T12:30", False)]

    app.state.db_kind = DbKind.PERSONAL
    app.state.presence.report(True)
    main_module._mac_notify(app, new)
    assert posted == []  # looking, Personal: the shuttle shows it

    app.state.presence.report(False)
    main_module._mac_notify(app, new)
    assert posted[-1] == MacMessage("Reminder", "Call the garage")

    app.state.db_kind = DbKind.SAMPLE
    main_module._mac_notify(app, new)
    assert posted[-1] == MacMessage("Reminder", "You have a reminder")
