# lora_loader.py
import subprocess
import json
import sys

print("🔧 LoRA test loader started...")

def run_with_lora(prompt, lora_path, model_path="models/JSON-llama3-fp16.Q4_K_M.gguf
", max_tokens=256):
    command = [
        "./main",
        "-m", model_path,
        "--lora", lora_path,
        "-p", prompt,
        "--n-predict", str(max_tokens)
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"LoRA model run failed:\n{result.stderr}")
    return result.stdout.strip()

if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] != "--config":
        print("Usage: python lora_loader.py --config <path_to_config.json>")
        sys.exit(1)

    config_path = sys.argv[2]
    with open(config_path) as f:
        config = json.load(f)

    prompt = config.get("test_prompt", "Write a Python function to reverse a string.")
    lora_path = config.get("lora_path", "brains/vera-coder/adapter.safetensors")
    model_path = config.get("base_model_path", "models/JSON-llama3-fp16.Q4_K_M.gguf
")
    max_tokens = config.get("max_tokens", 256)

    print("🧠 Running model...")
    output = run_with_lora(prompt, lora_path, model_path, max_tokens)
    print("🧠 Output:\n" + output)
