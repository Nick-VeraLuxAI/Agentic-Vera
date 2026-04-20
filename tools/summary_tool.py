from transformers import pipeline

# Using a local summarization pipeline (you can swap for a custom Mistral LoRA)
summarizer = pipeline("summarization", model="sshleifer/distilbart-cnn-12-6")

def summarize_text(text, max_length=150):
    result = summarizer(text, max_length=max_length, min_length=30, do_sample=False)
    return result[0]['summary_text']
