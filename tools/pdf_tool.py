import io
import sys
import json
import base64
from PyPDF2 import PdfReader

def extract_text_from_pdf(pdf_bytes):
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = ""
    for page in reader.pages:
        text += page.extract_text() or ""
    return text.strip()

def main():
    raw_input = sys.stdin.read()
    payload = json.loads(raw_input)

    filename = payload.get("filename", "uploaded.pdf")
    base64_data = payload.get("base64", "")
    if not base64_data:
        print(json.dumps({
            "error": "No PDF data provided.",
            "filename": filename
        }), file=sys.stderr)
        sys.exit(1)

    try:
        pdf_bytes = base64.b64decode(base64_data)
        extracted_text = extract_text_from_pdf(pdf_bytes).strip()

        output = {
            "filename": filename,
            "text": extracted_text
        }

        print(json.dumps(output))

    except Exception as e:
        error_output = {
            "filename": filename,
            "error": str(e)
        }
        print(json.dumps(error_output), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
