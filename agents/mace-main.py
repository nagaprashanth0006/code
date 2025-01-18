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
    
    preamble_patterns = [
        r"^(Sure(,)?|Here (is|you go)|Of course|Certainly|As requested|Below is|Please find)[^\n]*\n+",
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

# === Agent 3: Tester - TODO ===
def test_writer():
    pass

# === Agent 4: Validator - TODO ===
def validator():
    pass

def run_agent_loop(task: str, max_loops: int = 2):
    code_file = f"main_code.py"
    test_file = f"test_main_code.py"

    for i in range(max_loops):
        print(f"\n--- Iteration {i+1} ---")

        code = code_writer(task)
        save_to_file(code_file, code)

        suggestions = code_reviewer(code, task)
        print(suggestions)
        

    save_to_file(code_file, code)
    print(f"\nCode written to: {code_file}")

# === Entry Point ===
if __name__ == "__main__":
    task = "Write a program that finds the largest prime number less than 100."
    run_agent_loop(task)
