import sys
from tools.local_infer import local_generate
from core.prompt_formatter import format_prompt

def run(brain_name, user_input):
    prompt = format_prompt(brain_name, user_input)
    result = local_generate(prompt)
    print(result)

if __name__ == "__main__":
    brain = sys.argv[1] if len(sys.argv) > 1 else "vera-core"
    user_input = sys.argv[2] if len(sys.argv) > 2 else ""
    run(brain, user_input)
