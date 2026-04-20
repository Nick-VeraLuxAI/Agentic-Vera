def route_task(user_input):
    if "code" in user_input:
        return "vera-coder"
    elif "contract" in user_input or "terms":
        return "vera-legal"
    # fallback logic...
