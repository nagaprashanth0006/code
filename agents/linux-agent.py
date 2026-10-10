#!/usr/bin/env python3
# ollama_agent_qwen05b.py
# Local agent using a local Ollama model with tool calling for Linux exploration.
# - Default model: qwen2.5-coder:0.5b (small, code-focused)
# - Limits loop to 100 iterations
# - Ctrl+C is a kill switch (graceful stop)
# - Caps context and tokens per reply to fit 2c/4GB VMs
# - Trims message history to contain memory growth (KV cache)

import argparse
import io
import json
import logging
import logging.handlers
import os
import re
import signal
import subprocess
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

# Prefer the Ollama Python client (supports tool-calling); fallback to REST if unavailable
try:
    import ollama  # preinstall offline if desired
    HAS_OLLAMA_PY = True
except Exception:
    HAS_OLLAMA_PY = False

try:
    import urllib.request
    import urllib.error
except Exception:
    pass

APP_NAME = "ollama_local_agent"
LOG_DIR = Path("./logs")
LOG_DIR.mkdir(parents=True, exist_ok=True)

def build_logger(level: str = "INFO"):
    logger = logging.getLogger(APP_NAME)
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))

    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(getattr(logging, level.upper(), logging.INFO))
    ch.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s | %(message)s"))

    fh = logging.handlers.RotatingFileHandler(
        LOG_DIR / f"{APP_NAME}.log", maxBytes=5_000_000, backupCount=3, encoding="utf-8"
    )
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter(
        "%(asctime)s %(name)s %(levelname)s %(process)d %(threadName)s | %(message)s"
    ))

    if not logger.handlers:
        logger.addHandler(ch)
        logger.addHandler(fh)
    return logger

LOGGER = build_logger()

class JsonlWriter:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fp = open(self.path, "a", encoding="utf-8", buffering=1)

    def write(self, event: dict):
        event["ts"] = datetime.utcnow().isoformat() + "Z"
        self.fp.write(json.dumps(event, ensure_ascii=False) + "\n")

    def close(self):
        try:
            self.fp.close()
        except Exception:
            pass

EVENTS = JsonlWriter(LOG_DIR / "agent_events.jsonl")

# Safety: block obviously destructive commands unless --unsafe is set.
DANGEROUS_SHELL_PATTERNS = [
    r"\brm\b\s+-rf\s+\/", r"\bmkfs\.", r"\bdd\b.*\sof=\/dev\/",
    r"\bshutdown\b", r"\breboot\b", r"\bpoweroff\b", r":\(\)\{: \|: &\};:",
    r"\bchown\b\s+-R\s+\/", r"\bchmod\b\s+-R\s+\/", r"\bmount\b", r"\bumount\b",
]

WORKSPACE = Path("./agent_workspace")
WORKSPACE.mkdir(exist_ok=True)

def blocked_by_policy(cmd: str, unsafe: bool) -> bool:
    if unsafe:
        return False
    for pat in DANGEROUS_SHELL_PATTERNS:
        if re.search(pat, cmd):
            return True
    return False

def run_shell(cmd: str, timeout: int = 20, unsafe: bool = False) -> dict:
    start = time.time()
    LOGGER.info(f"[ACT] shell: {cmd}")
    EVENTS.write({"type": "act", "tool": "run_shell", "cmd": cmd, "timeout_s": timeout})
    if blocked_by_policy(cmd, unsafe):
        msg = "Blocked by safety policy"
        LOGGER.warning(msg + f": {cmd}")
        EVENTS.write({"type": "result", "tool": "run_shell", "blocked": True, "cmd": cmd})
        return {"blocked": True, "returncode": None, "stdout": "", "stderr": msg, "duration_s": time.time() - start}
    try:
        proc = subprocess.run(
            ["/bin/bash", "-lc", cmd],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=os.environ.copy(),
        )
        out = proc.stdout
        err = proc.stderr
        rc = proc.returncode
        dur = time.time() - start
        if out:
            LOGGER.info(f"[OUT] {out.strip()[:3000]}")
        if err:
            LOGGER.info(f"[ERR] {err.strip()[:1500]}")
        EVENTS.write({
            "type": "result", "tool": "run_shell", "cmd": cmd, "returncode": rc,
            "stdout": out[:20000], "stderr": err[:20000], "duration_s": dur
        })
        return {"blocked": False, "returncode": rc, "stdout": out, "stderr": err, "duration_s": dur}
    except subprocess.TimeoutExpired:
        msg = f"Timeout after {timeout}s"
        LOGGER.error(msg)
        EVENTS.write({"type": "result", "tool": "run_shell", "cmd": cmd, "error": msg})
        return {"blocked": False, "returncode": None, "stdout": "", "stderr": msg, "duration_s": time.time() - start}
    except Exception as e:
        tb = traceback.format_exc()
        LOGGER.error(f"[EXC] {e}")
        EVENTS.write({"type": "result", "tool": "run_shell", "cmd": cmd, "exception": tb})
        return {"blocked": False, "returncode": None, "stdout": "", "stderr": str(e), "duration_s": time.time() - start}

def write_script(rel_path: str, content: str, make_executable: bool = True) -> dict:
    start = time.time()
    EVENTS.write({"type": "act", "tool": "write_script", "path": rel_path})
    LOGGER.info(f"[ACT] write_script: {rel_path} bytes={len(content)}")
    safe_path = (WORKSPACE / rel_path).resolve()
    if not str(safe_path).startswith(str(WORKSPACE.resolve())):
        msg = "Path escapes workspace; blocked"
        LOGGER.warning(msg)
        EVENTS.write({"type": "result", "tool": "write_script", "error": msg})
        return {"ok": False, "error": msg}
    try:
        safe_path.parent.mkdir(parents=True, exist_ok=True)
        with open(safe_path, "w", encoding="utf-8") as f:
            f.write(content)
        if make_executable:
            os.chmod(safe_path, 0o755)
        dur = time.time() - start
        EVENTS.write({"type": "result", "tool": "write_script", "path": str(safe_path), "duration_s": dur})
        LOGGER.info(f"[OK] wrote {safe_path}")
        return {"ok": True, "path": str(safe_path), "duration_s": dur}
    except Exception as e:
        tb = traceback.format_exc()
        LOGGER.error(f"[EXC] write_script failed: {e}")
        EVENTS.write({"type": "result", "tool": "write_script", "exception": tb})
        return {"ok": False, "error": str(e)}

# Tool function wrappers wired to Ollama function-calling
def tool_run_shell(command: str, timeout: int = 20) -> dict:
    return run_shell(command, timeout=timeout, unsafe=ARGS.unsafe)

def tool_write_script(path: str, content: str, executable: bool = True) -> dict:
    return write_script(path, content, make_executable=executable)

SYSTEM_PROMPT = """You are a Linux exploration agent with two tools:
1) run_shell(command:str, timeout:int=20) executes commands via bash -lc.
2) write_script(path:str, content:str, executable:bool=True) writes scripts under ./agent_workspace.

Goals:
- Explore the Linux VM, discover OS details, files, processes, resources, and produce a final succinct report.
- Prefer using tools; after each tool call, decide the next best step until you can conclude with a final report.
- Only write files within ./agent_workspace. If you write a script, execute it with run_shell.
- Keep commands safe and non-destructive. Avoid modifying the system.
- Keep outputs brief; focus on summaries and top-N lines to conserve context.
- When finished, provide a final summary and say DONE.

Important:
- Use tools instead of printing commands.
- If a command fails, try an alternative.
"""

# Small-model options for CPU-only VM
OLLAMA_OPTIONS = {
    "temperature": 0.1,     # more deterministic
    "top_p": 0.9,
    "num_ctx": 2048,        # cap context size to fit 4GB VM
    "num_predict": 256,     # cap tokens per step to keep KV cache small
    "seed": 42,             # reproducibility
}

def prune_messages(messages: list, keep_system: int = 1, keep_tail: int = 18):
    """
    Keep the system prompt(s) and the last N messages to contain RAM usage.
    """
    sys_msgs = [m for m in messages if m.get("role") == "system"]
    non_sys = [m for m in messages if m.get("role") != "system"]
    pruned = sys_msgs[:keep_system] + non_sys[-keep_tail:]
    return pruned

def ollama_chat_with_tools(model: str, messages: list):
    """
    Preferred: Ollama Python client with tool calling.
    """
    response = ollama.chat(
        model=model,
        messages=messages,
        tools=[tool_run_shell, tool_write_script],
        options=OLLAMA_OPTIONS,
    )
    tool_calls = getattr(response.message, "tool_calls", None) or []
    return response.message, tool_calls

def call_ollama_rest_chat(model: str, messages: list, stream: bool = False) -> dict:
    """
    Fallback: raw REST POST to /api/chat; pass options explicitly.
    """
    base = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
    url = base.rstrip("/") + "/api/chat"
    payload = {"model": model, "messages": messages, "stream": stream, "options": OLLAMA_OPTIONS}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))

SHOULD_STOP = False

def sigint_handler(signum, frame):
    global SHOULD_STOP
    SHOULD_STOP = True
    LOGGER.warning("Received Ctrl+C (SIGINT). Requesting graceful shutdown...")
    EVENTS.write({"type": "signal", "name": "SIGINT"})

def run_agent(model: str, max_steps: int, unsafe: bool):
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.append({"role": "user", "content": "Begin exploration."})
    step = 0
    LOGGER.info(f"Agent starting with model='{model}', max_steps={max_steps}, unsafe={unsafe}")
    EVENTS.write({"type": "meta", "event": "start", "model": model, "max_steps": max_steps, "unsafe": unsafe})

    try:
        while step < max_steps and not SHOULD_STOP:
            step += 1
            LOGGER.info(f"=== Step {step} ===")
            if HAS_OLLAMA_PY:
                assistant_msg, tool_calls = ollama_chat_with_tools(model, messages)
                content = getattr(assistant_msg, "content", "") or ""
                if content:
                    LOGGER.info(f"[MODEL] {content.strip()[:3000]}")
                    EVENTS.write({"type": "llm", "role": "assistant", "content": content})
                executed_any = False
                for call in tool_calls:
                    executed_any = True
                    fn = call.function.name
                    args = call.function.arguments or {}
                    LOGGER.info(f"[TOOL-CALL] {fn}({args})")
                    if fn == "run_shell":
                        res = tool_run_shell(**args)
                        messages.append({"role": "tool", "content": json.dumps(res)[:20000], "name": fn})
                        EVENTS.write({"type": "tool_result", "name": fn, "result": res})
                    elif fn == "write_script":
                        res = tool_write_script(**args)
                        messages.append({"role": "tool", "content": json.dumps(res)[:20000], "name": fn})
                        EVENTS.write({"type": "tool_result", "name": fn, "result": res})
                    else:
                        err = {"error": f"Unknown tool: {fn}"}
                        LOGGER.warning(err["error"])
                        messages.append({"role": "tool", "content": json.dumps(err), "name": fn})
                if not executed_any:
                    # Done signal
                    if "DONE" in content.upper():
                        LOGGER.info("Model indicated completion.")
                        break
                messages.append({"role": "assistant", "content": content})
                messages[:] = prune_messages(messages)
            else:
                # Fallback: enforce JSON tool protocol
                messages.append({"role": "system", "content":
                                 "Respond ONLY with JSON: "
                                 '{"thought":"<brief>",'
                                 '"tool":"run_shell|write_script|finish",'
                                 '"args":{...},"final":"<summary if finish>"}'})
                resp = call_ollama_rest_chat(model, messages, stream=False)
                content = (resp.get("message") or {}).get("content", "") or ""
                LOGGER.info(f"[MODEL] {content.strip()[:3000]}")
                EVENTS.write({"type": "llm", "role": "assistant", "content": content})
                # Lightweight parser for first {...} block
                def parse_json_block(txt: str):
                    try:
                        s = txt.find("{"); e = txt.rfind("}")
                        if s != -1 and e != -1 and e > s:
                            return json.loads(txt[s:e+1])
                    except Exception:
                        return None
                    return None
                obj = parse_json_block(content)
                if not obj:
                    LOGGER.info("No valid tool JSON found; stopping.")
                    break
                tool = obj.get("tool")
                if tool == "run_shell":
                    args = obj.get("args", {})
                    res = run_shell(args.get("command", ""), timeout=int(args.get("timeout", 20)), unsafe=unsafe)
                    messages.append({"role": "tool", "content": json.dumps(res)[:20000], "name": "run_shell"})
                elif tool == "write_script":
                    args = obj.get("args", {})
                    res = write_script(args.get("path", "script.sh"), args.get("content", ""), bool(args.get("executable", True)))
                    messages.append({"role": "tool", "content": json.dumps(res)[:20000], "name": "write_script"})
                elif tool == "finish":
                    final = obj.get("final", "")
                    LOGGER.info("[FINAL]\n" + final)
                    break
                else:
                    LOGGER.info("Unknown tool selection; stopping.")
                    break
                messages[:] = prune_messages(messages)

        LOGGER.info("Agent loop complete.")
    finally:
        EVENTS.write({"type": "meta", "event": "stop", "steps": step})

def main():
    global ARGS
    ap = argparse.ArgumentParser(description="Local Ollama agent (qwen2.5-coder:0.5b) with tool-calling")
    ap.add_argument("--model", default="qwen2.5-coder:0.5b", help="Ollama model name (preloaded offline)")
    ap.add_argument("--max-steps", type=int, default=100, help="Max reasoning/action steps")
    ap.add_argument("--log-level", default="INFO", help="Console log level")
    ap.add_argument("--unsafe", action="store_true", help="Allow dangerous shell commands (not recommended)")
    ARGS = ap.parse_args()

    global LOGGER
    LOGGER = build_logger(ARGS.log_level)

    signal.signal(signal.SIGINT, sigint_handler)

    LOGGER.info(f"Starting agent with model={ARGS.model}")
    run_agent(model=ARGS.model, max_steps=ARGS.max_steps, unsafe=ARGS.unsafe)
    LOGGER.info("Done.")

if __name__ == "__main__":
    main()
