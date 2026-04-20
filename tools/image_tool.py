from PIL import Image
import pytesseract
import base64
import io
import sys
import json

def extract_text_from_image(image_bytes):
    img = Image.open(io.BytesIO(image_bytes))
    return pytesseract.image_to_string(img)

def main():
    raw_input = sys.stdin.read()
    payload = json.loads(raw_input)

    filename = payload.get("filename", "image.png")
    base64_data = payload.get("base64", "")
    if not base64_data:
        print(json.dumps({
            "error": "No image data provided.",
            "filename": filename
        }), file=sys.stderr)
        sys.exit(1)

    try:
        image_bytes = base64.b64decode(base64_data)
        extracted_text = extract_text_from_image(image_bytes).strip()

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
