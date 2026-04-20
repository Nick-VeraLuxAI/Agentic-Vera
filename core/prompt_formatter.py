def format_prompt(brain, message):
    if brain == "vera-coder":
        return f"You are a helpful coding assistant. Answer the following:\n\n{message}"
    elif brain == "vera-legal":
        return f"Review this legal text and explain its meaning:\n\n{message}"
    else:
        return f"{message}"  # Generic fallback
