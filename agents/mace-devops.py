import os
import re
import docker
import datetime
import subprocess
from langchain_ollama import OllamaLLM


# === Initialize Ollama LLM ===
#llm = Ollama(model="codellama:instruct")
llm = OllamaLLM(model="codellama:instruct")

# === Utility: Clean LLM output ===
def clean_llm_output(output: str) -> str:
    output = output.strip()
    output = output.replace("```python", "").replace("```", "").strip()
    output = output.replace("Dockerfile content:", "").strip()

    # Remove "Dockerfile" as a label or heading
    output = re.sub(r"^(Dockerfile:?)(\s*\n)?", "", output, flags=re.IGNORECASE | re.MULTILINE)

    preamble_patterns = [
        r"^(Sure(,)?|Here (is|you go)|Of course|Certainly|As requested|Below is|Please find)[^\n]*\n+",
        r"^(This Dockerfile:|This code:|Here’s a script that)[^\n]*\n+"
    ]
    postamble_patterns = [
        r"(Hope this helps!|Let me know if you need anything else\.|That should do it\.)",
        r"(This concludes the code|End of script)"
    ]
    for pattern in preamble_patterns:
        output = re.sub(pattern, '', output, flags=re.IGNORECASE)
    for pattern in postamble_patterns:
        output = re.sub(pattern, '', output, flags=re.IGNORECASE)

    return output.strip()


# === Utility: Build Docker Image ===
def build_docker_image(tag="mace-code-agent"):
    try:
        client = docker.from_env()
        print(f"[Build_docker_image_agent] Building image '{tag}' using docker-py...")

        image, logs = client.images.build(
            path=".",
            dockerfile="Dockerfile",
            tag=tag,
            rm=True
        )

        for chunk in logs:
            if 'stream' in chunk:
                print(chunk['stream'].strip())

        return f"Docker image '{tag}' built successfully."

    except docker.errors.BuildError as build_err:
        return f"Build failed: {str(build_err)}"
    except docker.errors.APIError as api_err:
        return f"Docker API error: {str(api_err)}"
    except Exception as e:
        return f"Unexpected error: {str(e)}"


def validate_dockerfile(dockerfile: str) -> bool:
    return "FROM" in dockerfile and "CMD" in dockerfile

def clean_dockerfile_lines(dockerfile: str) -> str:
    valid_instructions = {
        "FROM", "RUN", "CMD", "LABEL", "EXPOSE", "ENV",
        "ADD", "COPY", "ENTRYPOINT", "WORKDIR", "USER", "VOLUME",
        "ARG", "ONBUILD", "STOPSIGNAL", "HEALTHCHECK", "SHELL"
    }

    cleaned_lines = []
    for line in dockerfile.splitlines():
        stripped = line.strip()
        # Remove blank lines or comments
        if not stripped or stripped.startswith("#"):
            continue
        # Retain only lines starting with a valid instruction
        if any(stripped.upper().startswith(instr) for instr in valid_instructions):
            cleaned_lines.append(line)
        else:
            print(f"[DockerfileCleaner] Removed line: {line.strip()}")
    
    return "\n".join(cleaned_lines).strip()


# === Utility: Save to file ===
def save_to_file(filename: str, content: str):
    with open(filename, "w") as f:
        f.write(content.strip())
    print(f"[FileWriter] Written to {filename}")

# === Agent 1: Code Writer ===
def code_writer(task: str) -> str:
    prompt = f"""
Write complete, executable Python code to solve the following task:

{task}

Requirements:
- Code must be directly executable without modification
- Must contain a __main__ block or top-level runnable structure
- Must not use undefined imports, variables, or TODO placeholders
- Must not include markdown, comments, or explanations
Return only valid Python code.
"""
    print(f"[CodeWriter] Invoking LLM")
    return clean_llm_output(llm.invoke(prompt))

# === Agent 2: Code Reviewer ===
def code_reviewer(code: str, requirements: str) -> str:
    prompt = f"""
Review the following Python code to ensure it satisfies the requirements below.

Requirements:
{requirements}

Code:
{code}

Provide clear suggestions for improvements.
"""
    print(f"[CodeReviewer] Invoking LLM")
    return clean_llm_output(llm.invoke(prompt))

# === Agent 3: Test Writer ===
def test_writer(code: str) -> str:
    prompt = f"""
Generate complete pytest test cases for the following Python code.

Constraints:
- Tests must be executable without modifications
- Avoid using undefined references or broken imports
- Use proper pytest syntax

Code:
{code}

Return only valid test code (no markdown or explanations).
"""
    print(f"[TestWriter] Invoking LLM")
    return clean_llm_output(llm.invoke(prompt))

# === Agent 4: Test Runner ===
def run_tests(code_file: str, test_file: str, timeout: int = 10) -> str:
    try:
        print(f"[TestRunner] Running {code_file}...")
        exec_result = subprocess.run(
            ["python", code_file],
            capture_output=True,
            text=True,
            timeout=timeout
        )
        print(f"[TestRunner] Running tests from {test_file}...")
        test_result = subprocess.run(
            ["python", "-m", "pytest", test_file, "--tb=short", "-v"],
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return f"=== Code Output ===\n{exec_result.stdout.strip()}\n\n=== Test Output ===\n{test_result.stdout.strip()}"
    except subprocess.TimeoutExpired:
        return "Test execution timed out."
    except Exception as e:
        return f"Error during execution: {str(e)}"

# === Agent 5: Refiner ===
def refiner(code: str, test_results: str, suggestions: str) -> str:
    prompt = f"""
Refactor and improve the given Python code based on the following inputs:

Test Results:
{test_results}

Review Suggestions:
{suggestions}

Original Code:
{code}

Return only the corrected Python code.
"""
    print(f"[Refiner] Invoking LLM")
    return clean_llm_output(llm.invoke(prompt))

# === Utility: Ensure Valid Code ===
def ensure_valid_code(code: str, generator_func, *args, retries=2):
    attempts = 0
    while (not code.strip() or "def" not in code) and attempts < retries:
        print(f"[Validator] Invalid or empty code detected. Retrying (attempt {attempts+1})...")
        code = generator_func(*args)
        attempts += 1
    return code

# === Agent 6: Dockerizer ===
def dockerizer(code_file: str) -> str:
    code_content = open(code_file, "r").read()
    prompt = f"""
You are generating a Dockerfile to containerize a Python script.

Constraints:
- The script filename is: {code_file}
- Copy only the script file into the Docker image
- Do no use COPY . or COPY * to avoid copying unnecessary files
- Do not assume alternate filenames (e.g., fibonacci.py)
- Do not assume requirements.txt exists unless explicitly told
- The Dockerfile must work for the given code only
- Use LABEL instead of MAINTAINER (MAINTAINER is deprecated)
- Output only valid Dockerfile content (no markdown, comments, or preambles)

Now, generate the Dockerfile for this Python script:
{code_content}
"""
    print(f"[Dockerizer] Invoking LLM...")
    return clean_llm_output(llm.invoke(prompt))



def patch_dockerfile(dockerfile: str, actual_filename: str) -> str:
    # Replace common hallucinated .py filenames with actual filename
    dockerfile = re.sub(r"COPY\s+\w+\.py", f"COPY {actual_filename}", dockerfile)
    # Optionally remove requirements.txt if not generated
    if not os.path.exists("requirements.txt"):
        dockerfile = re.sub(r".*COPY requirements\.txt.*\n?", "", dockerfile)
        dockerfile = re.sub(r".*pip install .*-r requirements\.txt.*\n?", "", dockerfile)
    return dockerfile


# === Utility: Build Docker Image ===
def build_docker_image():
    timeout = 15
    try:
        print(f"[Build_docker_image_agent] Running...")
        exec_result = subprocess.run(
            ["docker", "build", "-t", "mace-code-agent", "."],
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return f"Docker image built, output:\n{exec_result.stdout.strip()}\nErrors:\n{exec_result.stderr.strip()}"
    except subprocess.TimeoutExpired:
        return "Docker build timed out."
    except Exception as e:
        return f"Error during Docker build: {str(e)}"

def validate_dockerfile_contents(dockerfile_str: str) -> bool:
    return "FROM" in dockerfile_str and ("CMD" in dockerfile_str or "ENTRYPOINT" in dockerfile_str)

# === Coordinator ===
def run_agent_loop(task: str, max_loops: int = 2):
    timestamp_suffix = datetime.datetime.strftime(datetime.datetime.now(), "%Y%m%d%H%M%S")
    code_file = f"main_code-{timestamp_suffix}.py"
    test_file = f"test_main_code-{timestamp_suffix}.py"

    for i in range(max_loops):
        print(f"\n--- Iteration {i+1} ---")

        code = code_writer(task)
        code = ensure_valid_code(code, code_writer, task)
        save_to_file(code_file, code)

        suggestions = code_reviewer(code, task)
        test_code = test_writer(code)
        test_code = ensure_valid_code(test_code, test_writer, code)
        save_to_file(test_file, test_code)

        results = run_tests(code_file, test_file)

        if "failed" in results.lower() or "error" in results.lower():
            print("[Refiner] Refining code based on feedback...")
            code = refiner(code, results, suggestions)
            code = ensure_valid_code(code, refiner, code, results, suggestions)
        else:
            print("\nCode and tests passed. No further refinement needed.")
            break

    save_to_file(code_file, code)
    print(f"\nFinal code written to: {code_file}")

    dockerfile_content = dockerizer(code_file)
    dockerfile_content = clean_dockerfile_lines(dockerfile_content)

    if validate_dockerfile_contents(dockerfile_content):
        save_to_file("Dockerfile", dockerfile_content)
        build_result = build_docker_image()
        print(build_result)
    else:
        print("Invalid Dockerfile: Missing required directives like FROM or CMD.")

    dockerfile_content = patch_dockerfile(dockerfile_content, os.path.basename(code_file))
    save_to_file("Dockerfile", dockerfile_content)
    build_results = build_docker_image()

    print(build_results)

# === Entry Point ===
if __name__ == "__main__":
    tasks_list = [
        "Write a Python function that prints the Fibonacci sequence up to 1000.",
        "Write a program that inverts a single-bit input 0 or 1, without using any conditionals or logical operators.",
        "Write a program that prints the Fibonacci sequence up to a maximum value.",
        "Write a program that calculates the factorial of a number using recursion.",
        "Write a program that checks if a given string is a palindrome.",
        "Write a program that finds the largest prime number less than 100."
    ]
    for task in tasks_list[:1]:
        run_agent_loop(task)
