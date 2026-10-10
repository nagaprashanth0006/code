#!/usr/bin/env python3
import argparse
import json
import logging
import logging.handlers
import os
import re
import shlex
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

# Optional PTY on POSIX
try:
    import pty
    HAS_PTY = True
except Exception:
    HAS_PTY = False

APP_NAME = "local_agent"
LOG_DIR = Path("./logs")
LOG_DIR.mkdir(exist_ok=True)

def build_logger():
    logger = logging.getLogger(APP_NAME)
    logger.setLevel(logging.DEBUG)

    # Console
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.DEBUG)
    ch.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))

    # File (rotating)
    fh = logging.handlers.RotatingFileHandler(
        LOG_DIR / "agent.log", maxBytes=2_000_000, backupCount=5, encoding="utf-8"
    )
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))

    logger.addHandler(ch)
    logger.addHandler(fh)
    return logger

LOGGER = build_logger()

class JsonlLogger:
    def __init__(self, path: Path):
        self.fp = open(path, "a", encoding="utf-8", buffering=1)

    def write(self, obj: dict):
        line = json.dumps(obj, ensure_ascii=False)
        self.fp.write(line + "\n")

    def close(self):
        try:
            self.fp.close()
        except Exception:
            pass

EVENT_LOG = JsonlLogger(LOG_DIR / "agent_events.jsonl")

READ_ONLY_DEFAULT_ALLOWLIST = {
    "ls", "cat", "head", "tail", "grep", "egrep", "sed", "awk", "cut",
    "wc", "sort", "uniq", "tr", "find", "xargs", "pwd", "whoami",
    "uname", "id", "date", "env", "printenv", "echo",
    "lscpu", "free", "df", "du", "ps", "top", "uptime", "dmesg", "lsblk",
}

SHELL_META = re.compile(r"[;&|`$()<>]")

def sanitize_command(cmd: str, read_only: bool) -> tuple[bool, str]:
    """
    Basic guardrails:
    - Ban shell metacharacters to reduce command chaining/redirection risk.
    - If read_only: restrict to an allowlist of benign introspection commands.
    """
    stripped = cmd.strip()
    if not stripped:
        return False, "Empty command"

    if SHELL_META.search(stripped):
        return False, "Command rejected due to shell metacharacters"

    parts = shlex.split(stripped)
    base = Path(parts).name

    if read_only and base not in READ_ONLY_DEFAULT_ALLOWLIST:
        return False, f"Command '{base}' not in read-only allowlist"

    # Additional destructive patterns to block
    dangerous = {"rm", "mkfs", "dd", "shutdown", "reboot", "halt", "chown", "chmod", "mount", "umount"}
    if base in dangerous:
        return False, f"Command '{base}' is blocked"

    return True, ""

def run_shell(cmd: str, timeout: int = 15, use_pty: bool = False, read_only: bool = True):
    ok, reason = sanitize_command(cmd, read_only=read_only)
    start = time.time()
    event = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "type": "action",
        "tool": "shell",
        "cmd": cmd,
        "use_pty": bool(use_pty),
        "timeout_s": timeout,
        "read_only": bool(read_only),
    }
    if not ok:
        event["status"] = "rejected"
        event["error"] = reason
        EVENT_LOG.write(event)
        LOGGER.warning(f"[SHELL] Rejected: {reason} :: {cmd}")
        return {"ok": False, "stdout": "", "stderr": reason, "returncode": None, "duration_s": time.time() - start}

    try:
        if use_pty and HAS_PTY:
            # Allocate a PTY and run command without shell
            master_fd, slave_fd = pty.openpty()
            try:
                proc = subprocess.Popen(
                    shlex.split(cmd),
                    stdin=slave_fd,
                    stdout=slave_fd,
                    stderr=slave_fd,
                    text=False,
                    preexec_fn=os.setsid,
                )
                # Read until completion or timeout
                buf = bytearray()
                end_time = time.time() + timeout
                while True:
                    if proc.poll() is not None:
                        break
                    if time.time() > end_time:
                        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                        raise subprocess.TimeoutExpired(cmd, timeout)
                    try:
                        chunk = os.read(master_fd, 4096)
                        if not chunk:
                            time.sleep(0.05)
                            continue
                        buf.extend(chunk)
                    except OSError:
                        break
                # Drain any remaining
                try:
                    while True:
                        chunk = os.read(master_fd, 4096)
                        if not chunk:
                            break
                        buf.extend(chunk)
                except OSError:
                    pass
                stdout = buf.decode(errors="replace")
                rc = proc.wait(timeout=1)
                result = {"ok": rc == 0, "stdout": stdout, "stderr": "", "returncode": rc}
            finally:
                try:
                    os.close(master_fd)
                    os.close(slave_fd)
                except Exception:
                    pass
        else:
            cp = subprocess.run(
                shlex.split(cmd),
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            result = {
                "ok": cp.returncode == 0,
                "stdout": cp.stdout,
                "stderr": cp.stderr,
                "returncode": cp.returncode,
            }
    except subprocess.TimeoutExpired as e:
        result = {"ok": False, "stdout": "", "stderr": f"timeout after {timeout}s", "returncode": None}
    except Exception as e:
        result = {"ok": False, "stdout": "", "stderr": str(e), "returncode": None}

    result["duration_s"] = time.time() - start

    # Log to console
    status = "OK" if result["ok"] else "ERR"
    LOGGER.info(f"[SHELL:{status}] {cmd} (rc={result['returncode']}, {result['duration_s']:.2f}s)")
    if result["stdout"]:
        LOGGER.info(result["stdout"].rstrip("\n"))
    if result["stderr"]:
        LOGGER.error(result["stderr"].rstrip("\n"))

    # Persist event
    event.update({
        "status": status,
        "stdout": result["stdout"][:20000],
        "stderr": result["stderr"][:20000],
        "returncode": result["returncode"],
        "duration_s": result["duration_s"],
    })
    EVENT_LOG.write(event)
    return result

def run_python(code: str, timeout: int = 15):
    """
    Execute Python code in a separate interpreter process for isolation.
    """
    start = time.time()
    event = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "type": "action",
        "tool": "python",
        "timeout_s": timeout,
    }
    try:
        cp = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        ok = cp.returncode == 0
        result = {
            "ok": ok,
            "stdout": cp.stdout,
            "stderr": cp.stderr,
            "returncode": cp.returncode,
        }
    except subprocess.TimeoutExpired:
        result = {"ok": False, "stdout": "", "stderr": f"timeout after {timeout}s", "returncode": None}
    except Exception as e:
        result = {"ok": False, "stdout": "", "stderr": str(e), "returncode": None}

    result["duration_s"] = time.time() - start

    status = "OK" if result["ok"] else "ERR"
    LOGGER.info(f"[PY:{status}] (rc={result['returncode']}, {result['duration_s']:.2f}s)")
    if result["stdout"]:
        LOGGER.info(result["stdout"].rstrip("\n"))
    if result["stderr"]:
        LOGGER.error(result["stderr"].rstrip("\n"))

    event.update({
        "status": status,
        "code": code,
        "stdout": result["stdout"][:20000],
        "stderr": result["stderr"][:20000],
        "returncode": result["returncode"],
        "duration_s": result["duration_s"],
    })
    EVENT_LOG.write(event)
    return result

def initial_survey(read_only: bool, use_pty: bool):
    # Basic environment / host survey
    cmds = [
        "whoami",
        "pwd",
        "uname -a",
        "ls -al",
        "lscpu",
        "free -h",
        "df -h",
        "ps aux --sort=-%mem | head -n 15",
        "env",
        "find . -maxdepth 2 -type f -iname '*.py' | head -n 20",
    ]
    for c in cmds:
        run_shell(c, timeout=15, use_pty=use_pty, read_only=read_only)

def python_survey():
    snippet = r"""
import sys, platform, pkgutil
print("Python:", sys.version.replace("\n"," "))
print("Executable:", sys.executable)
print("Platform:", platform.platform())
mods = [m.name for m in pkgutil.iter_modules()]
print("Some modules:", sorted(mods)[:50])
"""
    run_python(snippet, timeout=20)

    psutil_snippet = r"""
try:
    import psutil
    print("psutil OK")
    print("CPU count:", psutil.cpu_count())
    print("Memory:", psutil.virtual_memory())
    print("Disks:", psutil.disk_partitions())
    print("Boot time:", psutil.boot_time())
except Exception as e:
    print("psutil not available or error:", e)
"""
    run_python(psutil_snippet, timeout=20)

def plan_next(step_idx: int) -> dict:
    # Simple heuristic planner to demonstrate "behavior"
    notes = ""
    if step_idx == 0:
        notes = "Initial host and environment survey"
        return {"tool": "shell_batch", "notes": notes}
    elif step_idx == 1:
        notes = "Python runtime survey and optional psutil"
        return {"tool": "python_survey", "notes": notes}
    elif step_idx == 2:
        notes = "Directory triage for common project files"
        return {"tool": "shell", "cmd": "ls -al | egrep -i 'readme|requirements|pyproject|setup.py|Makefile' || true", "notes": notes}
    elif step_idx == 3:
        notes = "Search for configuration files"
        return {"tool": "shell", "cmd": "find . -maxdepth 3 -type f -iregex '.*\\.(ini|toml|yaml|yml|json)$' | head -n 30", "notes": notes}
    else:
        notes = "Idle step: show top processes snapshot"
        return {"tool": "shell", "cmd": "ps aux --sort=-%cpu | head -n 15", "notes": notes}

def run_agent(goal: str, max_steps: int, read_only: bool, use_pty: bool):
    LOGGER.info(f"Agent start :: goal='{goal}', steps={max_steps}, read_only={read_only}, use_pty={use_pty}")
    EVENT_LOG.write({
        "ts": datetime.utcnow().isoformat() + "Z",
        "type": "start",
        "goal": goal,
        "max_steps": max_steps,
        "read_only": read_only,
        "use_pty": use_pty,
    })

    step = 0
    try:
        while step < max_steps:
            plan = plan_next(step)
            EVENT_LOG.write({
                "ts": datetime.utcnow().isoformat() + "Z",
                "type": "plan",
                "step": step,
                "notes": plan.get("notes", ""),
                "tool": plan.get("tool"),
                "cmd": plan.get("cmd"),
            })
            LOGGER.info(f"[PLAN] step={step} tool={plan.get('tool')} :: {plan.get('notes','')}")
            if plan["tool"] == "shell_batch":
                initial_survey(read_only=read_only, use_pty=use_pty)
            elif plan["tool"] == "python_survey":
                python_survey()
            elif plan["tool"] == "shell":
                run_shell(plan["cmd"], timeout=20, use_pty=use_pty, read_only=read_only)
            else:
                LOGGER.warning(f"Unknown tool in plan: {plan['tool']}")
            step += 1
    finally:
        EVENT_LOG.write({
            "ts": datetime.utcnow().isoformat() + "Z",
            "type": "end",
            "steps_run": step,
        })
        EVENT_LOG.close()
        LOGGER.info("Agent done.")

def main():
    ap = argparse.ArgumentParser(description="Local Python + Shell Agent (no network)")
    ap.add_argument("--goal", type=str, default="Explore local system", help="High-level intent")
    ap.add_argument("--max-steps", type=int, default=5, help="Number of planning steps")
    ap.add_argument("--read-only", action="store_true", help="Restrict shell commands to read-only allowlist")
    ap.add_argument("--no-pty", action="store_true", help="Disable PTY allocation for shell")
    args = ap.parse_args()

    # Default to read-only for safety
    read_only = bool(args.read_only or True)
    use_pty = not args.no_pty

    run_agent(goal=args.goal, max_steps=args.max_steps, read_only=read_only, use_pty=use_pty)

if __name__ == "__main__":
    main()
